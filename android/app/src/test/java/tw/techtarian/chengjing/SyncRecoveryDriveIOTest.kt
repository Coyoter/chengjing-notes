package tw.techtarian.chengjing

import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.Instant

class SyncRecoveryDriveIOTest {
    private val contract = SyncRecoveryContract
    private val folder = Files.createTempDirectory("chengjing-recovery-http-test-").toFile()
    private val now = Instant.parse("2026-09-09T12:00:00Z").toEpochMilli()
    private val files = linkedMapOf<String, JSONObject>()
    private val media = mutableMapOf<String, ByteArray>()
    private val sessions = mutableMapOf<String, JSONObject>()
    private val calls = mutableListOf<Request>()
    private var sequence = 0
    private var token = "qa-test-token"
    private var locationOverride: String? = null
    private var listOverride: ((HttpUrl) -> JSONObject)? = null
    private var httpFailure: Int? = null
    private var corruptDownloads = false
    private val client = OkHttpClient.Builder()
        .dns(object : okhttp3.Dns {
            override fun lookup(hostname: String): List<java.net.InetAddress> {
                throw AssertionError("Tests must never access the network")
            }
        })
        .addInterceptor { chain -> respond(chain.request()) }.build()
    private val io = SyncRecoveryDriveIO({ token }, client)

    @After fun cleanup() {
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdownNow()
        folder.deleteRecursively()
    }

    private fun response(
        request: Request, bytes: ByteArray = "{}".toByteArray(), code: Int = 200,
        location: String? = null
    ): Response = Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
        .code(code).message("test")
        .body(bytes.toResponseBody("application/json".toMediaType()))
        .apply { if (location != null) header("Location", location) }.build()

    private fun json(request: Request, value: JSONObject, code: Int = 200) =
        response(request, value.toString().toByteArray(Charsets.UTF_8), code)

    private fun respond(request: Request): Response {
        calls.add(request)
        httpFailure?.let {
            return response(request, "Bearer hidden-server-secret /private/path".toByteArray(), it)
        }
        val url = request.url
        if (request.method == "GET" && url.encodedPath == "/drive/v3/files") {
            val custom = listOverride?.invoke(url)
            return json(request, custom ?: JSONObject().put("files", JSONArray(files.values.toList())))
        }
        if (request.method == "POST" && url.encodedPath == "/upload/drive/v3/files") {
            val buffer = Buffer()
            request.body!!.writeTo(buffer)
            val key = "session-${sessions.size + 1}"
            sessions[key] = JSONObject(buffer.readUtf8())
            return response(request, location = locationOverride
                ?: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=$key")
        }
        if (request.method == "PUT" && url.encodedPath == "/upload/drive/v3/files") {
            val metadata = sessions[url.queryParameter("upload_id")]
                ?: throw AssertionError("Unknown test upload session")
            val buffer = Buffer()
            request.body!!.writeTo(buffer)
            return json(request, insert(metadata.getJSONObject("appProperties"), buffer.readByteArray()))
        }
        val id = url.pathSegments.last()
        val file = files[id] ?: return json(request, JSONObject(), 404)
        if (request.method == "DELETE") {
            files.remove(id)
            media.remove(id)
            return response(request, byteArrayOf(), 204)
        }
        if (url.queryParameter("alt") == "media") {
            val bytes = media.getValue(id)
            val returned = if (corruptDownloads && bytes.isNotEmpty())
                bytes.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() } else bytes
            return response(request, returned)
        }
        return json(request, file)
    }

    private fun insert(properties: JSONObject, bytes: ByteArray): JSONObject {
        val id = "file-${++sequence}"
        val file = JSONObject().put("id", id).put("size", bytes.size.toString())
            .put("createdTime", Instant.ofEpochMilli(now).toString())
            .put("appProperties", JSONObject(properties.toString()))
        files[id] = file
        media[id] = bytes
        return file
    }

    private fun manifest(timestamp: Long = now): Pair<String, JSONObject> {
        val data = JSONObject()
        contract.TABLES.forEach { data.put(it, JSONArray()) }
        data.put("fragments", JSONArray().put(JSONObject().put("id", "one").put("text", "跨裝置測試 🌿")))
        val raw = JSONObject().put("format", "chengjing-sync-recovery").put("version", 1)
            .put("dayBasis", "UTC").put("snapshotAt", timestamp).put("data", data).toString()
        val props = JSONObject().put("app", contract.APP).put("kind", "manifest")
            .put("schemaVersion", contract.SCHEMA).put("day", contract.day(timestamp))
            .put("snapshotAt", Instant.ofEpochMilli(timestamp).toString())
            .put("contentHash", contract.hash(raw))
        return raw to props
    }

    private fun asset(): Triple<File, SyncRecoveryContract.Source, JSONObject> {
        val file = File(folder, "upload-${sequence}-${System.nanoTime()}.bin")
        file.writeText("附件串流內容 🌿", Charsets.UTF_8)
        val source = SyncRecoveryContract.Source(file.name,
            contract.hash(file.readText(Charsets.UTF_8)), file.length())
        val props = JSONObject().put("app", contract.APP).put("kind", "asset")
            .put("day", contract.day(now)).put("sha256", source.sha256)
        return Triple(file, source, props)
    }

    private fun rejected(code: String, action: () -> Unit) {
        val error = runCatching(action).exceptionOrNull()
        assertNotNull("Expected failure containing $code", error)
        assertTrue("Expected $code but got $error", error?.message?.contains(code) == true)
    }

    @Test fun queryIsRestrictedToAppDataAndTheRecoveryNamespace() {
        io.listFiles("manifest")
        val request = calls.single()
        assertEquals("appDataFolder", request.url.queryParameter("spaces"))
        assertTrue(request.url.queryParameter("q")!!.contains(contract.APP))
        assertTrue(request.url.queryParameter("q")!!.contains("manifest"))
        assertTrue(request.url.queryParameter("fields")!!.contains("createdTime"))
        assertEquals("Bearer qa-test-token", request.header("Authorization"))
    }

    @Test fun absentAuthorizationDoesNotIssueARequest() {
        token = ""
        rejected("auth-required") { io.listFiles("manifest") }
        assertTrue(calls.isEmpty())
    }

    @Test fun uploadsAndReadsExactManifestBytesThroughAValidatedSession() {
        val (raw, props) = manifest()
        val uploaded = io.createManifest(raw, props)
        assertEquals(raw, io.readText(uploaded.getString("id")))
        assertEquals(listOf("POST", "PUT"), calls.take(2).map { it.method })
        assertEquals("resumable", calls.first().url.queryParameter("uploadType"))
        assertEquals(contract.hash(raw), contract.parse(io.readText(uploaded.getString("id"))).contentHash)
    }

    @Test fun refusesUploadSessionUrlsThatCouldLeakAuthorization() {
        val (raw, props) = manifest()
        for (url in listOf(
            "https://evil.invalid/upload/drive/v3/files",
            "http://www.googleapis.com/upload/drive/v3/files",
            "https://www.googleapis.com:8443/upload/drive/v3/files",
            "https://name:secret@www.googleapis.com/upload/drive/v3/files",
            "https://www.googleapis.com/other-service"
        )) {
            calls.clear()
            locationOverride = url
            rejected("upload-session-invalid") { io.createManifest(raw, props) }
            assertEquals(1, calls.size)
            assertEquals("POST", calls.single().method)
        }
    }

    @Test fun redirectsAreRejectedInsteadOfForwardingTheBearerToken() {
        httpFailure = 302
        rejected("drive-http-302") { io.listFiles("manifest") }
        assertEquals(1, calls.size)
    }

    @Test fun invalidIdsAndKindsFailBeforeAnyRequest() {
        for (id in listOf("../secret", "file?alt=media", "", "a/b")) {
            rejected("invalid-id") { io.readText(id) }
        }
        rejected("kind-invalid") { io.listFiles("packet") }
        assertTrue(calls.isEmpty())
    }

    @Test fun filtersForeignAndTrashedFilesAndRejectsForeignDirectReads() {
        val (raw, props) = manifest()
        val valid = insert(props, raw.toByteArray())
        val foreign = insert(JSONObject(props.toString()).put("app", "chengjing-cloud-backup-v1"), raw.toByteArray())
        insert(props, raw.toByteArray()).put("trashed", true)
        assertEquals(listOf(valid.getString("id")), io.listFiles("manifest").map { it.getString("id") })
        rejected("file-not-owned") { io.readText(foreign.getString("id")) }
        assertFalse(calls.any { it.url.pathSegments.last() == foreign.getString("id")
            && it.url.queryParameter("alt") == "media" })
    }

    @Test fun readsEveryPageBeforeReturningTheInventory() {
        val (raw, props) = manifest()
        val file = insert(props, raw.toByteArray())
        listOverride = { url ->
            if (url.queryParameter("pageToken") == null)
                JSONObject().put("files", JSONArray()).put("nextPageToken", "page2")
            else JSONObject().put("files", JSONArray().put(file))
        }
        assertEquals(1, io.listFiles("manifest").size)
        assertEquals(2, calls.size)
    }

    @Test fun rejectsIncompleteAndLoopingListings() {
        listOverride = { JSONObject().put("files", JSONArray()).put("incompleteSearch", true) }
        rejected("list-incomplete") { io.listFiles("manifest") }
        listOverride = { JSONObject().put("files", JSONArray()).put("nextPageToken", "repeat") }
        rejected("pagination-invalid") { io.listFiles("manifest") }
    }

    @Test fun verifiesLocalAttachmentBytesBeforeStartingAnUpload() {
        val (file, source, props) = asset()
        file.writeText("different")
        rejected("attachment-corrupt") { io.uploadAsset(file, source, props) }
        assertTrue(calls.isEmpty())
    }

    @Test fun attachmentUploadAndDownloadPreserveExactBytes() {
        val (file, source, props) = asset()
        val uploaded = io.uploadAsset(file, source, props)
        val target = File(folder, "download.bin")
        io.downloadAsset(uploaded.getString("id"), target, source.sha256, source.size)
        assertArrayEquals(file.readBytes(), target.readBytes())
    }

    @Test fun corruptDownloadRemovesOnlyItsNewPartialFile() {
        val (file, source, props) = asset()
        val uploaded = io.uploadAsset(file, source, props)
        val target = File(folder, "corrupt.bin")
        corruptDownloads = true
        rejected("attachment-corrupt") {
            io.downloadAsset(uploaded.getString("id"), target, source.sha256, source.size)
        }
        assertFalse(target.exists())
        assertTrue(file.exists())
        io.verifyFile(file, source.sha256, source.size)
    }

    @Test fun downloadNeverOverwritesAnExistingDestination() {
        val (file, source, props) = asset()
        val uploaded = io.uploadAsset(file, source, props)
        val target = File(folder, "personal.txt").apply { writeText("preserve this") }
        assertTrue(runCatching {
            io.downloadAsset(uploaded.getString("id"), target, source.sha256, source.size)
        }.isFailure)
        assertEquals("preserve this", target.readText())
    }

    @Test fun revalidatesExpiryAndOwnershipBeforeDeletingAManifest() {
        val (oldRaw, oldProps) = manifest(now - 4 * contract.DAY_MS)
        val old = insert(oldProps, oldRaw.toByteArray())
            .put("createdTime", Instant.ofEpochMilli(now - 4 * contract.DAY_MS).toString())
        io.deleteExpiredManifest(old.getString("id"), now) { false }
        assertFalse(files.containsKey(old.getString("id")))

        val (raw, props) = manifest()
        val current = insert(props, raw.toByteArray())
        rejected("not-owned-or-expired") {
            io.deleteExpiredManifest(current.getString("id"), now) { false }
        }
        val foreign = insert(JSONObject(oldProps.toString()).put("app", "chengjing-cloud-backup-v1"), oldRaw.toByteArray())
        rejected("file-not-owned") {
            io.deleteExpiredManifest(foreign.getString("id"), now) { false }
        }
        assertTrue(files.containsKey(current.getString("id")))
        assertTrue(files.containsKey(foreign.getString("id")))
        assertEquals(1, calls.count { it.method == "DELETE" })
    }

    @Test fun protectedDownloadsPreventDeletionBothBeforeAndAfterMetadataReads() {
        val (raw, props) = manifest(now - 4 * contract.DAY_MS)
        val old = insert(props, raw.toByteArray())
            .put("createdTime", Instant.ofEpochMilli(now - 4 * contract.DAY_MS).toString())
        rejected("restore-in-progress") {
            io.deleteExpiredManifest(old.getString("id"), now) { true }
        }
        assertTrue(calls.isEmpty())
        var checks = 0
        rejected("restore-in-progress") {
            io.deleteExpiredManifest(old.getString("id"), now) { ++checks > 1 }
        }
        assertTrue(files.containsKey(old.getString("id")))
        assertFalse(calls.any { it.method == "DELETE" })
    }

    @Test fun manifestCleanupCannotDeleteAssetBlobs() {
        val (file, source, props) = asset()
        val uploaded = io.uploadAsset(file, source, props)
        rejected("file-not-owned") {
            io.deleteExpiredManifest(uploaded.getString("id"), now) { false }
        }
        assertTrue(files.containsKey(uploaded.getString("id")))
        assertFalse(calls.any { it.method == "DELETE" })
    }

    @Test fun errorsNeverExposeResponseBodiesCredentialsOrPrivatePaths() {
        httpFailure = 403
        val error = runCatching { io.listFiles("manifest") }.exceptionOrNull()
        assertEquals("sync-recovery-drive-http-403", error?.message)
        assertFalse(error.toString().contains("hidden-server-secret"))
        assertFalse(error.toString().contains("/private/path"))
        httpFailure = 401
        rejected("auth-required") { io.listFiles("manifest") }
    }
}
