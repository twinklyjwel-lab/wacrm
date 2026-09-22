package com.twinklyjewels.goldsilverrates.data.model

/**
 * Maps the JSON shape returned by gold-api.com — https://api.gold-api.com/price/{symbol}.
 * That API is free and keyless but only documents `price` reliably; every other field
 * it may return is ignored here rather than guessed at.
 */
data class MetalRateResponse(
    val price: Double
)
