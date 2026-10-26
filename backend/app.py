import base64
import gc
import io
import os
import threading
from typing import Optional

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, ImageOps

app = FastAPI()

# --- Model ---
# rembg paketini artık kullanmıyoruz. rembg'yi kurmak scipy, scikit-image,
# opencv-python-headless, pymatting gibi ağır kütüphaneleri de zorunlu
# olarak getiriyordu; bunlar sunucu hiç istek almadan sadece açılırken bile
# ~300-400MB taban bellek tüketimine sebep oluyordu (512MB sınırında bu,
# neredeyse tüm bütçeyi tek başına tüketiyordu). Bunun yerine u2netp.onnx
# modelini (4MB) doğrudan onnxruntime ile çalıştırıyoruz - Dockerfile bu
# modeli build sırasında indirip imaja gömüyor, burada sadece yüklüyoruz.
MODEL_PATH = os.environ.get("MODEL_PATH", "/app/models/u2netp-256.onnx")

sess_opts = ort.SessionOptions()
# Thread başına ayrılan ekstra bellek tamponunu sınırlamak için thread
# sayısını 1'e sabitliyoruz (eskiden OMP_NUM_THREADS ortam değişkenine
# güveniyorduk, artık SessionOptions üzerinden doğrudan ve garantili
# şekilde ayarlıyoruz).
sess_opts.intra_op_num_threads = 1
sess_opts.inter_op_num_threads = 1
sess_opts.enable_cpu_mem_arena = False
sess_opts.enable_mem_pattern = False
sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC

session = ort.InferenceSession(
    MODEL_PATH, sess_options=sess_opts, providers=["CPUExecutionProvider"]
)
INPUT_NAME = session.get_inputs()[0].name

# u2netp'nin beklediği giriş boyutu ve ImageNet normalizasyon değerleri.
# rembg'nin session_base.py / sessions/u2netp.py kaynağıyla doğrulandı.
MODEL_INPUT_SIZE = tuple(session.get_inputs()[0].shape[2:])
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)

# Telefon fotoğrafları genelde çok yüksek çözünürlüklü oluyor (örn. 4000x3000px),
# bu da işlerken gereksiz yere fazla bellek harcatıyor. İşlemeden önce
# uzun kenarı bu boyuta küçültüyoruz, kalite için yeterli, bellek için çok daha hafif.
MAX_DIMENSION = 768

# İsteğe bağlı basit koruma: Hugging Face Space ayarlarından "PROXY_SECRET"
# adında bir secret eklersen, sadece doğru anahtarla gelen istekler kabul
# edilir. Eklemezsen bu kontrol devre dışı kalır, hiçbir şeyi bozmaz.
PROXY_SECRET = os.environ.get("PROXY_SECRET")
processing_slot = threading.BoundedSemaphore(1)


class RemoveBgRequest(BaseModel):
    image_file_b64: str = Field(min_length=1, max_length=10 * 1024 * 1024)


def predict_mask(img: Image.Image) -> Image.Image:
    """u2netp ile ön plan maskesi üretir. rembg'nin BaseSession.normalize()
    ve U2netpSession.predict() adımlarının birebir aynısı."""
    im = img.convert("RGB").resize(MODEL_INPUT_SIZE, Image.LANCZOS)

    im_ary = np.array(im).astype(np.float32)
    im_ary /= max(float(np.max(im_ary)), 1.0)

    tmp_img = np.zeros((im_ary.shape[0], im_ary.shape[1], 3), dtype=np.float32)
    tmp_img[:, :, 0] = (im_ary[:, :, 0] - MEAN[0]) / STD[0]
    tmp_img[:, :, 1] = (im_ary[:, :, 1] - MEAN[1]) / STD[1]
    tmp_img[:, :, 2] = (im_ary[:, :, 2] - MEAN[2]) / STD[2]
    tmp_img = tmp_img.transpose((2, 0, 1))
    ort_input = {INPUT_NAME: np.expand_dims(tmp_img, 0).astype(np.float32)}

    ort_outs = session.run(None, ort_input)
    pred = ort_outs[0][:, 0, :, :]
    ma, mi = np.max(pred), np.min(pred)
    pred = (pred - mi) / max(float(ma - mi), 1e-8)
    pred = np.squeeze(pred)

    mask = Image.fromarray((pred * 255).astype(np.uint8), mode="L")
    mask = mask.resize(img.size, Image.LANCZOS)
    return mask


def remove_background(img: Image.Image) -> Image.Image:
    """Apply alpha without an extra full-size transparent canvas."""
    mask = predict_mask(img)
    cutout = img.convert("RGBA")
    cutout.putalpha(mask)
    mask.close()
    return cutout


def trim_transparent_margin(img: Image.Image, margin_percent: float = 0.08) -> Image.Image:
    """Kıyafetin etrafındaki şeffaf boşluğu kırpar, ufak bir pay bırakarak."""
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if bbox is None:
        return img
    left, top, right, bottom = bbox
    width, height = right - left, bottom - top
    margin_x = int(width * margin_percent)
    margin_y = int(height * margin_percent)
    left = max(0, left - margin_x)
    top = max(0, top - margin_y)
    right = min(img.width, right + margin_x)
    bottom = min(img.height, bottom + margin_y)
    return img.crop((left, top, right, bottom))


@app.get("/")
def health():
    # Hugging Face'in "Running" durumunu göstermesi ve senin tarayıcıdan
    # test edebilmen için basit bir sağlık kontrolü.
    return {"status": "ok", "service": "aura-bg-removal"}


@app.post("/removebg")
def remove_bg(payload: RemoveBgRequest, x_proxy_secret: Optional[str] = Header(default=None)):
    if PROXY_SECRET and x_proxy_secret != PROXY_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Acquire BEFORE decode, not just inference: PNG/JPEG decoding itself can
    # otherwise allocate several full-size images in parallel on a 512 MB host.
    if not processing_slot.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Görsel işleniyor; tekrar dene.", headers={"Retry-After": "2"})
    try:
        try:
            input_bytes = base64.b64decode(payload.image_file_b64, validate=True)
            buffer = io.BytesIO(input_bytes)
            with Image.open(buffer) as source:
                if source.width * source.height > 20_000_000:
                    raise ValueError("Image too large")
                source.draft("RGB", (MAX_DIMENSION, MAX_DIMENSION))
                source.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
                # Shrink first, then create the RGBA copy; preserve phone orientation.
                with ImageOps.exif_transpose(source) as oriented:
                    input_image = oriented.convert("RGBA")
            buffer.close()
            del input_bytes, buffer
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz veya çok büyük görsel verisi")

        with input_image:
            with remove_background(input_image) as output_image:
                with trim_transparent_margin(output_image) as cropped:
                    with io.BytesIO() as output:
                        cropped.save(output, format="PNG")
                        result_b64 = base64.b64encode(output.getvalue()).decode("ascii")
        return {"data": {"result_b64": result_b64}}
    finally:
        gc.collect()
        processing_slot.release()
