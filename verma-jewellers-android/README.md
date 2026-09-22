# Verma Jewellers Rates (Android)

A fully offline native app: the rates page (admin panel, olive/gold
theme, EN/HI/PA language switcher) ships bundled inside the APK as
`app/src/main/assets/index.html` and is loaded from disk, never from
a server. No sign-in, no account, no network permission at all —
`MainActivity.kt` is just a WebView pointed at
`file:///android_asset/index.html`.

## How rates get set

There's no visible admin button — **tap the header crest logo 4 times**
within about 1.5 seconds to open it (a secret entry point, not a public
button). Create a 4-digit PIN on first use, then enter today's market
rate + your margin for gold and, optionally, silver. Everything — the
PIN, the margin, the final rate, and any stock photos — is saved in
this WebView's own local storage, **on this device only**. There's no
sync between phones: if you want the same rate showing on a second
device (say, a customer-facing tablet at the counter), you set it
there separately, or just use one device as the shop's rate display.

Two more admin options:
- **Show silver rate to customers** — uncheck to display gold only.
- **Stock photos** — up to 2 photos from the phone's gallery/camera,
  shown below the rates. Resized/compressed client-side (max ~900px,
  JPEG) before being stored, so it stays well within localStorage's
  per-origin size limit.

## Why this doesn't build here

Same reason as the other Android projects in this repo: this sandbox
has no Android SDK and can't reach `dl.google.com`. A CI workflow
(`.github/workflows/verma-jewellers-apk.yml`) builds it on GitHub's
own runners and publishes `app-debug.apk` as a GitHub release asset.

## Local build

Open this folder in Android Studio, or `./gradlew assembleDebug` from
a machine with the Android SDK. minSdk 24 (Android 7.0+). This is a
**debug build** — fine for sideloading, not signed for the Play Store.

## Editing the page

The page's source lives in `app/src/main/assets/index.html` — edit it
directly and rebuild; there's no separate template to keep in sync
since this version doesn't publish itself anywhere (that self-publish
machinery is specific to the web version hosted as a Claude Artifact,
which is a separate, optional thing — see the top-level chat history
for that link if you still want a shareable web version too).
