# Gold & Silver Rates (Android)

A native Android app (Kotlin + Jetpack Compose) that shows live gold and
silver spot prices — per gram at common karat/fineness grades, per
kilogram, and per troy ounce — with manual + auto-refresh (every 5 min)
and an offline cache so the last known rate still shows if the network
call fails.

This is a standalone Gradle project, independent of the Next.js CRM at
the repo root — it doesn't touch or depend on that codebase.

## API: free, no signup required

Uses **[gold-api.com](https://gold-api.com)** — `GET
https://api.gold-api.com/price/{symbol}` (`XAU` for gold, `XAG` for
silver). No API key, no rate limit advertised, USD only. This was picked
over key-gated options (GoldAPI.io, metals-api.com, metalpriceapi.com,
metals.dev — all free-tier but require signup and cap out around
50–100 requests/month) so the app works the moment it's installed, with
nothing to configure.

The API only reports the raw spot price per troy ounce. Per-gram prices
at each karat/fineness (24K, 22K, 18K for gold; fine/sterling for
silver) are computed client-side in `MetalRate.kt` using the standard
purity fractions — the same math jewellers use to quote rates from a
spot price, not something the API needs to provide.

> This sandbox's network policy couldn't reach gold-api.com to confirm
> the live response byte-for-byte, so the DTO in
> `data/model/MetalRateResponse.kt` only relies on the one field
> (`price`) that's virtually certain to be named that in any price API.
> If a real request comes back shaped differently, that's the only file
> that needs fixing.

**Trade-off:** USD only, no 24h change %, since that's what a keyless
API gives you. If you want INR/other currencies and karat prices
straight from the API, swap in GoldAPI.io — see "Swapping providers"
below.

## Why this doesn't build here

This session runs in a sandboxed container with no Android SDK and no
network access to `dl.google.com` (the host that serves Android SDK
platforms/build-tools and mirrors Google's Maven artifacts). Both are
required to compile an Android app, so a CI workflow
(`.github/workflows/android-debug-apk.yml`) builds the debug APK on
GitHub's own runners instead, which ship with the Android SDK
preinstalled.

## Get the APK

- **From CI**: check the "Android Debug APK" workflow run for this
  branch/PR — the built `app-debug.apk` is attached as a workflow
  artifact.
- **Build locally**: open this folder in Android Studio (Koala/Ladybug
  or newer) — it fetches the SDK + dependencies automatically — and run
  on a device/emulator (minSdk 24 / Android 7.0+), or `./gradlew
  assembleDebug` from a machine with the Android SDK installed.

This is a **debug build**, fine for sideloading to try it out, but not
signed for release/Play Store distribution.

## Swapping providers

Only two files define the API contract:
`data/GoldApiService.kt` (endpoint) and
`data/model/MetalRateResponse.kt` (JSON shape) — the repository,
ViewModel, and UI don't know or care which provider is behind them.
To move to GoldAPI.io for multi-currency + native karat fields, you'd
also re-add an API key (their free tier requires signup) via
`local.properties` and a `buildConfigField`.

## Project structure

```
app/src/main/java/com/twinklyjewels/goldsilverrates/
  MainActivity.kt              # single-activity host, sets up Compose content
  data/
    GoldApiService.kt          # Retrofit interface
    NetworkModule.kt           # OkHttp + Retrofit singleton
    RatesRepository.kt         # fetch + SharedPreferences cache/fallback
    model/
      MetalRate.kt             # domain model + karat/fineness math
      MetalRateResponse.kt     # raw API response DTO
  ui/
    RatesViewModel.kt          # polling loop, refresh
    RatesUiState.kt            # Loading / Success / Error
    screen/RatesScreen.kt      # Compose UI
    theme/                     # Material3 theme (gold/silver palette)
```

## Known limitations / next steps

- USD only (see trade-off above).
- No historical chart.
- No widget/notification for price alerts yet.
- Debug-signed only — needs a release signing config before any store
  distribution.
