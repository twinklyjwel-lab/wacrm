package com.twinklyjewels.goldsilverrates.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.twinklyjewels.goldsilverrates.data.RatesRepository
import com.twinklyjewels.goldsilverrates.data.model.Metal
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// The free keyless API this app uses has no documented rate limit, but polling gently
// is still good etiquette for a shared community service.
private val AUTO_REFRESH_INTERVAL_MILLIS = java.util.concurrent.TimeUnit.MINUTES.toMillis(5)

class RatesViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = RatesRepository(application)

    private val _uiState = MutableStateFlow<RatesUiState>(RatesUiState.Loading)
    val uiState: StateFlow<RatesUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            while (true) {
                fetchRates(showSpinner = _uiState.value !is RatesUiState.Success)
                delay(AUTO_REFRESH_INTERVAL_MILLIS)
            }
        }
    }

    fun refresh() {
        viewModelScope.launch { fetchRates(showSpinner = false, forceRefreshingFlag = true) }
    }

    private suspend fun fetchRates(showSpinner: Boolean, forceRefreshingFlag: Boolean = false) {
        if (showSpinner) _uiState.value = RatesUiState.Loading
        if (forceRefreshingFlag) {
            val current = _uiState.value
            if (current is RatesUiState.Success) _uiState.value = current.copy(isRefreshing = true)
        }

        val goldResult = repository.getRate(Metal.GOLD)
        val silverResult = repository.getRate(Metal.SILVER)

        _uiState.value = when {
            goldResult.isSuccess && silverResult.isSuccess -> RatesUiState.Success(
                gold = goldResult.getOrThrow(),
                silver = silverResult.getOrThrow()
            )

            else -> RatesUiState.Error(
                (goldResult.exceptionOrNull() ?: silverResult.exceptionOrNull())
                    ?.message ?: "Could not load rates. Check your connection."
            )
        }
    }
}
