package tw.techtarian.chengjing

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import android.graphics.Color
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.IntentSenderRequest
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.common.api.Scope
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var services: NativeServices
    private val executor = Executors.newFixedThreadPool(3)
    private var fileReply: ((Any?, String?) -> Unit)? = null
    private val googleWaiters = mutableListOf<(Any?, String?) -> Unit>()
    private var googleAuthorizing = false
    private var googleInteractive = false
    private var saveRequest: JSONObject? = null
    private var metadataOnly = true
    private var pickingBackupFolder = false
    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileReply; fileReply = null
        if (result.resultCode != RESULT_OK) { pickingBackupFolder=false;saveRequest=null;callback?.invoke(JSONObject().put("canceled", true).put("files", JSONArray()), null) }
        else executor.execute {
            try {
                val intent = result.data!!
                val uri = intent.data
                val save = saveRequest; saveRequest = null
                if(pickingBackupFolder && uri!=null) {
                    pickingBackupFolder=false
                    contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    val settings=services.call("backup.update",JSONObject().put("enabled",true).put("directory",uri.toString()))
                    callback?.invoke(JSONObject().put("canceled",false).put("settings",settings),null)
                } else if (save != null && uri != null) {
                    services.saveToUri(uri, save)
                    callback?.invoke(JSONObject().put("canceled", false).put("filePath", uri.toString()), null)
                } else {
                    val uris = if (intent.clipData != null) (0 until intent.clipData!!.itemCount).map { intent.clipData!!.getItemAt(it).uri } else listOfNotNull(uri)
                    val files = JSONArray()
                    uris.forEach { val imported=services.importUri(it);if(!metadataOnly)imported.put("data",services.call("attachments.readData",JSONObject().put("path",imported.getString("path"))));files.put(imported) }
                    callback?.invoke(JSONObject().put("canceled", false).put("files", files), null)
                }
            } catch (error: Exception) { callback?.invoke(null, error.message ?: "File operation failed") }
        }
    }
    private val googleConsent = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        try {
            val auth = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(result.data)
            val token = auth.accessToken ?: throw IllegalStateException("Google authorization did not return access")
            services.store.put("google-token", token)
            finishGoogle(JSONObject().put("connected", true), null)
        } catch (error: Exception) { finishGoogle(null, error.message ?: "Google authorization cancelled") }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        services = NativeServices(this)
        web = WebView(this)
        web.setBackgroundColor(Color.rgb(17,24,22))
        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false; mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; mediaPlaybackRequiresUserGesture = true }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host == "appassets.androidplatform.net" && request.url.path?.startsWith("/attachments/") == true) return services.attachmentResponse(request.url.lastPathSegment ?: "")
                return assets.shouldInterceptRequest(request.url)
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "appassets.androidplatform.net") return request.isForMainFrame && request.url.path != "/assets/public/index.html"
                if (request.isForMainFrame && request.url.scheme in listOf("https", "http")) startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
            override fun onPageFinished(view: WebView, url: String) { emit("resume", JSONObject()) }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { recreate(); return true }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                android.app.AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setOnCancelListener { result.cancel() }.show(); return true
            }
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                android.app.AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show(); return true
            }
        }
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "Please update Android System WebView" }
        WebViewCompat.addWebMessageListener(web, "ChengJingNative", setOf("https://appassets.androidplatform.net")) { _, message, origin, mainFrame, _ ->
            if (!mainFrame || origin.host != "appassets.androidplatform.net") return@addWebMessageListener
            try {
                val request = JSONObject(message.data ?: "{}")
                val id = request.getString("id")
                val args = request.optJSONObject("args") ?: JSONObject()
                val reply: (Any?, String?) -> Unit = { value, error ->
                    val envelope = JSONObject().put("id", id).put("value", value ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL)
                    runOnUiThread { web.evaluateJavascript("window.__chengjingNativeReply?.($envelope)", null) }
                }
                when (request.getString("method")) {
                    "backup.chooseFolder" -> runOnUiThread {
                        if(fileReply!=null)reply(null,"Another file chooser is open")else{
                            fileReply=reply;pickingBackupFolder=true
                            picker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION))
                        }
                    }
                    "app.theme" -> runOnUiThread {
                        val color=Color.parseColor(args.getString("color"));(web.parent as? FrameLayout)?.setBackgroundColor(color);web.setBackgroundColor(color)
                        val controller=androidx.core.view.WindowInsetsControllerCompat(window,web)
                        controller.isAppearanceLightStatusBars=!args.optBoolean("dark");controller.isAppearanceLightNavigationBars=!args.optBoolean("dark")
                        reply(JSONObject(),null)
                    }
                    "files.open", "files.save" -> runOnUiThread {
                        if (fileReply != null) reply(null, "Another file chooser is open") else {
                            fileReply = reply
                            val save = request.getString("method") == "files.save"
                            saveRequest = if (save) args else null
                            metadataOnly = args.optBoolean("metadataOnly", false)
                            picker.launch(Intent(if (save) Intent.ACTION_CREATE_DOCUMENT else Intent.ACTION_OPEN_DOCUMENT).apply {
                                addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
                                if (save) putExtra(Intent.EXTRA_TITLE, args.optString("defaultPath", "ChengJing-backup.json").substringAfterLast('/'))
                                else putExtra(Intent.EXTRA_ALLOW_MULTIPLE, args.optBoolean("multiple", true))
                            })
                        }
                    }
                    "google.connect" -> runOnUiThread { authorizeGoogle(reply) }
                    "google.refresh" -> runOnUiThread { authorizeGoogle(reply, false) }
                    "app.close" -> runOnUiThread { reply(JSONObject().put("closed", true), null); moveTaskToBack(true) }
                    else -> executor.execute { try { reply(services.call(request.getString("method"), args), null) } catch (error: Exception) { reply(null, error.message ?: "Operation failed") } }
                }
            } catch (_: Exception) { /* Malformed messages have no native authority. */ }
        }
        val root=FrameLayout(this)
        root.addView(web,FrameLayout.LayoutParams(-1,-1))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val system = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            web.layoutParams=(web.layoutParams as FrameLayout.LayoutParams).apply{setMargins(system.left,system.top,system.right,system.bottom)}
            insets
        }
        androidx.core.view.WindowInsetsControllerCompat(window,web).isAppearanceLightStatusBars=true
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { emit("back", JSONObject()) } })
        receiveShare(intent)
        web.loadUrl("https://appassets.androidplatform.net/assets/public/index.html")
    }
    private fun authorizeGoogle(reply: (Any?, String?) -> Unit, interactive: Boolean = true) {
        googleWaiters.add(reply);googleInteractive=googleInteractive||interactive
        if (googleAuthorizing) return
        googleAuthorizing=true
        Identity.getAuthorizationClient(this).authorize(AuthorizationRequest.builder().setRequestedScopes(listOf(Scope("https://www.googleapis.com/auth/drive.appdata"))).build())
            .addOnSuccessListener { result ->
                if (result.hasResolution() && googleInteractive) googleConsent.launch(IntentSenderRequest.Builder(result.pendingIntent!!.intentSender).build())
                else if(result.hasResolution()) finishGoogle(null,"Google authorization required; reconnect your account")
                else { services.store.put("google-token", result.accessToken ?: ""); finishGoogle(JSONObject().put("connected", true), null) }
            }.addOnFailureListener { error -> finishGoogle(null, error.message ?: "Google authorization failed") }
    }
    private fun finishGoogle(value: Any?, error: String?) {
        val waiters=googleWaiters.toList();googleWaiters.clear();googleAuthorizing=false;googleInteractive=false
        waiters.forEach { it(value,error) }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); receiveShare(intent); emit("resume", JSONObject()) }
    private fun receiveShare(intent: Intent) {
        if (intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return
        // Persist before notifying the Web workspace; interrupted imports are retried by ID.
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
        @Suppress("DEPRECATION")
        val uris = if (intent.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty() else listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
        executor.execute { services.enqueueShare(text, uris); emit("resume", JSONObject()) }
    }
    fun emit(name: String, data: JSONObject) { runOnUiThread { if (::web.isInitialized) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('chengjing:android-$name',{detail:$data}))", null) } }
    override fun onPause() { if (::web.isInitialized) emit("pause", JSONObject()); super.onPause() }
    override fun onResume() { super.onResume(); if (::web.isInitialized) emit("resume", JSONObject()) }
}
