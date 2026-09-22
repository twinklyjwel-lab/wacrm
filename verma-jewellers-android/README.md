# Verma Jewellers Rates (Android)

A thin native app shell that opens the published rates page — a Claude
Artifact — full-screen in a WebView, so it installs as an app icon
instead of a browser bookmark. All the actual logic (rates, admin
panel, language switching) lives in that page; this project only wraps
it: `app/src/main/java/com/vermajewellers/rates/MainActivity.kt`.

Rates page: https://claude.ai/artifact/879yU5PP7Ki1if13Uqw59S

## Before this is usable by customers

The artifact is **private** by default (only its owner can open it).
Open the link above → **Share** → set it to "Anyone with the link can
view" so customers (who won't be signed into a Claude account) can see
it. Keep **edit** access limited to whoever should be allowed to change
rates — anyone without edit access gets a clear "can't publish" message
if they try the admin panel, they just can't actually save.

The **first time** the shop owner opens the app, they'll likely need to
sign in to claude.ai once inside the WebView before the admin "Save &
publish" button works (view-only browsing doesn't require it if the
artifact is shared as above). The WebView keeps that login on-device
after that, same as a browser would.

## Why this doesn't build here

Same reason as the sibling `gold-silver-rates-android/` project: this
sandbox has no Android SDK and can't reach `dl.google.com`. A CI
workflow (`.github/workflows/verma-jewellers-apk.yml`) builds it on
GitHub's own runners instead and publishes `app-debug.apk` as a GitHub
release asset (Actions artifacts sit on Azure Blob Storage, which some
networks block outright — a release asset is reachable far more
broadly).

## Local build

Open this folder in Android Studio, or from a machine with the Android
SDK: `./gradlew assembleDebug`. minSdk 24 (Android 7.0+). This is a
**debug build** — fine for sideloading, not signed for the Play Store.

## Updating the URL

If the rates page ever moves to a different artifact URL, it's the one
line in `MainActivity.kt` (`ratesUrl`) — rebuild and redistribute the
APK after changing it.
