# Gold & Silver Rates (Android)

A native Android app (Kotlin + Jetpack Compose) that shows live gold and
silver spot prices — per gram (24K/22K), per 10g, per kg, and per troy
ounce — with manual refresh, auto-refresh every 15 minutes, multi-currency
support (INR/USD/EUR/GBP/AED), and an offline cache so the last known
rate still shows if the network call fails.

This is a standalone Gradle project, independent of the Next.js CRM at
the repo root — it doesn't touch or depend on that codebase.

## Why this doesn't build here

This session runs in a sandboxed container with no Android SDK and no
network access to `dl.google.com` (the host that serves Android SDK
platforms/build-tools and mirrors Google's Maven artifacts). Both are
required to compile an Android app, so the code here has been written
carefully by hand but **not compiled or run**. Open it in Android Studio
(which will fetch the SDK + dependencies automatically) to build and test
it — see steps below.

## API choice

Researched free options (Sept 2026):

| API | Auth | Free tier | Notes |
|---|---|---|---|
| **GoldAPI.io** (used here) | API key (free signup) | Free plan available | Returns price per gram pre-split by karat (24K/22K/18K...) directly — ideal for a jewelry-style app, supports 170+ currencies including INR |
| gold-api.com | None | Unlimited, no key | Simplest option for a quick demo, but less documented/guaranteed uptime and only returns spot price (no per-karat gram prices) |
| metals-api.com | API key | 50 req/month free | Good if you need historical/currency-conversion data too |
| metalpriceapi.com | API key | 100 req/month free | Similar to metals-api |
| metals.dev | API key | 100 req/month free | Sub-60s latency even on free plan |

**GoldAPI.io** was picked because it returns `price_gram_24k` /
`price_gram_22k` / `price_gram_18k` directly in the response — exactly
what a jewelry/consumer rates app needs — without extra client-side math,
and it supports INR natively.

> The exact JSON field names in `MetalRateResponse.kt` are based on
> GoldAPI.io's publicly documented schema. This sandbox couldn't reach
> `goldapi.io` to confirm live output byte-for-byte (network egress here
> is restricted to a small allowlist), so **verify the response shape
> against a real API call once you have a key**, and adjust the DTO if
> any field name has changed.

To switch providers, only two files need to change:
`data/GoldApiService.kt` (endpoint shape) and
`data/model/MetalRateResponse.kt` (JSON field names) — the rest of the
app (repository, ViewModel, UI) is provider-agnostic.

## Setup

1. Sign up at [goldapi.io](https://www.goldapi.io) (free, no credit card) and
   copy your access token.
2. Copy `local.properties.example` to `local.properties` and paste your
   token:
   ```
   goldApiKey=goldapi-xxxxxxxxxxxxx
   ```
   (`local.properties` is gitignored — never commit real keys.)
3. Open the `gold-silver-rates-android/` folder in Android Studio
   (Koala/Ladybug or newer). It will sync Gradle and download the
   Android SDK bits it needs automatically.
4. Run on an emulator or device (minSdk 24 / Android 7.0+).

## Project structure

```
app/src/main/java/com/twinklyjewels/goldsilverrates/
  MainActivity.kt              # single-activity host, sets up Compose content
  data/
    GoldApiService.kt          # Retrofit interface
    NetworkModule.kt           # OkHttp + Retrofit singleton
    RatesRepository.kt         # fetch + SharedPreferences cache/fallback
    model/
      MetalRate.kt             # domain model used by the UI
      MetalRateResponse.kt     # raw API response DTO
  ui/
    RatesViewModel.kt          # polling loop, refresh, currency switch
    RatesUiState.kt            # Loading / Success / Error
    screen/RatesScreen.kt      # Compose UI
    theme/                     # Material3 theme (gold/silver palette)
```

## Known limitations / next steps

- Free-tier API quotas are small (often ~100 requests/month). The
  15-minute default in `RatesViewModel.kt`
  (`AUTO_REFRESH_INTERVAL_MILLIS`) is a starting point, not a
  guarantee it fits your plan — check GoldAPI's current terms/pricing
  before shipping, and consider routing through a server you control
  that caches responses for all users instead of hitting the API
  directly from every device.
- No historical chart yet (GoldAPI.io supports historical data — see
  their docs — if you want to add one).
- No widget/notification for price alerts yet.
