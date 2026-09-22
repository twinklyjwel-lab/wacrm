package com.twinklyjewels.goldsilverrates.data

import com.twinklyjewels.goldsilverrates.data.model.MetalRateResponse
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Path

/**
 * Thin wrapper around GoldAPI.io (https://www.goldapi.io/api/{symbol}/{currency}).
 * Free tier requires a personal access token — see README for setup.
 */
interface GoldApiService {
    @GET("{symbol}/{currency}")
    suspend fun getRate(
        @Path("symbol") symbol: String,
        @Path("currency") currency: String,
        @Header("x-access-token") accessToken: String
    ): MetalRateResponse
}
