package tw.techtarian.chengjing

import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.WebResourceResponse
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.time.Instant
import java.time.ZoneOffset
import androidx.documentfile.provider.DocumentFile

class NativeServices(private val context: Context, private val backupApp: String = "chengjing-cloud-backup-v1", stateName: String = "settings", private val clock: () -> Long = { System.currentTimeMillis() }) {
    companion object { private val syncUploadLock = Any(); private val googleAuthLock = Any() }
    val store = SecureStore(context)
    private val inference by lazy { LocalInference(context) }
    private val prefs = context.getSharedPreferences(stateName, Context.MODE_PRIVATE)
    private val files = File(context.filesDir, "attachments").apply { mkdirs() }
    private val http by lazy { OkHttpClient.Builder().callTimeout(180, TimeUnit.SECONDS).followRedirects(false).build() }
    private fun objectValue(key: String, fallback: String = "{}") = JSONObject(prefs.getString(key, fallback)!!)
    private fun save(key: String, value: JSONObject): JSONObject { check(prefs.edit().putString(key, value.toString()).commit()); return value }
    fun safeFile(name: String): File { val file = File(files, name).canonicalFile; require(file.parentFile == files.canonicalFile) { "Invalid attachment path" }; return file }
    private fun json(url: String, method: String = "GET", body: JSONObject? = null, secret: String = ""): JSONObject {
        require(Uri.parse(url).scheme == "https" || Uri.parse(url).host in listOf("localhost", "127.0.0.1", "10.0.2.2")) { "Use an HTTPS Gateway for this connection" }
        val builder = Request.Builder().url(url).method(method, if (method == "GET") null else (body?.toString() ?: "").toRequestBody("application/json".toMediaType()))
        if (secret.isNotEmpty()) builder.header("Authorization", "Bearer $secret")
        http.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string() ?: "{}"
            val result = try { JSONObject(raw) } catch (_: Exception) { JSONObject().put("message", raw.take(300)) }
            if (!response.isSuccessful) { var message="HTTP ${response.code}: ${result.optJSONObject("error")?.optString("message") ?: result.optString("message")}";if(secret.isNotEmpty())message=message.replace(secret,"[redacted]");throw IllegalStateException(message) }
            return result
        }
    }
    fun importUri(uri: Uri): JSONObject {
        var name = "attachment"
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor -> val column=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);if (cursor.moveToFirst()&&column>=0) name = cursor.getString(column) }
        val id = UUID.randomUUID().toString()
        val file = safeFile(id)
        val temp = safeFile("$id.part")
        context.contentResolver.openInputStream(uri)!!.use { input -> temp.outputStream().use { output -> input.copyTo(output) } }
        check(temp.renameTo(file))
        return JSONObject().put("name", name).put("path", id).put("data", "")
    }
    private fun attachment(file: File, args: JSONObject): JSONObject {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val count=input.read(buffer); if(count<0) break; digest.update(buffer,0,count) } }
        return JSONObject().put("id", args.optString("id", file.name)).put("name", args.optString("name", "attachment")).put("mime", args.optString("mime", "application/octet-stream")).put("size", file.length()).put("relativePath", file.name).put("storage", "file").put("sha256", digest.digest().joinToString("") { "%02x".format(it) }).put("createdAt", args.optLong("createdAt", System.currentTimeMillis()))
    }
    fun attachmentResponse(name: String): WebResourceResponse? = try {
        val file = safeFile(name)
        if (!file.isFile) null else WebResourceResponse("application/octet-stream", null, file.inputStream())
    } catch (_: Exception) { null }
    fun saveToUri(uri: Uri, args: JSONObject) {
        val data = args.getString("data")
        context.contentResolver.openOutputStream(uri, "wt")!!.use { output -> output.write(if(args.optString("encoding")=="base64") Base64.decode(data, Base64.DEFAULT) else data.toByteArray()) }
    }
    @Synchronized fun enqueueShare(text: String, uris: List<Uri>) {
        val queue = JSONArray(prefs.getString("share-queue", "[]")!!)
        val attachments = JSONArray(); uris.forEach { attachments.put(importUri(it)) }
        queue.put(JSONObject().put("id", UUID.randomUUID().toString()).put("text", text).put("files", attachments))
        check(prefs.edit().putString("share-queue", queue.toString()).commit())
    }
    private fun providers() = objectValue("providers", "{\"selectedProfileId\":\"\",\"profiles\":[]}")
    private fun profile(id: String): JSONObject { val settings=providers(); val profiles=settings.getJSONArray("profiles"); return (0 until profiles.length()).map { profiles.getJSONObject(it) }.first { it.getString("id")==id.ifEmpty { settings.getString("selectedProfileId") } } }
    private val syncRecoveryBridge = SyncRecoveryNativeBridge {
        SyncRecoveryService(
            stagingDirectory = File(context.filesDir, "sync-recovery-staging"),
            attachmentsDirectory = files,
            remote = SyncRecoveryDriveIO({ store.get("google-token") }),
            mayWrite = {
                prefs.getBoolean("sync-enabled", false) && store.get("google-token").isNotEmpty()
            },
            clock = clock
        )
    }

    fun suspendSyncRecovery() { syncRecoveryBridge.invalidate() }

    fun googleAuthorizationEpoch(): Long = prefs.getLong("google-auth-epoch", 0)

    fun googleAuthorizationRequired(epoch: Long = googleAuthorizationEpoch()) = synchronized(googleAuthLock) {
        if (epoch == googleAuthorizationEpoch()) check(prefs.edit().putString("google-auth-state", GoogleAuthorizationPolicy.AUTH_REQUIRED).commit())
    }

    fun acceptGoogleToken(value: String?, epoch: Long = googleAuthorizationEpoch()) = synchronized(googleAuthLock) {
        check(epoch == googleAuthorizationEpoch()) { "Google connection changed; reconnect your account" }
        val token = try { GoogleAuthorizationPolicy.requireToken(value) }
            catch (error: IllegalStateException) { googleAuthorizationRequired(); throw error }
        store.put("google-token", token)
        check(prefs.edit().putString("google-auth-state", "AUTHORIZED").commit())
    }

    private fun disconnectGoogle(): JSONObject {
        suspendSyncRecovery()
        synchronized(googleAuthLock) {
            check(prefs.edit().putBoolean("sync-enabled", false).putString("google-auth-state", "DISCONNECTED").putLong("google-auth-epoch", googleAuthorizationEpoch() + 1).commit())
            store.put("google-token", "")
        }
        androidx.work.WorkManager.getInstance(context).cancelUniqueWork("chengjing-sync-upload")
        androidx.work.WorkManager.getInstance(context).cancelUniqueWork("chengjing-sync-recovery")
        return JSONObject().put("connected", false)
    }

    private fun googleConnected() = GoogleAuthorizationPolicy.connected(
        store.get("google-token"), prefs.getString("google-auth-state", ""))

    fun prepareSyncRecoveryCall(method: String, args: JSONObject): () -> JSONObject {
        val target = if (method == "attachments.restoreFromBackup"
            && args.optString("backupFilePath").startsWith(SyncRecoveryService.BACKUP_PREFIX))
            "syncRecovery.restoreAttachment" else method
        return syncRecoveryBridge.prepare(target, args)
    }

    fun call(method: String, args: JSONObject): Any? = when(method) {
        "local.status" -> inference.status()
        "local.download" -> inference.download()
        "local.generate" -> inference.generate(args)
        "local.remove" -> inference.remove()
        "app.info" -> JSONObject().put("platform","android").put("version",BuildConfig.VERSION_NAME).put("systemDark",android.content.res.Resources.getSystem().configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK==android.content.res.Configuration.UI_MODE_NIGHT_YES).put("language",when { java.util.Locale.getDefault().language=="zh" -> "zh-TW"; java.util.Locale.getDefault().language in listOf("ja","ko") -> java.util.Locale.getDefault().language; else -> "en" })
        "share.pending" -> JSONArray(prefs.getString("share-queue", "[]")!!)
        "share.ack" -> { val queue=JSONArray(prefs.getString("share-queue","[]")!!); val keep=JSONArray(); for(i in 0 until queue.length()) if(queue.getJSONObject(i).getString("id")!=args.getString("id")) keep.put(queue.get(i)); prefs.edit().putString("share-queue",keep.toString()).commit(); JSONObject() }
        "clipboard.write" -> { val manager=context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager; manager.setPrimaryClip(ClipData.newPlainText("澄境",args.getString("text"))); save("clipboard",args); JSONObject().put("written",true) }
        "clipboard.read" -> { val manager=context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager; val text=manager.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() ?: ""; val saved=objectValue("clipboard"); JSONObject().put("text",text).put("payload",if(saved.optString("text")==text) saved.opt("payload") else JSONObject.NULL) }
        "attachments.importPath" -> attachment(safeFile(args.getString("sourcePath")),args)
        "attachments.importData" -> { val file=safeFile(UUID.randomUUID().toString()); file.writeBytes(Base64.decode(args.getString("data"),Base64.DEFAULT)); attachment(file,args) }
        "attachments.readData" -> Base64.encodeToString(safeFile(args.getString("path")).readBytes(),Base64.NO_WRAP)
        "attachments.remove" -> { val pending=objectValue("pending-removal"); pending.put(args.getString("path"),true); save("pending-removal",pending); JSONObject().put("removed",true) }
        "attachments.pendingPaths" -> JSONArray(objectValue("pending-removal").keys().asSequence().toList())
        "attachments.sweepPending" -> { val keep=args.getJSONArray("keep"); val names=(0 until keep.length()).map{keep.getString(it)}.toSet(); var removed=0; objectValue("pending-removal").keys().forEach { if(it !in names && safeFile(it).delete()) removed++ }; save("pending-removal",JSONObject()); JSONObject().put("removed",removed) }
        "attachments.stats" -> JSONObject().put("count",files.listFiles()?.size ?: 0).put("bytes",files.listFiles()?.sumOf { it.length() } ?: 0)
        "ai.keyStatus" -> JSONObject().put("configured",store.get("openrouter").isNotEmpty()).put("encrypted",true).put("storage","android-keystore")
        "ai.setKey" -> { store.put("openrouter",args.getString("value")); call("ai.keyStatus",JSONObject()) }
        "ai.clearKey" -> { store.put("openrouter",""); call("ai.keyStatus",JSONObject()) }
        "ai.testOpenRouter" -> { val result=json("https://openrouter.ai/api/v1/key",secret=store.get("openrouter")); JSONObject().put("ok",true).put("label",result.optJSONObject("data")?.optString("label") ?: "OpenRouter").put("limitRemaining",JSONObject.NULL).put("usage",JSONObject.NULL) }
        "ai.listModels" -> json("https://openrouter.ai/api/v1/models").getJSONArray("data")
        "ai.providerSettings" -> providers()
        "ai.upsertProvider" -> { val settings=providers(); val id=args.optString("id").ifEmpty{UUID.randomUUID().toString()}; val p=JSONObject(args.toString()); p.put("id",id); if(args.has("apiKey") && args.getString("apiKey").isNotEmpty()) store.put("provider-$id",args.getString("apiKey")); p.remove("apiKey"); p.put("keyConfigured",store.get("provider-$id").isNotEmpty()); p.put("updatedAt",System.currentTimeMillis()); val list=settings.getJSONArray("profiles"); val keep=JSONArray(); for(i in 0 until list.length()) if(list.getJSONObject(i).getString("id")!=id)keep.put(list.get(i)); keep.put(p); settings.put("profiles",keep); if(args.optBoolean("select",true))settings.put("selectedProfileId",id); save("providers",settings) }
        "ai.selectProvider" -> save("providers",providers().put("selectedProfileId",args.getString("id")))
        "ai.removeProvider" -> { val settings=providers(); val id=args.getString("id"); val list=settings.getJSONArray("profiles"); val keep=JSONArray(); for(i in 0 until list.length()) if(list.getJSONObject(i).getString("id")!=id)keep.put(list.get(i)); settings.put("profiles",keep); if(settings.optString("selectedProfileId")==id) settings.put("selectedProfileId",keep.optJSONObject(0)?.optString("id") ?: ""); store.put("provider-$id",""); save("providers",settings) }
        "ai.listProviderModels", "ai.testProvider" -> { val p=profile(args.getString("id")); val models=json(p.getString("baseUrl").trimEnd('/')+"/models",secret=store.get("provider-${p.getString("id")}")).getJSONArray("data"); if(method=="ai.testProvider") JSONObject().put("ok",true).put("models",models).put("modelAvailable",true) else models }
        "ai.openRouterChat", "ai.providerChat" -> chat(args,method=="ai.openRouterChat")
        "web.fetch" -> { val url=args.getString("url"); require(Uri.parse(url).scheme=="https"); http.newCall(Request.Builder().url(url).build()).execute().use{ response->require(response.isSuccessful); JSONObject().put("html",response.body!!.string()).put("url",url) } }
        "google.status" -> JSONObject().put("connected",googleConnected()).put("authorizationState",prefs.getString("google-auth-state", "UNKNOWN"))
        "google.disconnect" -> disconnectGoogle()
        "sync.pause" -> {suspendSyncRecovery();prefs.edit().putBoolean("sync-enabled",false).commit();androidx.work.WorkManager.getInstance(context).cancelUniqueWork("chengjing-sync-upload");androidx.work.WorkManager.getInstance(context).cancelUniqueWork("chengjing-sync-recovery");JSONObject()}
        "sync.resume" -> {prefs.edit().putBoolean("sync-enabled",true).commit();SyncUploadWorker.enqueue(context);JSONObject()}
        "syncRecovery.setEnabled", "syncRecovery.getStatus", "syncRecovery.createDaily",
        "syncRecovery.download", "syncRecovery.releaseDownload",
        "syncRecovery.restoreAttachment" -> syncRecoveryBridge.call(method, args)
        "cloud.localStatus" -> cloudStatus(false)
        "cloud.status" -> cloudStatus(true)
        "cloud.init" -> { val status=cloudStatus(true);val settings=cloudSettings();settings.put("enabled",!status.optBoolean("needsDecision"));save("cloud-backup",settings);cloudStatus(true) }
        "cloud.update" -> { val settings=cloudSettings();if(args.has("enabled"))settings.put("enabled",args.getBoolean("enabled"));if(args.has("intervalMinutes"))settings.put("intervalMinutes",args.getInt("intervalMinutes"));save("cloud-backup",settings) }
        "cloud.write" -> writeCloud(args)
        "cloud.download" -> downloadCloud(args.getString("slot"))
        "cloud.completeRestore" -> { val settings=cloudSettings().put("lastKnownManifestId",args.getString("baselineManifestId")).put("enabled",true).put("conflict",false).put("lastSuccessAt",0);save("cloud-backup",settings) }
        "cloud.adopt" -> { val status=cloudStatus(true);save("cloud-backup",cloudSettings().put("lastKnownManifestId",status.optJSONObject("current")?.optString("id")?:"").put("conflict",false)) }
        "cloud.cancelRestore" -> {save("restore-staging",JSONObject());JSONObject().put("cleaned",true)}
        "attachments.restoreFromBackup" -> {
            if (args.optString("backupFilePath").startsWith(SyncRecoveryService.BACKUP_PREFIX)) {
                syncRecoveryBridge.call("syncRecovery.restoreAttachment", args)
            } else {
                val hash=args.getString("sha256");require(hash.matches(Regex("[a-f0-9]{64}")))
                val staged=objectValue("restore-staging").optString(hash)
                val source=if(staged.isNotEmpty())safeFile(staged)else File(context.filesDir,"backups/assets/$hash")
                if(!source.isFile){
                    val directory=objectValue("backup").optString("directory")
                    val document=if(directory.startsWith("content://"))DocumentFile.fromTreeUri(context,Uri.parse(directory))?.findFile("ChengJing-assets")?.findFile(hash)else null
                    require(document!=null){"The backup attachment is missing. Select the original backup folder."}
                    source.parentFile?.mkdirs();context.contentResolver.openInputStream(document.uri)!!.use{input->source.outputStream().use{output->input.copyTo(output)}}
                }
                val target=safeFile(UUID.randomUUID().toString());source.copyTo(target);val result=attachment(target,args);require(result.getString("sha256")==hash);result
            }
        }
        "sync.list" -> driveList(args.optString("kind","packet"))
        "sync.get" -> driveGet(args.getString("id"))
        "sync.put" -> drivePut(args.getString("id"),args.getString("data"),args.optString("kind","packet"))
        "sync.stage" -> {
            require(prefs.getBoolean("sync-enabled",false)){"Sync is paused"}
            val packet=args.getJSONObject("packet");val id=packet.getString("id");require(id.matches(Regex("[A-Za-z0-9_-]{1,100}")));require(packet.optString("protocol")=="chengjing-sync-v1")
            val folder=File(context.filesDir,"sync-upload").apply{mkdirs()};val file=File(folder,"$id.json");val temp=File(folder,"$id.part")
            temp.outputStream().use{it.write(packet.toString().toByteArray());it.fd.sync()};check(temp.renameTo(file));SyncUploadWorker.enqueue(context);JSONObject().put("staged",true)
        }
        "sync.uploadAsset" -> uploadAsset(args)
        "sync.downloadAsset" -> downloadAsset(args)
        "backup.settings" -> objectValue("backup", "{\"enabled\":false,\"directory\":\"\",\"intervalDays\":1,\"retentionCount\":10,\"lastSuccessAt\":0}")
        "backup.update" -> { val p=objectValue("backup"); args.keys().forEach{p.put(it,args.get(it))};save("backup",p) }
        "backup.write" -> {
            BackupRetention.referencedHashes(args.getString("data"))
            val folder=File(context.filesDir,"backups").apply{mkdirs()};val assets=File(folder,"assets").apply{mkdirs()};val list=args.optJSONArray("assets")?:JSONArray()
            for(i in 0 until list.length()){val a=list.getJSONObject(i);val hash=a.getString("sha256");require(hash.matches(Regex("[a-f0-9]{64}")));val target=File(assets,hash);if(!target.exists())safeFile(a.getString("relativePath")).copyTo(target)}
            val file=File(folder,"ChengJing-${System.currentTimeMillis()}.json");file.outputStream().use{it.write(args.getString("data").toByteArray());it.fd.sync()};val settings=objectValue("backup").put("lastSuccessAt",System.currentTimeMillis())
            val directory=if(args.optString("reason")=="safety")""else settings.optString("directory")
            if(directory.startsWith("content://")){
                val tree=DocumentFile.fromTreeUri(context,Uri.parse(directory))?:throw IllegalStateException("Backup folder access is unavailable")
                val targetAssets=tree.findFile("ChengJing-assets")?:tree.createDirectory("ChengJing-assets")?:throw IllegalStateException("Cannot create backup attachment folder")
                for(i in 0 until list.length()){val a=list.getJSONObject(i);val hash=a.getString("sha256");if(targetAssets.findFile(hash)==null){val target=targetAssets.createFile("application/octet-stream",hash)?:throw IllegalStateException("Cannot write backup attachment");context.contentResolver.openOutputStream(target.uri,"wt")!!.use{output->File(assets,hash).inputStream().use{input->input.copyTo(output)}}}}
                val target=tree.createFile("application/json",file.name)?:throw IllegalStateException("Cannot create backup")
                context.contentResolver.openOutputStream(target.uri,"wt")!!.use{output->file.inputStream().use{input->input.copyTo(output)}}
            }
            save("backup",settings)
            runCatching { BackupRetention.prunePrivate(folder) }
            JSONObject().put("settings",settings).put("filePath",file.path).put("filename",file.name).put("bytes",file.length())
        }
        else -> throw IllegalArgumentException("Android capability not implemented: $method")
    }
    private fun chat(args: JSONObject, router: Boolean): JSONObject {
        val profile=if(router) JSONObject() else profile(args.optString("profileId"))
        val token=store.get(if(router) "openrouter" else "provider-${profile.getString("id")}")
        val responses=!router && profile.optString("apiMode")=="responses"
        val base=if(router) "https://openrouter.ai/api/v1" else profile.getString("baseUrl").trimEnd('/')
        val body=JSONObject().put("model",args.optString("model",profile.optString("model"))).put("stream",false).put("temperature",args.optDouble("temperature",0.55))
        if(router){if(args.has("reasoning"))body.put("reasoning",args.get("reasoning"));body.put("provider",JSONObject().put("sort",if(args.optString("routingMode")=="speed")"throughput"else"price"))}
        val messages=args.getJSONArray("messages")
        if(responses) {
            val input=JSONArray(); val instructions= mutableListOf<String>()
            for(i in 0 until messages.length()){val m=messages.getJSONObject(i);if(m.optString("role")=="system")instructions.add(m.getString("content")) else input.put(m)}
            body.put("input",input).put("instructions",instructions.joinToString("\n")).put("max_output_tokens",args.optInt("maxTokens",3072))
            if(profile.optString("type")!="ollama")body.put("store",false)
        } else { body.put("messages",messages).put("max_tokens",args.optInt("maxTokens",3072)); if(args.has("responseFormat"))body.put("response_format",args.get("responseFormat")) }
        for(attempt in 0..3) {
            try {
                val p=json(base+if(responses) "/responses" else "/chat/completions","POST",body,token)
                var text=if(responses)p.optString("output_text") else p.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")?.optString("content") ?: ""
                if(responses && text.isEmpty()){val output=p.optJSONArray("output") ?: JSONArray();for(i in 0 until output.length()){val parts=output.getJSONObject(i).optJSONArray("content") ?: continue;for(j in 0 until parts.length())text+=parts.getJSONObject(j).optString("text")}}
                require(text.isNotBlank()) { "The model returned no text" }
                return JSONObject().put("text",text).put("model",body.get("model")).put("usage",p.opt("usage")).put("finishReason",p.optJSONArray("choices")?.optJSONObject(0)?.optString("finish_reason") ?: "stop")
            } catch(error: Exception) {
                val detail=error.message ?: ""
                if(detail.contains("temperature",true) && body.has("temperature"))body.remove("temperature")
                else if(body.has("response_format") && (detail.contains("400") || detail.contains("422")))body.remove("response_format")
                else throw error
            }
        }
        throw IllegalStateException("Model compatibility retry exhausted")
    }
    fun driveList(kind: String, app: String="chengjing-sync-v1"): JSONObject {
        require(kind in listOf("packet","asset","manifest"));require(app in listOf("chengjing-sync-v1",backupApp))
        val query="trashed = false and appProperties has { key='app' and value='$app' } and appProperties has { key='kind' and value='$kind' }"
        val all=JSONArray(); var cursor=""
        do { val url=Uri.parse("https://www.googleapis.com/drive/v3/files").buildUpon().appendQueryParameter("spaces","appDataFolder").appendQueryParameter("q",query).appendQueryParameter("pageSize","1000").appendQueryParameter("fields","nextPageToken,files(id,name,appProperties,size,createdTime)").apply{if(cursor.isNotEmpty())appendQueryParameter("pageToken",cursor)}.build().toString();val result=json(url,secret=store.get("google-token"));val rows=result.optJSONArray("files") ?: JSONArray();for(i in 0 until rows.length())all.put(rows.get(i));cursor=result.optString("nextPageToken") } while(cursor.isNotEmpty())
        return JSONObject().put("files",all)
    }
    fun driveGet(id: String): String { require(id.matches(Regex("[A-Za-z0-9_-]+"))); val request=Request.Builder().url("https://www.googleapis.com/drive/v3/files/$id?alt=media").header("Authorization","Bearer ${store.get("google-token")}").build();http.newCall(request).execute().use { require(it.isSuccessful){"Google Drive HTTP ${it.code}"};return it.body!!.string() } }
    fun drivePut(id: String,data: String,kind: String): JSONObject = synchronized(syncUploadLock) {
        require(kind in listOf("packet","asset")); require(id.matches(Regex("[A-Za-z0-9_-]+")))
        require(prefs.getBoolean("sync-enabled",false)){"Sync is paused"}
        require(data.toByteArray().size <= 16_000_000){"Sync packet is too large"}
        val known=driveList(kind).getJSONArray("files")
        for(index in 0 until known.length())if(known.getJSONObject(index).getString("name")==id)return@synchronized known.getJSONObject(index)
        val metadata=JSONObject().put("name",id).put("parents",JSONArray().put("appDataFolder")).put("appProperties",JSONObject().put("app","chengjing-sync-v1").put("kind",kind))
        val body=MultipartBody.Builder().setType("multipart/related".toMediaType()).addPart(metadata.toString().toRequestBody("application/json; charset=UTF-8".toMediaType())).addPart(data.toRequestBody("application/json".toMediaType())).build()
        val request=Request.Builder().url("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart").header("Authorization","Bearer ${store.get("google-token")}").post(body).build()
        http.newCall(request).execute().use{require(it.isSuccessful){"Google Drive HTTP ${it.code}"};JSONObject(it.body!!.string())}
    }
    private fun uploadAsset(asset: JSONObject, legacy: Boolean=false): JSONObject {
        val hash=asset.getString("sha256");require(hash.matches(Regex("[a-f0-9]{64}")))
        val app=if(legacy)backupApp else"chengjing-sync-v1"
        val rows=driveList("asset",app).getJSONArray("files");for(i in 0 until rows.length())if(rows.getJSONObject(i).getString("name")==hash||rows.getJSONObject(i).optJSONObject("appProperties")?.optString("sha256")==hash)return rows.getJSONObject(i)
        val source=safeFile(asset.getString("relativePath"));require(attachment(source,asset).getString("sha256")==hash)
        val metadata=JSONObject().put("name",hash).put("parents",JSONArray().put("appDataFolder")).put("appProperties",JSONObject().put("app",app).put("kind","asset").put("sha256",hash))
        val body=MultipartBody.Builder().setType("multipart/related".toMediaType()).addPart(metadata.toString().toRequestBody("application/json; charset=UTF-8".toMediaType())).addPart(source.asRequestBody("application/octet-stream".toMediaType())).build()
        http.newCall(Request.Builder().url("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart").header("Authorization","Bearer ${store.get("google-token")}").post(body).build()).execute().use{require(it.isSuccessful){"Google Drive HTTP ${it.code}"};return JSONObject(it.body!!.string())}
    }
    private fun downloadAsset(asset: JSONObject, legacy: Boolean=false): JSONObject {
        val hash=asset.getString("sha256");require(hash.matches(Regex("[a-f0-9]{64}")))
        val rows=driveList("asset",if(legacy)backupApp else"chengjing-sync-v1").getJSONArray("files");val match=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")==hash||it.optJSONObject("appProperties")?.optString("sha256")==hash}
        val file=safeFile(UUID.randomUUID().toString());val url="https://www.googleapis.com/drive/v3/files/${match.getString("id")}?alt=media"
        try {
            http.newCall(Request.Builder().url(url).header("Authorization","Bearer ${store.get("google-token")}").build()).execute().use{require(it.isSuccessful);it.body!!.byteStream().use{input->file.outputStream().use{output->input.copyTo(output)}}}
            val result=attachment(file,asset);require(result.getString("sha256")==hash){"Attachment verification failed"};return result
        } catch(error: Exception){file.delete();throw error}
    }
    private fun cloudSettings(): JSONObject {
        val settings=objectValue("cloud-backup","{\"enabled\":false,\"intervalMinutes\":30,\"lastSuccessAt\":0,\"lastKnownManifestId\":\"\",\"conflict\":false,\"accountName\":\"Google\",\"accountEmail\":\"\"}")
        if(!settings.has("deviceId")){settings.put("deviceId",UUID.randomUUID().toString());save("cloud-backup",settings)};return settings
    }
    private fun snapshots(): List<JSONObject> {
        val files=driveList("manifest",backupApp).getJSONArray("files")
        return (0 until files.length()).map{val file=files.getJSONObject(it);val p=file.getJSONObject("appProperties");JSONObject().put("id",file.getString("id")).put("size",file.optLong("size")).put("slot",p.optString("slot")).put("snapshotAt",Instant.parse(p.getString("snapshotAt")).toEpochMilli()).put("day",p.optString("day")).put("contentHash",p.optString("contentHash")).put("deviceId",p.optString("deviceId"))}.sortedByDescending{it.getLong("snapshotAt")}
    }
    @Synchronized private fun cloudStatus(remote: Boolean): JSONObject {
        val settings=cloudSettings();val connected=googleConnected();val list=if(remote&&connected)snapshots()else emptyList()
        val current=list.firstOrNull{it.optString("slot")=="current"};val previous=list.firstOrNull{it.optString("slot")=="previous"&&clock()-it.getLong("snapshotAt")<=172800000}
        val conflict=if(remote&&connected)current!=null&&current.optString("id")!=settings.optString("lastKnownManifestId")else settings.optBoolean("conflict")
        settings.put("conflict",conflict);if(conflict)settings.put("enabled",false);save("cloud-backup",settings)
        return JSONObject().put("configured",true).put("connected",connected).put("settings",settings).put("current",current?:JSONObject.NULL).put("previous",previous?:JSONObject.NULL).put("needsDecision",conflict)
    }
    private fun createCloudManifest(metadata: JSONObject, raw: String): JSONObject {
        val body=MultipartBody.Builder().setType("multipart/related".toMediaType()).addPart(metadata.toString().toRequestBody("application/json; charset=UTF-8".toMediaType())).addPart(raw.toRequestBody("application/json".toMediaType())).build()
        http.newCall(Request.Builder().url("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,appProperties").header("Authorization","Bearer ${store.get("google-token")}").post(body).build()).execute().use{require(it.isSuccessful){"Google Drive HTTP ${it.code}"};return JSONObject(it.body!!.string())}
    }
    @Synchronized private fun writeCloud(args: JSONObject): JSONObject {
        val settings=cloudSettings();val before=snapshots();val current=before.firstOrNull{it.optString("slot")=="current"}
        require(args.optBoolean("force")||current==null||current.getString("id")==settings.optString("lastKnownManifestId")){"Another device updated the cloud backup. Restore it or resolve the conflict first."}
        val raw=args.getString("data");val content=JSONObject(raw);require(content.optString("format")=="chengjing-backup"&&content.optInt("version")==2)
        val stable=JSONObject().put("format",content.get("format")).put("version",content.get("version")).put("attachmentMode",content.get("attachmentMode")).put("communityIdentity",content.opt("communityIdentity")).put("data",content.get("data"))
        val contentDigest=MessageDigest.getInstance("SHA-256").digest(stable.toString().toByteArray()).joinToString(""){"%02x".format(it)}
        if(current!=null&&current.optString("contentHash")==contentDigest){settings.put("lastSuccessAt",clock());save("cloud-backup",settings);runCatching{pruneCloudAssets()};return JSONObject().put("settings",settings).put("current",current).put("previous",before.firstOrNull{it.optString("slot")=="previous"&&clock()-it.getLong("snapshotAt")<=172800000}?:JSONObject.NULL).put("skipped",true).put("uploadedAssets",0).put("reusedAssets",0)}
        val assets=args.optJSONArray("assets")?:JSONArray();for(i in 0 until assets.length())uploadAsset(assets.getJSONObject(i),true)
        val checked=snapshots().firstOrNull{it.optString("slot")=="current"};require(checked?.optString("id")==current?.optString("id")){"Another device changed the cloud backup during upload."}
        val now=clock();val day=Instant.ofEpochMilli(now).atOffset(ZoneOffset.UTC).toLocalDate().toString();val hash=contentDigest
        val properties=JSONObject().put("app",backupApp).put("kind","manifest").put("slot","current").put("snapshotAt",Instant.ofEpochMilli(now).toString()).put("day",day).put("contentHash",hash).put("deviceId",settings.getString("deviceId"))
        val created=createCloudManifest(JSONObject().put("name","ChengJing-Cloud-Manifest-$now.json").put("parents",JSONArray().put("appDataFolder")).put("appProperties",properties),raw)
        var previous=before.firstOrNull{it.optString("slot")=="previous"&&now-it.getLong("snapshotAt")<=172800000}
        if(current!=null&&current.optString("day")!=day&&now-current.getLong("snapshotAt") in 0..172800000){
            val p=JSONObject(properties.toString()).put("slot","previous").put("snapshotAt",Instant.ofEpochMilli(current.getLong("snapshotAt")).toString()).put("day",current.getString("day")).put("contentHash",current.getString("contentHash")).put("deviceId",current.getString("deviceId"))
            json("https://www.googleapis.com/drive/v3/files/${current.getString("id")}","PATCH",JSONObject().put("appProperties",p),store.get("google-token"));previous=current
        }
        for(old in before)if(old.getString("id")!=previous?.optString("id"))json("https://www.googleapis.com/drive/v3/files/${old.getString("id")}","DELETE",secret=store.get("google-token"))
        settings.put("lastSuccessAt",now).put("lastKnownManifestId",created.getString("id")).put("lastContentHash",hash).put("enabled",true).put("conflict",false);save("cloud-backup",settings)
        runCatching { pruneCloudAssets() }
        return JSONObject().put("settings",settings).put("current",JSONObject().put("id",created.getString("id")).put("snapshotAt",now).put("size",raw.length).put("day",day)).put("previous",previous?:JSONObject.NULL).put("skipped",false).put("uploadedAssets",assets.length()).put("reusedAssets",0)
    }
    private fun downloadCloud(slot: String): JSONObject {
        require(slot in listOf("current","previous"));val snapshot=snapshots().first{it.getString("slot")==slot&&(slot=="current"||clock()-it.getLong("snapshotAt")<=172800000)}
        val raw=driveGet(snapshot.getString("id"));val content=JSONObject(raw);val assets=content.getJSONObject("data").optJSONArray("attachments")?:JSONArray();val staging=JSONObject()
        for(i in 0 until assets.length()){val asset=assets.getJSONObject(i);val stored=downloadAsset(asset,true);staging.put(asset.getString("sha256"),stored.getString("relativePath"))};save("restore-staging",staging)
        return JSONObject().put("data",raw).put("backupFilePath","android-cloud-staging").put("baselineManifestId",snapshot.getString("id")).put("contentHash",snapshot.optString("contentHash")).put("snapshot",snapshot)
    }
    private fun pruneCloudAssets() {
        // Never touch the separate sync namespace. Leave recent unreferenced blobs
        // alone: another device may still be uploading its snapshot.
        val manifests=snapshots()
        val expired=manifests.filter{it.optString("slot")=="previous"&&clock()-it.getLong("snapshotAt")>172800000}
        for(old in expired)json("https://www.googleapis.com/drive/v3/files/${old.getString("id")}","DELETE",secret=store.get("google-token"))
        val retained=manifests.filter{it !in expired}
        val referenced=retained.flatMap{BackupRetention.referencedHashes(driveGet(it.getString("id")))}.toSet()
        val assets=driveList("asset",backupApp).getJSONArray("files")
        if(snapshots().map{it.getString("id")}.toSet()!=retained.map{it.getString("id")}.toSet())return
        for(i in 0 until assets.length()){
            val asset=assets.getJSONObject(i);val hash=asset.optJSONObject("appProperties")?.optString("sha256")?:asset.optString("name")
            val created=runCatching{Instant.parse(asset.getString("createdTime")).toEpochMilli()}.getOrNull()?:continue
            if(hash !in referenced&&clock()-created>172800000)json("https://www.googleapis.com/drive/v3/files/${asset.getString("id")}","DELETE",secret=store.get("google-token"))
        }
    }
    internal fun cleanupFixture() {
        check(backupApp.startsWith("chengjing-backup-qa-"))
        for(kind in listOf("manifest","asset")) { val list=driveList(kind,backupApp).getJSONArray("files");for(i in 0 until list.length())json("https://www.googleapis.com/drive/v3/files/${list.getJSONObject(i).getString("id")}","DELETE",secret=store.get("google-token")) }
    }
}
