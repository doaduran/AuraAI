# Aura – API Proxy (Cloudflare Worker)

Mobil uygulamanın kullandığı Gemini ve arka plan silme servislerine giden istekleri karşılayan,
API anahtarlarını uygulamanın dışında tutan proxy.

## Kurulum

```bash
npm install
```

## Gerekli secret'lar

Bunlar `wrangler.toml`'a değil, Cloudflare'in kendi şifreli secret sistemine yazılır:

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put APP_SHARED_SECRET   # mobil app ile paylaşılan, isteğe bağlı ama önerilir
wrangler secret put BG_REMOVAL_SECRET   # removebg servisindeki PROXY_SECRET ile aynı olmalı, opsiyonel
```

`APP_SHARED_SECRET` set edilmezse worker herkese açık kalır (yerel test için pratik, production için
önerilmez). Set edersen, mobil taraftaki `.env` dosyasına aynı değeri `EXPO_PUBLIC_APP_SECRET` olarak
yazman gerekir — bkz. `mobile/README.md`.

## Geliştirme / Deploy

```bash
npm run dev      # yerel test
npm run deploy    # Cloudflare'e deploy
```

## Endpoint'ler

- `POST /gemini` — `{ parts, generationConfig }` → Gemini API yanıtını döner
- `POST /removebg` — `{ image_file_b64 }` → arka planı silinmiş görselin base64'ünü döner
