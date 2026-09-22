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

// Free-tier metal price APIs typically cap out around 100 requests/month, so this
// defaults to a conservative 15 minutes (2 calls/refresh * 96 refreshes/day would still
// blow through that in ~12 hours if left running continuously — lower this only if
// you're on a paid plan or self-hosting a caching proxy).
private val AUTO_REFRESH_INTERVAL_MILLIS = java.util.concurrent.TimeUnit.MINUTES.toMillis(15)

class RatesViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = RatesRepository(application)

    private val _uiState = MutableStateFlow<RatesUiState>(RatesUiState.Loading)
    val uiState: StateFlow<RatesUiState> = _uiState.asStateFlow()

    private var currency = "INR"

    init {
        viewModelScope.launch {
            while (true) {
                fetchRates(showSpinner = _uiState.value !is RatesUiState.Success)
                delay(AUTO_REFRESH_INTERVAL_MILLIS)
            }
        }
    }

    fun setCurrency(newCurrency: String) {
        if (newCurrency == currency) return
        currency = newCurrency
        refresh()
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

        val goldResult = repository.getRate(Metal.GOLD, currency)
        val silverResult = repository.getRate(Metal.SILVER, currency)

        _uiState.value = when {
            goldResult.isSuccess && silverResult.isSuccess -> RatesUiState.Success(
                gold = goldResult.getOrThrow(),
                silver = silverResult.getOrThrow(),
                currency = currency
            )

            else -> RatesUiState.Error(
                (goldResult.exceptionOrNull() ?: silverResult.exceptionOrNull())
                    ?.message ?: "Could not load rates. Check your connection and API key."
            )
        }
    }
}
