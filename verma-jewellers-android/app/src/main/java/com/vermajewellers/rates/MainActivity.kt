package com.vermajewellers.rates

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat

/**
 * Fully offline shell: the rates page (with its admin panel, stock photo
 * picker and language switcher) ships as a bundled asset and never talks to
 * any server or account — no sign-in, no network dependency at all.
 * Admin-entered rates and photos persist in this WebView's own localStorage,
 * on this device only.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var filePickerCallback: ValueCallback<Array<Uri>>? = null

    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        filePickerCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        filePickerCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Opt out of edge-to-edge (the targetSdk 35 default) so the system
        // reserves space for the status bar instead of the page's own fixed
        // top bar (language switcher) drawing underneath it.
        WindowCompat.setDecorFitsSystemWindows(window, true)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // A plain WebView shows no picker at all for <input type="file">
            // without a WebChromeClient wiring one up.
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    filePickerCallback?.onReceiveValue(null)
                    filePickerCallback = filePathCallback
                    pickImage.launch("image/*")
                    return true
                }
            }
        }
        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
