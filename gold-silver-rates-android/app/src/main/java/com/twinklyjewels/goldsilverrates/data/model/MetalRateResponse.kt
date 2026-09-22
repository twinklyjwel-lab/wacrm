package com.twinklyjewels.goldsilverrates.data.model

/**
 * Maps the JSON shape returned by GoldAPI.io — https://www.goldapi.io/api/{symbol}/{currency}.
 * Field names must match the API's JSON keys exactly (Gson maps by name).
 */
data class MetalRateResponse(
    val timestamp: Long,
    val metal: String,
    val currency: String,
    val price: Double,
    val ch: Double,
    val chp: Double,
    val price_gram_24k: Double,
    val price_gram_22k: Double,
    val price_gram_18k: Double
)
