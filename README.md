# AuraAI

**Your wardrobe. Your style. Your next outfit.**

A mobile-first AI wardrobe and personal styling app built with Expo and React Native, with a browser demo hosted on Cloudflare. Add your clothes, discover your style, and explore outfit ideas using pieces you already own.

**[Open the live demo →](https://shrill-dawn-2c7b.aura-closet.workers.dev/)** · [Screenshots](#screenshots) · [Features](#features) · [Quick start](#quick-start)

## Screenshots

### Explore a look, then make it your own

Browse outfit photos, filter by style, and ask Aura to match a reference image with clean items from your wardrobe. You can also select your own inspiration photo.

![AuraAI inspiration gallery with outfit photographs, source credits, and wardrobe matching buttons](docs/images/inspiration.png)

<table>
  <tr>
    <th>Home & color palette</th>
    <th>Your style profile</th>
  </tr>
  <tr>
    <td><img src="docs/images/home.png" alt="AuraAI home screen with the style quiz, daily outfit area, and sample color palette" width="460"></td>
    <td><img src="docs/images/style-profile.png" alt="Example result from the five-question style test, showing primary and secondary styles and saved preferences" width="460"></td>
  </tr>
</table>

Screenshots show the actual application with its Turkish interface. The app also supports English. The home screen shows an empty wardrobe and a sample palette; the profile result uses demonstration answers.

## Try the demo

1. Open **[AuraAI](https://shrill-dawn-2c7b.aura-closet.workers.dev/)** in your browser.
2. Tap **Stilini Bul / Find Your Style** and answer five questions to create your profile.
3. Open **Dolap / Closet** to add a clothing photo from your camera or gallery.
4. Explore **İlham / Explore** to browse looks and match one with your wardrobe.

Camera behavior depends on your device and browser; desktop browsers may open a file picker. AI features require the backend services to be available.

## Features

- **Digital wardrobe:** add clothing photos, analyze their category, color, style and pattern, and organize favorites and laundry status.
- **Five-question style profile:** record your aesthetic, fit, color preferences, usual occasions and outfit priorities. The profile includes primary and secondary styles and informs outfit suggestions and stylist chat.
- **AI outfit suggestions:** combine clean wardrobe items using your profile, weather context and favorites. Returned item IDs are checked against the available wardrobe.
- **Photo inspiration:** browse a credited Unsplash selection or select your own reference photo for visual matching. Pinterest opens an external search; the gallery is not a live Pinterest feed.
- **Selfie color suggestions:** request an approximate palette based on a selfie. The initial palette is a sample, and lighting and camera settings affect the analysis.
- **Outfit boards and planning:** save looks to boards and plan outfits for the week.
- **Turkish and English:** switch the application language and keep your wardrobe and preferences on the current device/browser.

## Built with

| Layer | Technology |
| --- | --- |
| App & web interface | Expo, React Native, React Native Web, React |
| Styling assistance | Gemini through a Cloudflare Worker proxy |
| Photo selection | Expo ImagePicker |
| Local storage | AsyncStorage |
| Background removal | FastAPI, ONNX Runtime, U²-Net |
| Web hosting | Cloudflare |

## Quick start

Tested with Node.js 24 and npm.

```bash
git clone https://github.com/doaduran/AuraAI.git
cd AuraAI/mobile
npm install
npm run web
```

For Expo Go or a native development workflow, run `npm start` instead.

For your own backend deployment, set `EXPO_PUBLIC_PROXY_URL` in `mobile/.env` to your Worker URL and configure the Worker and background removal service using their setup guides below. Gemini credentials belong in the Worker configuration, not in the frontend.

### Checks and web export

Run these commands inside `mobile/`:

```bash
npm test
npm run build:web
```

The current suite has 21 automated tests, including all 1,536 possible style-test answer combinations, photo selection, AI response handling and wardrobe item validation.

For the current manual Cloudflare deployment, upload the **contents** of `mobile/dist/`: `_expo/`, `index.html` and `metadata.json`.

## Repository structure

| Path | Purpose |
| --- | --- |
| [`mobile/`](mobile/) | Application source, style test and tests |
| [`worker/`](worker/) | Cloudflare proxy for Gemini and background removal; [setup](worker/README.md) |
| [`backend/`](backend/) | Background removal service; [setup](backend/README.md) |
| [`docs/images/`](docs/images/) | Application screenshots used in this README |

Application files live under `mobile/`. Generated exports and dependencies are excluded from Git.

## Project status

AuraAI is an evolving prototype. The interface and automated checks have been verified, while recommendation quality still needs evaluation with real wardrobes and photos. AI requests may be unavailable when the upstream model is busy or rate limited. A personal style profile is calculated from explicit questionnaire answers; it is not a separately trained model.

The inspiration gallery uses Unsplash photos with photographer/source links in the app. Photo credits are visible in the gallery screenshot above.

## License

[MIT](LICENSE)
