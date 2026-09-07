package tw.techtarian.chengjing

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.util.concurrent.Callable
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SyncRecoveryStoreTest {
    private val contract = SyncRecoveryContract

    private class Fixture {
        val contract = SyncRecoveryContract
        var now = Instant.parse("2026-09-09T12:00:00Z").toEpochMilli()
        var nativeSyncEnabled = true
        val files = linkedMapOf<String, JSONObject>()
        val contents = mutableMapOf<String, String>()
        val calls = CopyOnWriteArrayList<String>()
        val protected = mutableSetOf<String>()
        var sequence = 0
        var uploadHook: (() -> Unit)? = null
        var createHook: (() -> Unit)? = null
        var deleteHook: (() -> Unit)? = null

        private fun insert(properties: JSONObject, size: Long, raw: String? = null): JSONObject {
            val id = "file-${++sequence}"
            val file = JSONObject().put("id", id).put("size", size.toString())
                .put("createdTime", Instant.ofEpochMilli(now).toString())
                .put("appProperties", JSONObject(properties.toString()))
            files[id] = file
            if (raw != null) contents[id] = raw
            return file
        }

        val io = object : SyncRecoveryStore.IO {
            override fun listFiles(kind: String): List<JSONObject> {
                calls.add("list:$kind")
                // Deliberately include foreign files: the store must filter ownership.
                return files.values.toList()
            }
            override fun readText(id: String): String {
                calls.add("read:$id")
                return contents[id] ?: throw IllegalStateException("test-file-missing")
            }
            override fun createManifest(raw: String, properties: JSONObject): JSONObject {
                calls.add("create")
                createHook?.invoke()
                return insert(properties, raw.toByteArray(Charsets.UTF_8).size.toLong(), raw)
            }
            override fun uploadAsset(
                source: SyncRecoveryContract.Source, properties: JSONObject
            ): JSONObject {
                calls.add("upload:${source.sha256}")
                uploadHook?.invoke()
                return insert(properties, source.size)
            }
            override fun deleteManifest(id: String) {
                calls.add("delete:$id")
                deleteHook?.invoke()
                files.remove(id)
                contents.remove(id)
            }
            override fun protectedIds(): Set<String> = protected.toSet()
        }
        val store = SyncRecoveryStore(io, { now }, { nativeSyncEnabled })

        fun source(hash: String = "b".repeat(64), size: Long = 12L) = JSONObject()
            .put("relativePath", "test-local-file").put("sha256", hash).put("size", size)

        fun request(
            title: String = "測試內容 🌿",
            timestamp: Long = now,
            withAsset: Boolean = false
        ): JSONObject {
            val data = JSONObject()
            for (table in contract.TABLES) data.put(table, JSONArray())
            data.put("fragments", JSONArray().put(JSONObject().put("id", "fragment").put("text", title)))
            if (withAsset) data.put("attachments", JSONArray().put(
                JSONObject().put("id", "image").put("name", "圖片.png")
                    .put("sha256", "b".repeat(64)).put("size", 12)
            ))
            val raw = JSONObject().put("format", "chengjing-sync-recovery")
                .put("version", 1).put("dayBasis", "UTC").put("snapshotAt", timestamp)
                .put("data", data).toString()
            return JSONObject().put("data", raw)
                .put("assets", if (withAsset) JSONArray().put(source()) else JSONArray())
        }

        fun seed(id: String, timestamp: Long, title: String = "earlier"): JSONObject {
            val raw = request(title, timestamp).getString("data")
            val file = JSONObject().put("id", id)
                .put("size", raw.toByteArray(Charsets.UTF_8).size.toString())
                .put("createdTime", Instant.ofEpochMilli(timestamp).toString())
                .put("appProperties", JSONObject().put("app", contract.APP)
                    .put("kind", "manifest").put("schemaVersion", contract.SCHEMA)
                    .put("snapshotAt", Instant.ofEpochMilli(timestamp).toString())
                    .put("day", contract.day(timestamp)).put("contentHash", contract.hash(raw)))
            files[id] = file
            contents[id] = raw
            return file
        }

        fun mutations() = calls.filter {
            it == "create" || it.startsWith("upload:") || it.startsWith("delete:")
        }
    }

    private fun rejected(code: String, action: () -> Unit) {
        val error = runCatching(action).exceptionOrNull()
        assertNotNull("Expected failure containing $code", error)
        assertTrue("Expected $code but got $error", error?.message?.contains(code) == true)
    }

    @Test fun startsDisabledAndDoesNotAccessStorageWithoutPermission() {
        val h = Fixture()
        rejected("paused") { h.store.createDaily(h.request()) }
        assertTrue(h.calls.isEmpty())
    }

    @Test fun malformedSnapshotsFailBeforeAnyRemoteMutation() {
        val h = Fixture()
        h.store.setEnabled(true)
        val request = h.request()
        val payload = JSONObject(request.getString("data"))
        payload.getJSONObject("data").remove("tasks")
        request.put("data", payload.toString())
        rejected("tables-incomplete") { h.store.createDaily(request) }
        assertTrue(h.mutations().isEmpty())
    }

    @Test fun mismatchedAttachmentSourcesFailBeforeAnyUpload() {
        val h = Fixture()
        h.store.setEnabled(true)
        val request = h.request(withAsset = true)
        request.put("assets", JSONArray().put(h.source(size = 11)))
        rejected("asset-missing") { h.store.createDaily(request) }
        assertTrue(h.mutations().isEmpty())
    }

    @Test fun publishesVerifiedPointWithoutTouchingLegacyFiles() {
        val h = Fixture()
        h.files["legacy"] = JSONObject().put("id", "legacy")
            .put("appProperties", JSONObject().put("app", "chengjing-cloud-backup-v1").put("kind", "manifest"))
        h.store.setEnabled(true)
        val request = h.request()
        val result = h.store.createDaily(request)
        val id = result.getJSONObject("snapshot").getString("id")
        assertFalse(result.getBoolean("skipped"))
        assertEquals(id, result.getJSONObject("status").getJSONObject("today").getString("id"))
        assertEquals(request.getString("data"), h.store.readSnapshot(id).data)
        assertTrue(h.files.containsKey("legacy"))
    }

    @Test fun laterEditsCannotOverwriteTheFirstPointOfTheDay() {
        val h = Fixture()
        h.store.setEnabled(true)
        val first = h.store.createDaily(h.request("first"))
        h.now += 60_000
        val second = h.store.createDaily(h.request("later"))
        val id = first.getJSONObject("snapshot").getString("id")
        assertTrue(second.getBoolean("skipped"))
        assertEquals(id, second.getJSONObject("snapshot").getString("id"))
        assertEquals(1, h.calls.count { it == "create" })
        assertEquals("first", JSONObject(h.store.readSnapshot(id).data)
            .getJSONObject("data").getJSONArray("fragments").getJSONObject(0).getString("text"))
    }

    @Test fun failedRequestDoesNotBlockSubsequentValidPublication() {
        val h = Fixture()
        h.store.setEnabled(true)
        rejected("payload-invalid") { h.store.createDaily(JSONObject().put("data", "{")) }
        assertFalse(h.store.createDaily(h.request()).getBoolean("skipped"))
    }

    @Test fun uploadsOnlyReferencedSourcesBeforePublishingTheManifest() {
        val h = Fixture()
        h.store.setEnabled(true)
        val request = h.request(withAsset = true)
        request.getJSONArray("assets").put(h.source("c".repeat(64), 20))
        val result = h.store.createDaily(request)
        assertEquals(1, result.getInt("uploadedAssets"))
        assertEquals(listOf("upload:" + "b".repeat(64), "create"), h.mutations())
        val read = h.store.readSnapshot(result.getJSONObject("snapshot").getString("id"))
        assertEquals("b".repeat(64), read.assets.single().sha256)
    }

    @Test fun failedAssetUploadPreservesEveryExistingSnapshot() {
        val h = Fixture()
        h.seed("old", h.now - 4 * contract.DAY_MS)
        h.store.setEnabled(true)
        h.uploadHook = { throw IllegalStateException("network-offline") }
        rejected("network-offline") { h.store.createDaily(h.request(withAsset = true)) }
        assertTrue(h.files.containsKey("old"))
        assertFalse(h.calls.any { it == "create" || it.startsWith("delete:") })
    }

    @Test fun StatusAndReadOperationsNeverDeleteHistory() {
        val h = Fixture()
        h.seed("old", h.now - 4 * contract.DAY_MS)
        h.seed("yesterday", h.now - contract.DAY_MS)
        h.store.getStatus()
        h.store.readSnapshot("yesterday")
        assertTrue(h.mutations().isEmpty())
        assertTrue(h.files.containsKey("old"))
    }

    @Test fun VerifiedPublicationPrunesOnlyExpiredOwnedManifests() {
        val h = Fixture()
        h.seed("old", h.now - 4 * contract.DAY_MS)
        h.seed("yesterday", h.now - contract.DAY_MS)
        h.seed("before", h.now - 2 * contract.DAY_MS)
        h.store.setEnabled(true)
        h.store.createDaily(h.request())
        assertEquals(listOf("delete:old"), h.calls.filter { it.startsWith("delete:") })
        assertTrue(h.files.containsKey("yesterday"))
        assertTrue(h.files.containsKey("before"))
    }

    @Test fun CorruptRetainedHistoryDefersCleanupWithoutInvalidatingNewPoint() {
        val h = Fixture()
        h.seed("old", h.now - 4 * contract.DAY_MS)
        h.seed("yesterday", h.now - contract.DAY_MS)
        h.contents["yesterday"] = h.contents.getValue("yesterday") + " "
        h.store.setEnabled(true)
        val result = h.store.createDaily(h.request())
        assertFalse(result.getBoolean("skipped"))
        assertEquals("sync-recovery-cleanup-deferred", result.getString("cleanupWarning"))
        assertTrue(h.files.containsKey("old"))
        rejected("manifest-corrupt") { h.store.readSnapshot("yesterday") }
    }

    @Test fun AlteredRemoteBytesCannotBeReadAsAValidSnapshot() {
        val h = Fixture()
        h.seed("yesterday", h.now - contract.DAY_MS)
        h.contents["yesterday"] = h.request("tampered", h.now - contract.DAY_MS).getString("data")
        rejected("manifest-corrupt") { h.store.readSnapshot("yesterday") }
    }

    @Test fun MissingAttachmentPreventsReturningPartialRecoveryData() {
        val h = Fixture()
        h.store.setEnabled(true)
        val result = h.store.createDaily(h.request(withAsset = true))
        val assets = h.files.filterValues {
            it.getJSONObject("appProperties").optString("kind") == "asset"
        }.keys.toList()
        assets.forEach { h.files.remove(it) }
        rejected("asset-missing") {
            h.store.readSnapshot(result.getJSONObject("snapshot").getString("id"))
        }
    }

    @Test fun RechecksOtherDevicesAfterAttachmentUpload() {
        val h = Fixture()
        h.store.setEnabled(true)
        h.uploadHook = { h.seed("other-device", h.now - 60_000, "other device") }
        val result = h.store.createDaily(h.request(withAsset = true))
        assertTrue(result.getBoolean("skipped"))
        assertEquals("other-device", result.getJSONObject("snapshot").getString("id"))
        assertFalse(h.calls.contains("create"))
    }

    @Test fun PauseAndResumeInvalidateAnAlreadyStartedPublication() {
        val h = Fixture()
        h.store.setEnabled(true)
        h.uploadHook = {
            h.store.setEnabled(false)
            h.store.setEnabled(true)
        }
        rejected("paused") { h.store.createDaily(h.request(withAsset = true)) }
        assertFalse(h.calls.any { it == "create" || it.startsWith("delete:") })
        h.uploadHook = null
        assertFalse(h.store.createDaily(h.request(withAsset = true)).getBoolean("skipped"))
    }

    @Test fun CrossingUtcMidnightCannotMislabelAPoint() {
        val h = Fixture()
        h.store.setEnabled(true)
        h.uploadHook = { h.now += contract.DAY_MS }
        rejected("capture-date-changed") { h.store.createDaily(h.request(withAsset = true)) }
        assertFalse(h.calls.contains("create"))
    }

    @Test fun RejectsArbitraryDriveIdsAndExpiredSelections() {
        val h = Fixture()
        h.seed("expired", h.now - 4 * contract.DAY_MS)
        for (id in listOf("../secret", "unowned-file", "expired")) {
            rejected("sync-recovery-") { h.store.readSnapshot(id) }
        }
        assertFalse(h.calls.any { it.startsWith("read:") })
    }

    @Test fun ProtectsActiveDownloadsAndRecentlyUploadedOldPoints() {
        val h = Fixture()
        h.seed("protected", h.now - 4 * contract.DAY_MS)
        h.protected.add("protected")
        h.seed("recent-upload", h.now - 5 * contract.DAY_MS)
            .put("createdTime", Instant.ofEpochMilli(h.now - 60_000).toString())
        h.store.setEnabled(true)
        h.store.createDaily(h.request())
        assertTrue(h.files.containsKey("protected"))
        assertTrue(h.files.containsKey("recent-upload"))
        assertFalse(h.calls.any { it.startsWith("delete:") })
    }

    @Test fun ConcurrentDailyRequestsPublishOnlyOnePoint() {
        val h = Fixture()
        h.store.setEnabled(true)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val requests = listOf(h.request("A"), h.request("B"))
            val futures = requests.map { request ->
                executor.submit(Callable { h.store.createDaily(request) })
            }
            val results = futures.map { it.get(5, TimeUnit.SECONDS) }
            assertEquals(1, results.count { !it.getBoolean("skipped") })
            assertEquals(1, results.count { it.getBoolean("skipped") })
            assertEquals(1, h.calls.count { it == "create" })
        } finally {
            executor.shutdownNow()
            executor.awaitTermination(5, TimeUnit.SECONDS)
        }
    }

    @Test fun NativeSyncPermissionIsCheckedIndependentlyOfRendererEnablement() {
        val h = Fixture()
        h.store.setEnabled(true)
        h.nativeSyncEnabled = false
        rejected("paused") { h.store.createDaily(h.request()) }
        assertTrue(h.calls.isEmpty())
    }

    @Test fun PauseDoesNotWaitForAnInFlightUploadToFinish() {
        val h = Fixture()
        h.store.setEnabled(true)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        h.uploadHook = {
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS)) { "test-upload-timeout" }
        }
        val pending = executor.submit(Callable { h.store.createDaily(h.request(withAsset = true)) })
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            assertFalse(h.store.setEnabled(false).getBoolean("enabled"))
            h.store.setEnabled(true)
            release.countDown()
            rejected("paused") { pending.get(5, TimeUnit.SECONDS) }
            assertFalse(h.calls.contains("create"))
        } finally {
            release.countDown()
            executor.shutdownNow()
            executor.awaitTermination(5, TimeUnit.SECONDS)
        }
    }
}
