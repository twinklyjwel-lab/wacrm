package com.twinklyjewels.goldsilverrates.data

import com.twinklyjewels.goldsilverrates.data.model.MetalRateResponse
import retrofit2.http.GET
import retrofit2.http.Path

/** Free, keyless spot-price API — https://gold-api.com/docs. USD only, no rate limit advertised. */
interface GoldApiService {
    @GET("price/{symbol}")
    suspend fun getRate(@Path("symbol") symbol: String): MetalRateResponse
}
