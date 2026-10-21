# Aura – AI Stilist (Mobil Uygulama)

Gemini ile kıyafet analizi/kombin önerisi yapan, dolabınızı yönetmenizi sağlayan Türkçe/İngilizce
Expo/React Native uygulaması.

## Kurulum

```bash
npm install
cp .env.example .env   # sonra .env içine gerçek değerlerini gir
npm start
```

`.env` içindeki `EXPO_PUBLIC_APP_SECRET`, worker'da (`../worker`) `wrangler secret put
APP_SHARED_SECRET` ile ayarladığın değerle **aynı** olmalı. İkisi de boş bırakılırsa uygulama yine
çalışır, sadece worker herkese açık kalır (bkz. `../worker/README.md`).

## Notlar

- Arka plan silme ve Gemini istekleri hiçbir zaman doğrudan Google/servis API'lerine gitmez,
  hepsi `../worker` altındaki Cloudflare Worker proxy üzerinden yönlendirilir — API anahtarları
  uygulama paketine hiç gömülmez.
- `app.json` içindeki `bundleIdentifier`/`package` (`com.seninadin.aura`) ve
  `extra.eas.projectId` yer tutuculardır, kendi Expo/Apple/Google hesap bilgilerinle değiştir.
