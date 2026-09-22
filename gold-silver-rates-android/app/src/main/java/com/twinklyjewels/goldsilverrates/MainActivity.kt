package com.twinklyjewels.goldsilverrates

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.twinklyjewels.goldsilverrates.ui.RatesViewModel
import com.twinklyjewels.goldsilverrates.ui.screen.RatesScreen
import com.twinklyjewels.goldsilverrates.ui.theme.GoldSilverRatesTheme

class MainActivity : ComponentActivity() {

    private val viewModel: RatesViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            GoldSilverRatesTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val uiState by viewModel.uiState.collectAsState()
                    RatesScreen(
                        uiState = uiState,
                        onRefresh = viewModel::refresh,
                        onCurrencyChange = viewModel::setCurrency
                    )
                }
            }
        }
    }
}
