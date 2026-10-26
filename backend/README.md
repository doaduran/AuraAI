# Aura – Background Removal Service

[Aura](https://github.com/) uygulamasının parçası olan bu servis, kullanıcının yüklediği kıyafet
fotoğraflarının arka planını kaldırır. Ücretsiz/düşük katmanlı bulut planlarında (Render, Koyeb, vb.)
genelde ~512MB RAM ile çalışacak şekilde tasarlandı.

## Mimari kararlar ve neden

Canlı Render servisi bu klasörden değil, ayrı
[`doaduran/aura-bg-removal`](https://github.com/doaduran/aura-bg-removal)
deposundan yayınlanır. Bu klasör aynı uygulamanın referans kopyasıdır.

- **rembg yerine ham onnxruntime.** `rembg` paketini kurmak `scipy`, `scikit-image`,
  `opencv-python-headless`, `pymatting` gibi ağır bağımlılıkları da zorunlu kılıyor; bunlar sunucu
  hiç istek almadan sadece açılırken bile ~300–400MB taban bellek tüketiyordu. Bunun yerine
  `u2netp.onnx` modelini (4MB) build sırasında imaja gömüp doğrudan `onnxruntime` ile çalıştırıyoruz.
- **Tek seferde tek görsel.** Görsel açılmadan önce tek işleme hakkı alınır. Eşzamanlı ek
  istekler bellek ayırmak yerine `503` ve `Retry-After: 2` yanıtı alır. Model ve görsel
  kopyalarının birden fazla istekte aynı anda belleğe açılması önlenir.
- **ONNX memory arena kapalı.** `enable_cpu_mem_arena=False` / `enable_mem_pattern=False` —
  varsayılan arena istekler arasında büyüyüp geri küçülmüyor, bu da zamanla bellek şişmesine katkı
  sağlıyordu.
- **Doğru alfa kompozisyonu.** Maske doğrudan `putalpha()` ile uygulanıyor; `Image.composite()` ile
  şeffaf bir tuvale composite etmek kenarlardaki RGB değerlerini siyaha doğru karıştırıp renk
  bozulmasına sebep oluyordu.
- **JPEG draft-decode + thumbnail.** Telefon fotoğrafları (örn. 4032×3024) tam çözünürlükte belleğe
  açılmadan önce `Image.draft()` ile küçük decode ediliyor, ardından `thumbnail()` ile kesin sınıra
  çekiliyor. RGBA kopyası küçültmeden sonra oluşturulur. Çıktı en fazla 768 piksel,
  kodlanmış giriş en fazla 10 MiB, kaynak görüntü en fazla 20 milyon pikseldir.
  Tek Uvicorn işçisi çalışır.
- **256 piksel model girdisi.** Tam evrişimli U2NetP ağının uzamsal metadata'sı build
  sırasında 256 piksele ayarlanır; ağırlıklar değişmez. Aktivasyon belleği azalır,
  maske çıktı görselinin boyutuna geri ölçeklenir. Graph optimization BASIC kullanılır.

## Çalıştırma

```bash
docker build -t aura-bg .
docker run -p 7860:7860 aura-bg
```

Opsiyonel: `PROXY_SECRET` ortam değişkeni set edilirse, `/removebg` endpoint'i sadece doğru
`X-Proxy-Secret` header'ıyla gelen istekleri kabul eder.

## API

**POST** `/removebg`

```json
{ "image_file_b64": "<base64 encoded image>" }
```

Yanıt:

```json
{ "data": { "result_b64": "<base64 encoded transparent PNG>" } }
```

## Lisans

MIT — bkz. [LICENSE](./LICENSE)
