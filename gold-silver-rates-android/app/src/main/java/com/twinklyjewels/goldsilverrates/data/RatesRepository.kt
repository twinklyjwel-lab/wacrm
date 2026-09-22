package com.twinklyjewels.goldsilverrates.data

import android.content.Context
import com.google.gson.Gson
import com.twinklyjewels.goldsilverrates.data.model.Metal
import com.twinklyjewels.goldsilverrates.data.model.MetalRate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fetches live rates from [GoldApiService] and falls back to the last successfully
 * fetched value (persisted in SharedPreferences) when the network call fails.
 */
class RatesRepository(
    context: Context,
    private val api: GoldApiService = NetworkModule.goldApiService
) {
    private val prefs = context.applicationContext
        .getSharedPreferences("rates_cache", Context.MODE_PRIVATE)
    private val gson = Gson()

    suspend fun getRate(metal: Metal): Result<MetalRate> = withContext(Dispatchers.IO) {
        val cacheKey = metal.symbol
        runCatching {
            val response = api.getRate(metal.symbol)
            MetalRate.fromResponse(metal, response).also { rate ->
                prefs.edit().putString(cacheKey, gson.toJson(rate)).apply()
            }
        }.recoverCatching { error ->
            val cached = prefs.getString(cacheKey, null)
                ?: throw error
            gson.fromJson(cached, MetalRate::class.java).copy(isCached = true)
        }
    }
}
