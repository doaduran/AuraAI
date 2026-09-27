// ============================================================
// AURA API PROXY (Cloudflare Worker)
// ============================================================
// Bu dosya, Gemini ve Remove.bg/removebg API anahtarlarını UYGULAMANIN
// İÇİNDEN GİZLER. Anahtarlar sadece burada, Cloudflare'in kendi
// "Secret" (şifreli ortam değişkeni) sisteminde saklanır ve
// hiçbir zaman mobil uygulama paketine (APK/IPA) gömülmez.
//
// Kurulum: bkz. README.md
// ============================================================

const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-3.6-flash'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // Worker'ın kendi endpoint'lerini (herkese açık internetten gelen
    // kötüye kullanıma karşı) korumak için paylaşılan bir secret kontrolü.
    // APP_SHARED_SECRET set edilmemişse bu kontrol atlanır (yerel geliştirme
    // kolaylığı için) - production'da `wrangler secret put APP_SHARED_SECRET`
    // ile ayarlanması, mobil tarafta da aynı değerin .env'e (EXPO_PUBLIC_APP_SECRET)
    // yazılması önerilir. Bu URL public bir repo'da göründüğü için önemli:
    // bu kontrol olmadan herkes senin Gemini kotanı/Render servisini tüketebilir.
    if (env.APP_SHARED_SECRET && request.headers.get('X-App-Secret') !== env.APP_SHARED_SECRET) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
      if (url.pathname === '/gemini' && request.method === 'POST') {
        return await handleGemini(request, env);
      }
      if (url.pathname === '/removebg' && request.method === 'POST') {
        return await handleRemoveBg(request, env);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Sunucu hatası' }, 500);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- GEMINI: birden fazla model + üstel bekleme ile otomatik tekrar deneme ---
async function handleGemini(request, env) {
  const body = await request.json(); // { parts, generationConfig }
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: body.parts }],
            ...(body.generationConfig ? { generationConfig: body.generationConfig } : {}),
          }),
        }
      );
      const data = await res.json();

      if (res.ok) {
        return jsonResponse(data);
      }

      lastError = data?.error?.message || `HTTP ${res.status}`;

      // Model yoğun (503) veya kota (429) ise bekleyip aynı modeli tekrar dene
      if (res.status === 429 || res.status === 503) {
        await sleep(Math.pow(2, attempt) * 1000); // 1sn, 2sn, 4sn
        continue;
      }
      break; // başka bir hata -> bu modelde ısrar etme, sıradaki modele geç
    }
  }
  return jsonResponse({ error: lastError || 'Gemini servisine ulaşılamadı.' }, 502);
}

// --- ARKA PLAN SİLME: kendi ücretsiz servisimiz (Render + onnxruntime) ---
async function handleRemoveBg(request, env) {
  const body = await request.json(); // { image_file_b64 }

  const res = await fetch(`${env.BG_REMOVAL_URL}/removebg`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // BG_REMOVAL_SECRET ayarlarsan (isteğe bağlı), removebg servisine de aynı
      // PROXY_SECRET'ı eklersen sadece senin worker'ından gelen istekler kabul edilir.
      ...(env.BG_REMOVAL_SECRET ? { 'X-Proxy-Secret': env.BG_REMOVAL_SECRET } : {}),
    },
    body: JSON.stringify({
      image_file_b64: body.image_file_b64,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return jsonResponse({ error: data?.detail || data?.error || 'Arka plan silme servisi hatası' }, res.status);
  }
  return jsonResponse(data);
}
