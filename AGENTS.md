# polar-locate

Android-first (ships as APK; iOS optional) astrophotography helper. It shows GPS + local time
and a red night-vision theme, draws a polar-alignment reticle, and guides the
user — via phone sensors, the camera, and haptics — to aim a phone mounted on a
DSLR hot shoe (camera on a GTi tracker) at the celestial pole. Expo / React
Native + TypeScript.

**Docs:** the user-facing `README.md` (Spanish) documents every feature. Keep it
up to date in the SAME change whenever you add or alter an app feature — update
'¿Qué hace?', 'Cómo funciona', the 'Estado del proyecto' M-table, and
'Privacidad' as applicable.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`. Current: **SDK 57** (`expo ~57`), React 19.2, React Native 0.86.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v57.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Architecture (actual)

- **No expo-router.** This is the `blank-typescript` template: entry is `index.ts` → `App.tsx`. Keep non-screen code under `src/` (`src/i18n`, `src/lib`, `src/theme.ts`). If navigation is ever needed, prefer adding Expo Router then — not before.
- `App.tsx` is the single screen: corner readout (GPS/time/drift), centered SVG reticle (`react-native-svg`), camera on/off toggle.
- i18n lives in `src/i18n` (`expo-localization` + `i18n-js`). Only `es` exists; add locales by extending `src/i18n/index.ts`.
- Astronomy math lives in `src/lib/astro.ts` (`astronomy-engine`, pure JS): `computeSky()` (Polaris alt/az, true pole, drift + position angle, LST) and `darkness()` (astronomical twilight window).
- Pointing math lives in `src/lib/pointing.ts` (pure): `attitude()` derives camera az/alt + screen roll from accelerometer (`-g` = up) + magnetometer; plus `errorToPole()` and `skyToScreen()`. `selfCheck()` is assert-based — run it with `node --input-type=module -e "import('./src/lib/pointing.ts').then(m=>m.selfCheck())"`.
- `src/hooks/usePointing.ts` subscribes `expo-sensors` Accelerometer + Magnetometer (EMA-smoothed); `src/components/Reticle.tsx` draws the SVG reticle rotated by roll. `expo-haptics` ticks encode the correction direction.
- Live camera overlay uses `expo-camera` `CameraView` (`facing:"back"`, `zoom` 0–1, `active`) rendered behind the reticle; digital zoom only (Android can't pick a physical lens with `expo-camera`).
- Star CV (M4) runs in **Expo Go via still-image polling**, NOT VisionCamera frame processors (those need a dev build and risk SDK 57 / RN 0.86 New-Arch). `src/hooks/useStarTrack.ts` every ~1.1 s: `takePictureAsync` → `expo-image-manipulator` resize to 240 px + `base64` → `base64-js` → `jpeg-js.decode(bytes,{useTArray:true,formatAsRGBA:true})` → `src/lib/detect.ts` `brightestBlob()` → offset from centre drives haptics + a screen dot + tolerance lock. VisionCamera is the real-time upgrade path.
- Astrometry (M4.5): `src/lib/astrometry.ts` `solvePointing()` does a local ICP match of detected blobs vs predicted catalog stars → Δaz/Δalt + true plate scale, removing the magnetometer dependence; `src/lib/field.ts` `ofDateCatalog()` precesses J2000→of-date via astronomy-engine `Rotation_EQJ_EQD` and `predictField()` filters to the FOV; `src/hooks/useAstrometry.ts` runs once per camera tick. Corrected attitude overrides sensor azimuth, and predicted stars render through `Reticle`'s `field` prop. `src/lib/catalog.ts` is generated (HYG v4.1, mag≤6.5, 8920 stars, ~189 KB, CC BY-SA) — regenerate with `node scripts/build-catalog.mjs`. `useStarTrack` reads EXIF `FocalLengthIn35mmFilm` once to seed the plate scale (`astrometry.pxPerDegFromF35`), falling back to a default.
- Caveat: azimuth comes from the magnetometer → unreliable near the mount/metal. Roll + altitude (gravity-only) are reliable; the M4 star CV adds visual centring that bypasses the magnetometer.

## Commands

Lockfile is `package-lock.json` → use **npm/npx** (not bun).

```bash
npx expo install <package>  # ALWAYS use instead of npm install — resolves SDK-compatible versions
npx expo start              # dev server (test in Expo Go)
npx tsc --noEmit            # typecheck  (= npm run typecheck)
npx expo lint               # lint       (= npm run lint)
npm test                    # self-checks of the astro/pointing/CV math (scripts/selfcheck.mjs)
npx expo-doctor             # diagnose dependency / config issues
npx expo install --fix      # fix incompatible package versions
```

Run typecheck and lint before declaring any task done. CI (`.github/workflows/ci.yml`) runs typecheck + lint + `npm test` + expo-doctor; CodeQL (`.github/workflows/codeql.yml`) does code scanning; Dependabot (`.github/dependabot.yml`) keeps deps/actions fresh; `release.yml` builds the APK with EAS and attaches it to a GitHub Release on `v*` tags (needs the `EXPO_TOKEN` Actions secret). The tag **must start with `v`** (`v1.0.1`, not `1.0.1`) or it won't trigger; publish with `git tag -s v1.0.1 -m "Release v1.0.1" && git push origin v1.0.1` (or Actions → Run workflow).

## Building / distribution

- Primary deliverable is an **Android APK**. iOS is **optional**/secondary (needs an Apple Developer account; EAS handles certs).
- EAS config is in `eas.json`: `preview` = Android **APK** + internal distribution (the deliverable, now with `autoIncrement`); `production` = store build with `autoIncrement`; `development` = dev client (needs `npx expo install expo-dev-client` first). Each profile carries a `channel` (`preview`/`production`/`development`).
- APK size: `expo-build-properties` (`app.json` plugins) pins `android.buildArchs: ["arm64-v8a"]`, so the `preview` APK is **arm64-only** (~half the size; the universal one duped `.so` across armv7/x86/x86_64). Add `"armeabi-v7a"` back for 32-bit-only devices; the `production` **AAB** is unaffected (Play splits ABIs itself).
- OTA: `expo-updates` is installed; `app.json` sets `updates.url` (`https://u.expo.dev/<projectId>`) and `runtimeVersion {policy:'appVersion'}`. Publish JS-only changes with `npx eas-cli@latest update --branch preview` — reaches only builds that already embed expo-updates; native changes need a new build.
- **Version alignment (EAS ↔ git tag).** `eas.json` uses `appVersionSource: "remote"` → EAS stores `versionCode` server-side and `autoIncrement` bumps it on every build (don't hand-edit it); the marketing `version` (versionName) comes from `app.json` `version`. To release, bump `app.json` `version` to match the tag (`1.0.2` ⟷ `v1.0.2`) and commit, then the `v*` tag builds it. `runtimeVersion {policy:'appVersion'}` follows that same `version`, so bumping it starts a new OTA runtime (older installs need the new APK). Inspect the remote build number with `npx eas-cli@latest build:version:get -p android`.
- App identifiers are `org.polarlocate` (`android.package` / `ios.bundleIdentifier`). Change before any store publish.
- Build in the cloud with EAS — no local Android Studio / Xcode needed:
  - APK: `npx eas-cli@latest build -p android --profile preview`
  - iOS (optional, ad-hoc): `npx eas-cli@latest build -p ios --profile preview` (needs the Apple account; register device UDIDs for internal distribution).
- `eas login` required once. Docs: https://docs.expo.dev/eas/index.md

## Environment gotchas

- **Expo Go** runs the bundled native modules only. `expo-location`, `expo-sensors`, `expo-camera`, `expo-haptics`, `expo-localization`, `react-native-svg` all work in Expo Go.
- The whole app runs in **Expo Go** (location, sensors, camera, haptics, i18n, svg, and the M4/M4.5 CV + astrometry still-image pipeline). A real-time `react-native-vision-camera` upgrade, or a native camera-calibration module, would need a **development build** (`eas build --profile development`, after `npx expo install expo-dev-client`).
- On Android, `expo-camera` cannot select a physical lens (only `facing` + `zoom`); telephoto selection needs `react-native-vision-camera` (`getAvailableCameraDevices().physicalDevices`).
- Never create or edit `ios/` / `android/` by hand — they are generated (CNG). Configure native behavior in `app.json` and config plugins.
