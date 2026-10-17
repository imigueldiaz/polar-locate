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
- Astronomy math lives in `src/lib/astro.ts` (`astronomy-engine`, pure JS): `computeSky()` (Polaris alt/az, true pole, drift + position angle, LST), `driftTangent()` (unit vector along Polaris' apparent motion, from the 1 h chord of its orbit, for the reticle's drift arrow) and `darkness()` (astronomical twilight window). `selfCheck()` there is assert-based and runs under `npm test`.
- Pointing math lives in `src/lib/pointing.ts` (pure): `attitude()` derives camera az/alt + screen roll from accelerometer (`-g` = up) + magnetometer; plus `errorToPole()` and `skyToScreen()`. `selfCheck()` is assert-based — run it with `node --input-type=module -e "import('./src/lib/pointing.ts').then(m=>m.selfCheck())"`.
- `src/hooks/usePointing.ts` subscribes `expo-sensors` Accelerometer + Magnetometer (EMA-smoothed); `src/components/Reticle.tsx` draws the SVG reticle rotated by roll, plus the Polaris orbit ring, the tolerance ring, the tangential drift arrow and the big correction arrow (`correction`, in screen axes, so it lands exactly on the pole ring; `labels` gates the captions).
- Guidance words live in `src/lib/voice.ts` (pure, no `expo-speech`/`react-native` import, so node can load it from selfcheck): `phraseFor(fix, words)` picks the dominant axis and appends `fast`/`slow` from `mag/tol`; `allowSpeak(nowMs, say, st)` throttles to 2.5 s to change phrase, 6 s to repeat it. `App.tsx` speaks it with `expo-speech` when `prefs.voice`, and fires a `Success` haptic on the locked edge. **Frame rule: the words/voice are instructions for the mount (up = raise the altitude, right = east, straight from `errorToPole`), so they must NOT rotate with roll — rotating the phone in the shoe does not change how the mount moves; only the drawn arrow is rotated.** The CV branch's `dx/dy` are image axes (unverified on device: `PolarCameraView` mounts `ImageAnalysis` without `setTargetRotation`), so its words/arrow are the one piece that may disagree with the sensors.
- `fix` is `{up, right, mag, cv, locked, tol}`; the tolerance travels inside `fix` because its unit differs per branch (degrees in the sensor branches, reticle-radius fractions in CV via `starTrack.tolFrac`) — so ring, voice and lock can never disagree. `expo-haptics` intensity encodes urgency (`mag/tol`: Heavy > 6, Medium > 2, else Light) and the touch count the sign along the dominant axis.
- Live camera overlay uses the local native module `modules/polar-camera` (CameraX `PreviewView` via `PolarCameraView`) rendered behind the reticle: `listLensesAsync()` enumerates cameras (id, facing, focal lengths, ISO range, exposure range, min focus distance), `takePictureAsync()` resolves a JPEG path in the app cache, `lensId` selects a camera by Camera2 id and `zoom` is a CameraX ratio (1–8). Digital zoom only.
- Star CV (M4) runs on **real-time analysis frames** from the module (`ImageAnalysis` + `STRATEGY_KEEP_ONLY_LATEST`, ~5 fps, grayscale ≤320 px, emitted as base64 `onFrame` events): `src/hooks/useStarTrack.ts` uses the first `calibFrames` frames as the calibration burst and then a rolling `STACK`-frame average into `src/lib/detect.ts` `brightestBlobs()` → offset from centre drives haptics + a screen dot + tolerance lock. The optional JPEG record (`saveFrames`) still uses `PolarCamera.takePictureAsync()` + `expo-image-manipulator`; the per-tick `jpeg-js` decode is gone.
- Astrometry (M4.5): `src/lib/astrometry.ts` `solvePointing()` does a local ICP match of detected blobs vs predicted catalog stars → Δaz/Δalt + true plate scale, removing the magnetometer dependence; `src/lib/field.ts` `ofDateCatalog()` precesses J2000→of-date via astronomy-engine `Rotation_EQJ_EQD` and `predictField()` filters to the FOV; `src/hooks/useAstrometry.ts` runs once per camera tick. Corrected attitude overrides sensor azimuth, and predicted stars render through `Reticle`'s `field` prop. `src/lib/catalog.ts` is generated (HYG v4.1, mag≤6.5, 8920 stars, ~189 KB, CC BY-SA) — regenerate with `node scripts/build-catalog.mjs`. The plate scale starts from the `pxPerDeg` pref (0 = auto) and is replaced by the astrometry fit; the old EXIF seed is gone (the native module returns no EXIF).
- Caveat: azimuth comes from the magnetometer → unreliable near the mount/metal. Roll + altitude (gravity-only) are reliable; the M4 star CV adds visual centring that bypasses the magnetometer.

## Commands

Lockfile is `package-lock.json` → use **npm/npx** (not bun).

```bash
npx expo install <package>  # ALWAYS use instead of npm install — resolves SDK-compatible versions
npx expo start              # dev server (test in Expo Go)
npx tsc --noEmit            # typecheck  (= npm run typecheck)
npx expo lint               # lint       (= npm run lint)
npm test                    # self-checks of the astro/pointing/voice/CV math (scripts/selfcheck.mjs)
npx expo-doctor             # diagnose dependency / config issues
npx expo install --fix      # fix incompatible package versions

npx expo prebuild -p android        # (re)generate android/ (CNG, gitignored) after config/module changes
npm run android                     # expo run:android — native build + install on the device over adb
```

For the local Gradle build, `JAVA_HOME` and `ANDROID_HOME` must be exported in the shell (see **Native toolchain**).

Run typecheck and lint before declaring any task done. CI (`.github/workflows/ci.yml`) runs typecheck + lint + `npm test` + expo-doctor; CodeQL (`.github/workflows/codeql.yml`) does code scanning; Dependabot (`.github/dependabot.yml`) keeps deps/actions fresh; `release.yml` builds the APK on the runner with `eas build --local` (no cloud build quota; it installs the NDK itself with `sdkmanager`) and attaches it to a GitHub Release on `v*` tags (needs the `EXPO_TOKEN` Actions secret). The tag **must start with `v`** (`v1.0.1`, not `1.0.1`) or it won't trigger; publish with `git tag -s v1.0.1 -m "Release v1.0.1" && git push origin v1.0.1` (or Actions → Run workflow).

## Native toolchain (local Android builds)

Only needed to build or patch the native side locally (a custom module under `modules/`, `android/` tuning). The cloud EAS build needs none of it. Installed **per-user** here (no admin, no Android Studio):

| Piece | Version | Location |
|---|---|---|
| JDK (Temurin, LTS) | 17.0.20.1+1 | `%LOCALAPPDATA%\jdk\jdk-17.0.20.1+1` → `JAVA_HOME` |
| cmdline-tools (`sdkmanager`) | 13114758 | `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest` → `ANDROID_HOME` / `ANDROID_SDK_ROOT` |
| platform-tools (`adb`) | 37.0.1 | SDK root |
| platforms / build-tools | android-36 / 36.0.0 | SDK root |
| NDK / cmake | 27.1.12297006 / 3.22.1 | SDK root |

Version source of truth is `node_modules/react-native/gradle/libs.versions.toml` (RN 0.86.3): `minSdk 24`, `compileSdk`/`targetSdk 36`, `buildTools 36.0.0`, `ndkVersion 27.1.12297006`, AGP 8.12, Kotlin 2.1.20. Install/add packages with matching pins (`sdkmanager` needs `JAVA_HOME`; run from git-bash with `cmd //c`):

```bash
cd "$LOCALAPPDATA/Android/Sdk/cmdline-tools/latest/bin"
export JAVA_HOME="C:/Users/imigu/AppData/Local/jdk/jdk-17.0.20.1+1"
cmd //c sdkmanager.bat "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" "platform-tools"
yes | cmd //c sdkmanager.bat --licenses
```

Local build (git-bash: `cmd //c` because `gradlew.bat` is a batch file; `setx` only affects **new** shells, so export inline):

```bash
cd android
export JAVA_HOME="C:/Users/imigu/AppData/Local/jdk/jdk-17.0.20.1+1"
export ANDROID_HOME="C:/Users/imigu/AppData/Local/Android/Sdk"
cmd //c gradlew.bat :app:assembleDebug --console=plain   # → android/app/build/outputs/apk/debug/app-debug.apk
```

First (cold) build ≈ 8 min (Gradle distribution + Maven deps + NDK/cmake C++ + Kotlin); later builds are incremental. Replacing the ~7-min cloud loop with this is the point.

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

- **No Expo Go any more.** Since the camera moved into `modules/polar-camera` (a local native module), the app runs only in a **development build** / APK: `npm run android` (`expo run:android`) with the phone on USB, or `eas build --profile development`. Expo Go loads bundled modules only, and `polar-camera` is not one.
- The app runs in a **development build / APK**, not Expo Go: `npm run android` (`expo run:android`) builds and installs it on the phone; for JS-only iteration run `npx expo start` and open the installed app. EAS dev-client builds additionally need `npx expo install expo-dev-client` first `eas build --profile development`.
- Android gives no manual camera control through stock JS camera libraries: `expo-camera` cannot select a physical lens (only `facing` + `zoom`), and `react-native-vision-camera@5.2.3` **throws** on Android for manual exposure/focus/WB locks (`setExposureLocked`/`setFocusLocked`/`setWhiteBalanceLocked` are iOS-only there; their getters return a hardcoded `0.0`) — only `setExposureBias` and AE/AF/AWB metering locks work. Hence the own module: `modules/polar-camera` over CameraX, with Camera2 (`Camera2CameraControl`) for the manual keys (`getPhysicalCameraIds`, `SENSOR_SENSITIVITY`, `SENSOR_EXPOSURE_TIME`, `LENS_FOCUS_DISTANCE=0`, `CONTROL_AF_MODE_OFF`).
- `expo-camera` is **gone** (removed from `package.json` + `app.json` plugins); the camera lives only in `modules/polar-camera`, so **every camera change needs a native rebuild** (`npx expo prebuild -p android` after config/module changes, then `npm run android`). JS-only changes still go out over OTA.
- Never create or edit `ios/` / `android/` by hand — they are generated (CNG). Configure native behavior in `app.json` and config plugins.
- Local debug APKs carry `versionCode 1` (EAS `appVersionSource: "remote"` keeps the release number server-side), so `adb install -r` over an EAS release fails with `INSTALL_FAILED_VERSION_DOWNGRADE`; `adb uninstall org.polarlocate` first (that wipes the app's private prefs/JPEGs) or build with EAS instead. A debug build loads JS from Metro, so `adb reverse tcp:8081 tcp:8081` is required or it red-boxes with "Unable to load script".
- `npx expo run:android --device` wants the device *name/model* (`SM_S937B`), not the adb serial.
