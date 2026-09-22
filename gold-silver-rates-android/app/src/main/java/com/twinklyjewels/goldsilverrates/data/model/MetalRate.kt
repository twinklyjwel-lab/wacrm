package com.twinklyjewels.goldsilverrates.data.model

enum class Metal(val symbol: String, val label: String) {
    GOLD("XAU", "Gold"),
    SILVER("XAG", "Silver")
}

/** Domain model used by the UI, independent of the upstream API's JSON shape. */
data class MetalRate(
    val metal: Metal,
    val currency: String,
    val pricePerOunce: Double,
    val pricePerGram24k: Double,
    val pricePerGram22k: Double,
    val pricePerGram18k: Double,
    val changeAmount: Double,
    val changePercent: Double,
    val fetchedAtMillis: Long,
    val isCached: Boolean = false
) {
    val pricePerTenGram24k: Double get() = pricePerGram24k * 10
    val pricePerTenGram22k: Double get() = pricePerGram22k * 10
    val pricePerKilogram: Double get() = pricePerGram24k * 1000

    companion object {
        fun fromResponse(metal: Metal, response: MetalRateResponse, isCached: Boolean = false) =
            MetalRate(
                metal = metal,
                currency = response.currency,
                pricePerOunce = response.price,
                pricePerGram24k = response.price_gram_24k,
                pricePerGram22k = response.price_gram_22k,
                pricePerGram18k = response.price_gram_18k,
                changeAmount = response.ch,
                changePercent = response.chp,
                fetchedAtMillis = response.timestamp * 1000L,
                isCached = isCached
            )
    }
}
