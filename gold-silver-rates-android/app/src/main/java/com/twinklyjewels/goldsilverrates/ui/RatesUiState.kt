package com.twinklyjewels.goldsilverrates.ui

import com.twinklyjewels.goldsilverrates.data.model.MetalRate

sealed interface RatesUiState {
    data object Loading : RatesUiState

    data class Success(
        val gold: MetalRate,
        val silver: MetalRate,
        val isRefreshing: Boolean = false
    ) : RatesUiState

    data class Error(val message: String) : RatesUiState
}
