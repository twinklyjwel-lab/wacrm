package com.vermajewellers.rates

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Thin native shell around the published rates page (an interactive Claude
 * Artifact) so shop staff and customers get an installable app icon instead
 * of a browser bookmark. All rate/admin/language logic lives in that page.
 */
class MainActivity : ComponentActivity() {

    private val ratesUrl = "https://claude.ai/artifact/879yU5PP7Ki1if13Uqw59S"

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var errorView: View

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        errorView = buildErrorView()

        val root = FrameLayout(this)
        swipeRefresh = SwipeRefreshLayout(this).apply {
            addView(webView)
            setOnRefreshListener { webView.reload() }
        }
        root.addView(swipeRefresh)
        root.addView(errorView)
        setContentView(root)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                swipeRefresh.isRefreshing = false
                errorView.visibility = View.GONE
                swipeRefresh.visibility = View.VISIBLE
            }

            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                if (failingUrl == ratesUrl || view?.url == ratesUrl) {
                    swipeRefresh.isRefreshing = false
                    swipeRefresh.visibility = View.GONE
                    errorView.visibility = View.VISIBLE
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl(ratesUrl)
    }

    private fun buildErrorView(): View {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setBackgroundColor(Color.parseColor("#161A10"))
            visibility = View.GONE
        }
        val message = TextView(this).apply {
            text = "Couldn't load rates.\nCheck your connection and tap to retry."
            setTextColor(Color.parseColor("#F4F1E3"))
            textSize = 16f
            gravity = android.view.Gravity.CENTER
            setPadding(48, 0, 48, 32)
        }
        container.addView(message)
        container.setOnClickListener { webView.loadUrl(ratesUrl) }
        return container
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
