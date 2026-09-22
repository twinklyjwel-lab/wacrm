package com.twinklyjewels.goldsilverrates.data.model

/** A gold karat or silver fineness grade, expressed as a fraction of pure metal. */
data class Purity(val label: String, val fraction: Double)

enum class Metal(val symbol: String, val label: String, val purities: List<Purity>) {
    GOLD(
        symbol = "XAU",
        label = "Gold",
        purities = listOf(
            Purity("24K", 1.0),
            Purity("22K", 22.0 / 24.0),
            Purity("18K", 18.0 / 24.0)
        )
    ),
    SILVER(
        symbol = "XAG",
        label = "Silver",
        purities = listOf(
            Purity("Fine (999)", 0.999),
            Purity("Sterling (925)", 0.925)
        )
    )
}

/**
 * Domain model used by the UI. The upstream free API only reports the USD spot price per
 * troy ounce, so per-gram prices at each purity are derived client-side using the standard
 * karat/fineness fractions above — this is the same math jewellers use to quote gold/silver
 * rates from the spot price.
 */
data class MetalRate(
    val metal: Metal,
    val pricePerOunceUsd: Double,
    val fetchedAtMillis: Long,
    val isCached: Boolean = false
) {
    private val pricePerGramPure: Double get() = pricePerOunceUsd / TROY_OUNCE_IN_GRAMS

    fun pricePerGram(purity: Purity): Double = pricePerGramPure * purity.fraction

    val pricePerKilogramPure: Double get() = pricePerGramPure * 1000

    companion object {
        const val TROY_OUNCE_IN_GRAMS = 31.1034768

        fun fromResponse(metal: Metal, response: MetalRateResponse, isCached: Boolean = false) =
            MetalRate(
                metal = metal,
                pricePerOunceUsd = response.price,
                fetchedAtMillis = System.currentTimeMillis(),
                isCached = isCached
            )
    }
}
