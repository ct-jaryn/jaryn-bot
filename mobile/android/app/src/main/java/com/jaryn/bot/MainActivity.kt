package com.jaryn.bot

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.text.InputType
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Thin WebView shell for a self-hosted jaryn server.
 * Mirrors the desktop client: configure server URL once, then use the Web UI.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("jaryn", Context.MODE_PRIVATE) }

    private fun serverUrlWithToken(): String {
        val base = prefs.getString("serverUrl", null) ?: return ""
        val token = prefs.getString("apiToken", "").orEmpty()
        return if (token.isNotEmpty()) "$base/?token=${java.net.URLEncoder.encode(token, "UTF-8")}" else base
    }

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
        if (url == null) showSetup() else webView.loadUrl(serverUrlWithToken())
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
        val tokenInput = EditText(this).apply {
            hint = "服务端 API Token（未设置可留空）"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(prefs.getString("apiToken", ""))
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 32, 48, 0)
            addView(input)
            addView(TextView(context).apply { text = "可选：JARY_API_TOKEN"; setPadding(0, 24, 0, 0) })
            addView(tokenInput)
        }
        AlertDialog.Builder(this)
            .setTitle("连接 jaryn 服务器")
            .setMessage("输入自托管服务地址（可选 API Token 在 Web UI 设置）")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("连接") { _, _ ->
                val url = normalize(input.text.toString())
                if (url == null) { showSetup() } else {
                    prefs.edit()
                        .putString("serverUrl", url)
                        .putString("apiToken", tokenInput.text.toString().trim())
                        .apply()
                    webView.loadUrl(serverUrlWithToken())
                }
            }
            .setNeutralButton("更改") { _, _ -> showSetup() }
            .show()
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
