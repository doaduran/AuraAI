# AuraAI

Gemini ile kıyafet analizi/kombin önerisi yapan, dolabınızı yönetmenizi sağlayan Türkçe/İngilizce
Expo/React Native uygulaması.

## Proje yapısı

- `mobile/`: Expo uygulaması ve Cloudflare'a yayımlanan web sürümünün kaynakları.
- `worker/`: Gemini ve arka plan silme servisine istek gönderen Cloudflare Worker.
- `backend/`: Arka plan silme servisi.

Uygulamanın tek kaynak konumu `mobile/` klasörüdür. `App.js`, `package.json` ve testler depo köküne ayrıca kopyalanmamalıdır.

## Uygulamayı çalıştırma

```bash
cd mobile
npm install
cp .env.example .env   # sonra .env içine gerçek değerlerini gir
npm start
```

`.env` içindeki `EXPO_PUBLIC_APP_SECRET`, worker'da (`../worker`) `wrangler secret put
APP_SHARED_SECRET` ile ayarladığın değerle **aynı** olmalı. İkisi de boş bırakılırsa uygulama yine
çalışır, sadece worker herkese açık kalır (bkz. `../worker/README.md`).

Web geliştirme için `npm run web`, testler için `npm test`, yayımlanacak dosyalar için `npm run build:web` kullanılır. Cloudflare'a `mobile/dist` klasörünün içindekiler yüklenir; `dist` ve `node_modules` GitHub'a yüklenmez.

## Notlar

- Arka plan silme ve Gemini istekleri hiçbir zaman doğrudan Google/servis API'lerine gitmez,
  hepsi `../worker` altındaki Cloudflare Worker proxy üzerinden yönlendirilir — API anahtarları
  uygulama paketine hiç gömülmez.
- `app.json` içindeki `bundleIdentifier`/`package` (`com.seninadin.aura`) ve
  `extra.eas.projectId` yer tutuculardır, kendi Expo/Apple/Google hesap bilgilerinle değiştir.
