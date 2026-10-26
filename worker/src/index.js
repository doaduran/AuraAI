// API keys remain in Worker secrets. Never log prompts, photos, or credentials.
const MODELS = ['gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const PHOTO_MODELS = ['gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const clothingFields = ['subCategory_tr', 'subCategory_en', 'color_tr', 'color_en', 'style_tr', 'style_en', 'pattern_tr', 'pattern_en'];
const clothingSchema = {
  type: 'OBJECT',
  properties: {
    mainCategory: { type: 'STRING', enum: ['UstGiyim', 'AltGiyim', 'TekParca', 'DisGiyim', 'AyakkabiAksesuar'] },
    ...Object.fromEntries(clothingFields.map(field => [field, { type: 'STRING' }])),
  },
  required: ['mainCategory', ...clothingFields],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    if (env.APP_SHARED_SECRET && request.headers.get('X-App-Secret') !== env.APP_SHARED_SECRET) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
      if (request.method !== 'POST') return jsonResponse({ error: 'Not found' }, 404);
      if (url.pathname === '/gemini') return await handleGemini(request, env);
      if (url.pathname === '/removebg') return await handleRemoveBg(request, env);
      return jsonResponse({ error: 'Not found' }, 404);
    } catch {
      return jsonResponse({ error: 'İstek işlenemedi.', code: 'INVALID_REQUEST' }, 400);
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
    'Access-Control-Expose-Headers': 'X-Aura-Model, Server-Timing',
  };
}

function jsonResponse(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extra },
  });
}

export async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: { message: `Upstream HTTP ${response.status}` } }; }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleGemini(request, env) {
  if (!env.GEMINI_API_KEY) return jsonResponse({ error: 'AI yapılandırması eksik.', code: 'AI_NOT_CONFIGURED' }, 503);
  const body = await request.json();
  if (!Array.isArray(body.parts) || !body.parts.length) return jsonResponse({ error: 'Fotoğraf veya mesaj gerekli.' }, 400);
  const fastPhoto = body.task === 'wardrobe';
  const models = fastPhoto ? PHOTO_MODELS : MODELS;
  const config = {
    maxOutputTokens: fastPhoto ? 1024 : 2048,
    ...body.generationConfig,
    thinkingConfig: body.generationConfig?.thinkingConfig || { thinkingLevel: fastPhoto ? 'minimal' : 'low' },
    ...(fastPhoto ? { responseMimeType: 'application/json', responseSchema: clothingSchema } : {}),
  };
  let failure = { status: 502, code: 'AI_UNAVAILABLE' };
  const started = Date.now();
  for (const model of models) {
    const attemptStarted = Date.now();
    try {
      const { response, data } = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ parts: body.parts }], generationConfig: config }),
        },
        12000,
      );
      console.info(JSON.stringify({ event: 'ai_attempt', model, status: response.status, ms: Date.now() - attemptStarted }));
      if (response.ok) {
        const text = data?.candidates?.[0]?.content?.parts?.filter(part => !part.thought && part.text).map(part => part.text).join('');
        if (!text) return jsonResponse({ error: 'AI kullanılabilir bir yanıt üretemedi.', code: 'AI_EMPTY_RESPONSE' }, 502);
        data.candidates[0].content.parts = [{ text }];
        return jsonResponse(data, 200, { 'X-Aura-Model': model, 'Server-Timing': `ai;dur=${Date.now() - started}` });
      }
      failure = { status: response.status === 429 ? 429 : 502, code: response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE' };
      if ([400, 401, 403].includes(response.status)) {
        return jsonResponse({ error: 'AI isteği veya servis erişimi reddedildi.', code: 'AI_REQUEST_REJECTED', upstreamStatus: response.status }, 502);
      }
    } catch (error) {
      failure = { status: error.name === 'AbortError' ? 504 : 502, code: error.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE' };
      console.info(JSON.stringify({ event: 'ai_attempt', model, status: failure.code, ms: Date.now() - attemptStarted }));
    }
  }
  return jsonResponse({
    error: failure.code === 'AI_RATE_LIMITED' ? 'AI kullanım sınırına ulaşıldı. Biraz sonra tekrar dene.' : 'AI servisi zamanında yanıt vermedi. Lütfen tekrar dene.',
    code: failure.code, retryable: true,
  }, failure.status);
}

export async function handleRemoveBg(request, env) {
  if (!env.BG_REMOVAL_URL) return jsonResponse({ error: 'Arka plan servisi yapılandırılmadı.' }, 503);
  const body = await request.json();
  try {
    const { response, data } = await fetchJson(`${env.BG_REMOVAL_URL}/removebg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(env.BG_REMOVAL_SECRET ? { 'X-Proxy-Secret': env.BG_REMOVAL_SECRET } : {}) },
      body: JSON.stringify({ image_file_b64: body.image_file_b64 }),
    }, 10000);
    if (!response.ok) return jsonResponse({ error: 'Arka plan servisi şu anda kullanılamıyor.' }, response.status);
    return jsonResponse(data);
  } catch {
    return jsonResponse({ error: 'Arka plan servisi zamanında yanıt vermedi.' }, 504);
  }
}
