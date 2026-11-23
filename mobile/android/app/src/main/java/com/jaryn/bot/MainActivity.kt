package com.jaryn.bot

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.text.InputType
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Thin WebView shell for a self-hosted jaryn server.
 * Mirrors the desktop client: configure server URL once, then use the Web UI.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("jaryn", Context.MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.loadWithOverviewMode = true
        webView.settings.useWideViewPort = true
        webView.webViewClient = WebViewClient()
        setContentView(webView)
        val url = prefs.getString("serverUrl", null)
        if (url == null) showSetup() else webView.loadUrl(url)
    }

    private fun normalize(input: String): String? {
        val raw = input.trim()
        if (raw.isEmpty()) return null
        val withScheme = if (raw.startsWith("http://") || raw.startsWith("https://")) raw else "http://$raw"
        if (!withScheme.startsWith("http://") && !withScheme.startsWith("https://")) return null
        return withScheme.trimEnd('/')
    }

    private fun showSetup() {
        val input = EditText(this).apply {
            hint = "http://192.168.1.10:8787"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("serverUrl", "http://127.0.0.1:8787"))
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 32, 48, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("连接 jaryn 服务器")
            .setMessage("输入自托管服务地址（可选 API Token 在 Web UI 设置）")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("连接") { _, _ ->
                val url = normalize(input.text.toString())
                if (url == null) { showSetup() } else {
                    prefs.edit().putString("serverUrl", url).apply()
                    webView.loadUrl(url)
                }
            }
            .setNeutralButton("更改") { _, _ -> showSetup() }
            .show()
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
