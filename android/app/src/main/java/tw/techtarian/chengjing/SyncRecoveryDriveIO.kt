package tw.techtarian.chengjing

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Authenticated Drive I/O for recovery files only.
 * The owner supplies current authorization; tokens and server error bodies
 * are never included in returned error messages.
 */
internal class SyncRecoveryDriveIO(
    private val accessToken: () -> String,
    client: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(180, TimeUnit.SECONDS).build()
) : SyncRecoveryService.Remote {
    private val contract = SyncRecoveryContract
    private val http = client.newBuilder()
        .followRedirects(false).followSslRedirects(false).build()
    private val api = "https://www.googleapis.com/drive/v3/files"
    private val uploadApi = "https://www.googleapis.com/upload/drive/v3/files"
    private val metadataFields = "id,name,size,createdTime,trashed,appProperties"

    private fun execute(builder: Request.Builder): Response {
        val token = accessToken()
        check(token.isNotBlank() && token.none { it.code < 32 || it.code == 127 }) {
            "sync-recovery-auth-required"
        }
        return http.newCall(builder.header("Authorization", "Bearer $token").build()).execute()
    }

    private fun requireOk(response: Response) {
        if (response.code == 401) throw IllegalStateException("sync-recovery-auth-required")
        check(response.isSuccessful) { "sync-recovery-drive-http-${response.code}" }
    }

    private fun text(response: Response, limit: Int): String {
        val body = response.body ?: throw IllegalStateException("sync-recovery-response-empty")
        check(body.contentLength() <= limit.toLong()) { "sync-recovery-response-too-large" }
        val bytes = ByteArrayOutputStream()
        body.byteStream().use { input ->
            val buffer = ByteArray(65_536)
            var total = 0L
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                check(total <= limit.toLong()) { "sync-recovery-response-too-large" }
                bytes.write(buffer, 0, count)
            }
        }
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
        } catch (_: Exception) {
            throw IllegalStateException("sync-recovery-response-invalid")
        }
    }

    private fun json(response: Response): JSONObject {
        requireOk(response)
        val raw = text(response, 8 * 1024 * 1024)
        return try { JSONObject(raw) } catch (_: Exception) {
            throw IllegalStateException("sync-recovery-response-invalid")
        }
    }

    private fun owned(file: JSONObject, kind: String): Boolean {
        val properties = file.optJSONObject("appProperties") ?: return false
        val id = file.opt("id") as? String ?: return false
        return !file.optBoolean("trashed") && contract.validId(id)
            && properties.opt("app") == contract.APP && properties.opt("kind") == kind
    }

    override fun listFiles(kind: String): List<JSONObject> {
        require(kind in listOf("manifest", "asset")) { "sync-recovery-kind-invalid" }
        val files = mutableListOf<JSONObject>()
        val cursors = mutableSetOf<String>()
        var cursor = ""
        do {
            val url = api.toHttpUrl().newBuilder()
                .addQueryParameter("spaces", "appDataFolder")
                .addQueryParameter("pageSize", "1000")
                .addQueryParameter("q",
                    "trashed=false and appProperties has { key='app' and value='${contract.APP}' }"
                    + " and appProperties has { key='kind' and value='$kind' }")
                .addQueryParameter("fields", "nextPageToken,incompleteSearch,files($metadataFields)")
                .apply { if (cursor.isNotEmpty()) addQueryParameter("pageToken", cursor) }
                .build()
            val result = execute(Request.Builder().url(url).get()).use { json(it) }
            check(!result.optBoolean("incompleteSearch")) { "sync-recovery-list-incomplete" }
            val rows = if (!result.has("files")) JSONArray() else
                result.optJSONArray("files")
                    ?: throw IllegalStateException("sync-recovery-list-incomplete")
            for (index in 0 until rows.length()) {
                val file = rows.optJSONObject(index)
                    ?: throw IllegalStateException("sync-recovery-list-incomplete")
                if (owned(file, kind)) files.add(file)
            }
            cursor = if (!result.has("nextPageToken") || result.isNull("nextPageToken")) ""
                else result.opt("nextPageToken") as? String
                    ?: throw IllegalStateException("sync-recovery-pagination-invalid")
            check(cursor.isEmpty() || cursors.add(cursor)) { "sync-recovery-pagination-invalid" }
        } while (cursor.isNotEmpty())
        return files
    }

    private fun metadata(id: String, kind: String): JSONObject? {
        require(contract.validId(id)) { "sync-recovery-invalid-id" }
        val url = "$api/$id".toHttpUrl().newBuilder()
            .addQueryParameter("fields", metadataFields).build()
        return execute(Request.Builder().url(url).get()).use { response ->
            if (response.code == 404) return@use null
            val file = json(response)
            check(file.opt("id") == id && owned(file, kind)) {
                "sync-recovery-file-not-owned"
            }
            file
        }
    }

    override fun readText(id: String): String {
        check(metadata(id, "manifest") != null) { "sync-recovery-point-unavailable" }
        val url = "$api/$id".toHttpUrl().newBuilder().addQueryParameter("alt", "media").build()
        return execute(Request.Builder().url(url).get()).use { response ->
            requireOk(response)
            text(response, contract.MAX_BYTES)
        }
    }

    private fun upload(
        name: String, properties: JSONObject, body: RequestBody
    ): JSONObject {
        val mime = body.contentType()?.toString() ?: "application/octet-stream"
        val metadata = JSONObject().put("name", name)
            .put("parents", JSONArray().put("appDataFolder"))
            .put("appProperties", JSONObject(properties.toString()))
        val startUrl = uploadApi.toHttpUrl().newBuilder()
            .addQueryParameter("uploadType", "resumable")
            .addQueryParameter("fields", metadataFields).build()
        val location = execute(Request.Builder().url(startUrl)
            .header("X-Upload-Content-Type", mime)
            .header("X-Upload-Content-Length", body.contentLength().toString())
            .post(metadata.toString().toRequestBody("application/json; charset=UTF-8".toMediaType()))
        ).use { response ->
            requireOk(response)
            response.header("Location")
                ?: throw IllegalStateException("sync-recovery-upload-session-invalid")
        }
        val destination = location.toHttpUrlOrNull()
        require(destination != null && destination.scheme == "https"
            && destination.host == "www.googleapis.com" && destination.port == 443
            && destination.username.isEmpty() && destination.password.isEmpty()
            && destination.fragment == null
            && destination.encodedPath == "/upload/drive/v3/files") {
            "sync-recovery-upload-session-invalid"
        }
        // A partial/failed upload never publishes a recovery manifest.
        return execute(Request.Builder().url(destination).put(body)).use { json(it) }
    }

    override fun createManifest(raw: String, properties: JSONObject): JSONObject {
        val payload = contract.parse(raw)
        require(properties.opt("app") == contract.APP && properties.opt("kind") == "manifest"
            && properties.opt("schemaVersion") == contract.SCHEMA
            && properties.opt("day") == payload.day
            && properties.opt("contentHash") == payload.contentHash
            && runCatching {
                java.time.Instant.parse(properties.getString("snapshotAt")).toEpochMilli()
            }.getOrNull() == payload.snapshotAt) { "sync-recovery-manifest-upload-invalid" }
        return upload(
            "ChengJing-Sync-Recovery-${payload.day}-${UUID.randomUUID()}.json",
            properties, raw.toRequestBody("application/json; charset=UTF-8".toMediaType())
        )
    }

    fun verifyFile(file: File, sha256: String, size: Long) {
        require(contract.validHash(sha256) && size >= 0) { "sync-recovery-asset-invalid" }
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        file.inputStream().use { input ->
            val buffer = ByteArray(65_536)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                check(total <= size) { "sync-recovery-attachment-corrupt" }
                digest.update(buffer, 0, count)
            }
        }
        check(total == size && digest.digest().joinToString("") { "%02x".format(it) } == sha256) {
            "sync-recovery-attachment-corrupt"
        }
    }

    /** Caller supplies a private, stable staging copy, never a live editor file. */
    override fun uploadAsset(
        file: File, source: SyncRecoveryContract.Source, properties: JSONObject
    ): JSONObject {
        require(properties.opt("app") == contract.APP && properties.opt("kind") == "asset"
            && properties.opt("sha256") == source.sha256
            && Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(properties.optString("day"))) {
            "sync-recovery-asset-upload-invalid"
        }
        verifyFile(file, source.sha256, source.size)
        return upload(
            "ChengJing-Sync-Recovery-Asset-${properties.getString("day")}-${source.sha256}",
            properties, file.asRequestBody("application/octet-stream".toMediaType())
        )
    }

    override fun downloadAsset(id: String, destination: File, sha256: String, size: Long) {
        require(contract.validHash(sha256) && size >= 0) { "sync-recovery-asset-invalid" }
        val file = metadata(id, "asset")
            ?: throw IllegalStateException("sync-recovery-asset-missing")
        check(file.getJSONObject("appProperties").opt("sha256") == sha256
            && file.opt("size")?.toString()?.toLongOrNull() == size) {
            "sync-recovery-attachment-corrupt"
        }
        val url = "$api/$id".toHttpUrl().newBuilder().addQueryParameter("alt", "media").build()
        var created = false
        try {
            execute(Request.Builder().url(url).get()).use { response ->
                requireOk(response)
                val body = response.body ?: throw IllegalStateException("sync-recovery-response-empty")
                check(body.contentLength() < 0 || body.contentLength() == size) {
                    "sync-recovery-attachment-corrupt"
                }
                Files.newOutputStream(destination.toPath(),
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { output ->
                    created = true
                    body.byteStream().use { input ->
                        val buffer = ByteArray(65_536)
                        var total = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            check(total <= size) { "sync-recovery-attachment-corrupt" }
                            output.write(buffer, 0, count)
                        }
                        check(total == size) { "sync-recovery-attachment-corrupt" }
                    }
                }
            }
            verifyFile(destination, sha256, size)
        } catch (error: Exception) {
            if (created) Files.deleteIfExists(destination.toPath())
            throw error
        }
    }

    override fun deleteExpiredManifest(id: String, now: Long, protected: () -> Boolean) {
        require(contract.validId(id)) { "sync-recovery-invalid-id" }
        check(!protected()) { "sync-recovery-restore-in-progress" }
        val file = metadata(id, "manifest") ?: return
        val snapshot = contract.normalize(file)
            ?: throw IllegalStateException("sync-recovery-delete-not-owned-or-expired")
        check(contract.select(listOf(file), now).expired.any { it.id == id }
            && now - snapshot.createdAt >= contract.DAY_MS) {
            "sync-recovery-delete-not-owned-or-expired"
        }
        check(!protected()) { "sync-recovery-restore-in-progress" }
        execute(Request.Builder().url("$api/$id").delete()).use { response ->
            if (response.code != 404) requireOk(response)
        }
    }
}
