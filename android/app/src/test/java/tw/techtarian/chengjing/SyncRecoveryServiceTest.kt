package tw.techtarian.chengjing

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.time.Instant

class SyncRecoveryServiceTest {
    private val contract = SyncRecoveryContract
    private val root = Files.createTempDirectory("chengjing-recovery-service-test-").toFile()
    private val attachments = File(root, "attachments").apply { mkdirs() }
    private val staging = File(root, "recovery")
    private val original = File(attachments, "original.bin").apply {
        writeText("隔離附件內容 🌿", Charsets.UTF_8)
    }
    private val bytes = original.readBytes()
    private val hash = contract.hash(original.readText(Charsets.UTF_8))
    private val files = linkedMapOf<String, JSONObject>()
    private val contents = mutableMapOf<String, ByteArray>()
    private val calls = mutableListOf<String>()
    private var now = Instant.parse("2026-09-09T12:00:00Z").toEpochMilli()
    private var sequence = 0
    private var nativeEnabled = true
    private var uploadHook: ((File) -> Unit)? = null
    private var corruptDownload = false

    private fun insert(properties: JSONObject, bytes: ByteArray): JSONObject {
        val id = "file-${++sequence}"
        val file = JSONObject().put("id", id).put("size", bytes.size.toString())
            .put("createdTime", Instant.ofEpochMilli(now).toString())
            .put("appProperties", JSONObject(properties.toString()))
        files[id] = file
        contents[id] = bytes
        return file
    }

    private val remote = object : SyncRecoveryService.Remote {
        override fun listFiles(kind: String): List<JSONObject> = files.values.toList()
        override fun readText(id: String): String =
            contents.getValue(id).toString(Charsets.UTF_8)

        override fun createManifest(raw: String, properties: JSONObject): JSONObject {
            calls.add("manifest")
            return insert(properties, raw.toByteArray(Charsets.UTF_8))
        }

        override fun uploadAsset(
            file: File, source: SyncRecoveryContract.Source, properties: JSONObject
        ): JSONObject {
            calls.add("upload")
            uploadHook?.invoke(file)
            assertEquals(source.size, file.length())
            assertArrayEquals(bytes, file.readBytes())
            return insert(properties, file.readBytes())
        }

        override fun downloadAsset(id: String, destination: File, sha256: String, size: Long) {
            calls.add("download")
            val data = contents.getValue(id).copyOf()
            if (corruptDownload && data.isNotEmpty()) data[0] = (data[0].toInt() xor 1).toByte()
            Files.write(destination.toPath(), data,
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        }

        override fun deleteExpiredManifest(id: String, now: Long, protected: () -> Boolean) {
            check(!protected()) { "sync-recovery-restore-in-progress" }
            calls.add("delete:$id")
            files.remove(id)
            contents.remove(id)
        }
    }

    private val service = SyncRecoveryService(staging, attachments, remote, { nativeEnabled }, { now })

    @After fun cleanup() {
        root.deleteRecursively()
    }

    private fun request(withAsset: Boolean = true): JSONObject {
        val data = JSONObject()
        contract.TABLES.forEach { data.put(it, JSONArray()) }
        data.put("fragments", JSONArray().put(JSONObject().put("id", "one").put("text", "測試")))
        if (withAsset) data.put("attachments", JSONArray().put(
            JSONObject().put("id", "image").put("name", "測試附件.png")
                .put("mime", "image/png").put("sha256", hash)
                .put("size", bytes.size).put("createdAt", 1)
        ))
        val raw = JSONObject().put("format", "chengjing-sync-recovery").put("version", 1)
            .put("dayBasis", "UTC").put("snapshotAt", now).put("data", data).toString()
        val sources = JSONArray()
        if (withAsset) sources.put(JSONObject().put("relativePath", original.name)
            .put("sha256", hash).put("size", bytes.size))
        return JSONObject().put("data", raw).put("assets", sources)
    }

    private fun publish(withAsset: Boolean = true): String {
        service.setEnabled(true)
        return service.createDaily(request(withAsset)).getJSONObject("snapshot").getString("id")
    }

    private fun restoreArgs(download: JSONObject): JSONObject =
        JSONObject().put("backupFilePath", download.getString("backupFilePath"))
            .put("id", "image").put("sha256", hash).put("name", "ignored-request-name")

    private fun stages(): List<File> = staging.listFiles()?.toList().orEmpty()

    private fun rejected(code: String, action: () -> Unit) {
        val error = runCatching(action).exceptionOrNull()
        assertNotNull("Expected failure containing $code", error)
        assertTrue("Expected $code but got $error", error?.message?.contains(code) == true)
    }

    @Test fun disabledServiceNeverStartsAnUpload() {
        rejected("paused") { service.createDaily(request()) }
        assertTrue(calls.isEmpty())
        assertArrayEquals(bytes, original.readBytes())
    }

    @Test fun uploadsPrivateStableCopiesInsteadOfTheLiveAttachment() {
        uploadHook = { staged ->
            assertNotEquals(original.canonicalPath, staged.canonicalPath)
            assertTrue(staged.canonicalPath.startsWith(staging.canonicalPath + File.separator))
            original.writeText("newer local bytes")
        }
        publish()
        assertTrue(stages().isEmpty())
        assertEquals("newer local bytes", original.readText())
        assertEquals(listOf("upload", "manifest"), calls)
    }

    @Test fun refusesTraversalAbsolutePathsAndSymbolicLinks() {
        val outside = File(root, "personal.bin").apply { writeBytes(bytes) }
        Files.createSymbolicLink(File(attachments, "link.bin").toPath(), outside.toPath())
        service.setEnabled(true)
        for (name in listOf("../personal.bin", outside.absolutePath, "link.bin", "C:\\secret", "a/b")) {
            val value = request()
            value.getJSONArray("assets").getJSONObject(0).put("relativePath", name)
            rejected("path-invalid") { service.createDaily(value) }
        }
        assertTrue(calls.isEmpty())
        assertArrayEquals(bytes, outside.readBytes())
        assertArrayEquals(bytes, original.readBytes())
    }

    @Test fun corruptedLocalSourceFailsBeforeUploadAndLeavesNoTemporaryCopy() {
        original.writeText("changed")
        service.setEnabled(true)
        rejected("attachment-corrupt") { service.createDaily(request()) }
        assertTrue(calls.isEmpty())
        assertTrue(stages().isEmpty())
        assertEquals("changed", original.readText())
    }

    @Test fun networkFailureRemovesOnlyTheOwnedUploadStagingDirectory() {
        uploadHook = { throw IllegalStateException("test-offline") }
        service.setEnabled(true)
        rejected("test-offline") { service.createDaily(request()) }
        assertTrue(stages().isEmpty())
        assertArrayEquals(bytes, original.readBytes())
        assertFalse(calls.contains("manifest"))
    }

    @Test fun downloadReturnsACapabilityReferenceAndVerifiedManifest() {
        val id = publish()
        val result = service.download(id)
        assertTrue(result.getString("backupFilePath").startsWith(SyncRecoveryService.BACKUP_PREFIX))
        assertFalse(result.getString("backupFilePath").contains(root.absolutePath))
        assertEquals(id, result.getJSONObject("snapshot").getString("id"))
        val folder = stages().single()
        assertEquals(result.getString("data"), File(folder, "SyncRecovery.json").readText())
        assertArrayEquals(bytes, File(folder, "ChengJing-AutoBackup-Assets/$hash").readBytes())
        assertArrayEquals(bytes, original.readBytes())
    }

    @Test fun restoringAnAttachmentCreatesANewVerifiedFileWithoutOverwritingOriginal() {
        val download = service.download(publish())
        val restored = service.restoreAttachment(restoreArgs(download))
        assertEquals("image", restored.getString("id"))
        assertEquals("測試附件.png", restored.getString("name"))
        assertEquals("file", restored.getString("storage"))
        assertEquals(hash, restored.getString("sha256"))
        assertNotEquals(original.name, restored.getString("relativePath"))
        val target = File(attachments, restored.getString("relativePath"))
        assertArrayEquals(bytes, target.readBytes())
        service.releaseDownload(download.getString("restoreId"))
        assertArrayEquals(bytes, target.readBytes())
        assertArrayEquals(bytes, original.readBytes())
    }

    @Test fun cleaningOneDownloadCannotEraseAnotherSession() {
        val id = publish()
        val first = service.download(id)
        val second = service.download(id)
        assertNotEquals(first.getString("restoreId"), second.getString("restoreId"))
        assertEquals(2, stages().size)
        service.releaseDownload(first.getString("restoreId"))
        service.releaseDownload(first.getString("restoreId"))
        assertEquals(1, stages().size)
        val restored = service.restoreAttachment(restoreArgs(second))
        assertArrayEquals(bytes, File(attachments, restored.getString("relativePath")).readBytes())
        service.releaseDownload(second.getString("restoreId"))
        assertTrue(stages().isEmpty())
    }

    @Test fun corruptRemoteBytesNeverBecomeAReadyRestoreSession() {
        val id = publish()
        corruptDownload = true
        rejected("attachment-corrupt") { service.download(id) }
        assertTrue(stages().isEmpty())
        assertArrayEquals(bytes, original.readBytes())
        assertTrue(files.containsKey(id))
    }

    @Test fun rejectsForgedSessionReferencesAndArbitraryFilesystemCleanup() {
        val download = service.download(publish())
        for (reference in listOf(root.absolutePath, "../private", "sync-recovery:../private",
            "sync-recovery:00000000-0000-4000-8000-000000000000")) {
            val args = restoreArgs(download).put("backupFilePath", reference)
            rejected("sync-recovery-") { service.restoreAttachment(args) }
        }
        for (id in listOf(root.absolutePath, "../attachments", "file-1", "")) {
            rejected("restore-id-invalid") { service.releaseDownload(id) }
        }
        assertEquals(1, stages().size)
        assertArrayEquals(bytes, original.readBytes())
    }

    @Test fun onlyAttachmentsActuallyListedInTheSelectedSnapshotCanBeRestored() {
        val download = service.download(publish())
        val before = attachments.listFiles()!!.map { it.name }.toSet()
        rejected("asset-missing") {
            service.restoreAttachment(restoreArgs(download).put("id", "unlisted-image"))
        }
        rejected("attachment-corrupt") {
            service.restoreAttachment(restoreArgs(download).put("sha256", "c".repeat(64)))
        }
        assertEquals(before, attachments.listFiles()!!.map { it.name }.toSet())
    }

    @Test fun aReleasedSessionCannotRestoreAdditionalAttachments() {
        val download = service.download(publish())
        service.releaseDownload(download.getString("restoreId"))
        rejected("point-unavailable") { service.restoreAttachment(restoreArgs(download)) }
        assertTrue(stages().isEmpty())
    }

    @Test fun pauseAndResumePreventPublicationFromAnOlderUpload() {
        service.setEnabled(true)
        uploadHook = {
            service.setEnabled(false)
            service.setEnabled(true)
        }
        rejected("paused") { service.createDaily(request()) }
        assertFalse(calls.contains("manifest"))
        assertTrue(stages().isEmpty())
        assertArrayEquals(bytes, original.readBytes())
    }

    @Test fun activeDownloadPinsSurviveExpiryUntilTheSessionIsReleased() {
        val oldId = publish()
        val download = service.download(oldId)
        now += 4 * contract.DAY_MS
        service.createDaily(request())
        assertTrue(files.containsKey(oldId))
        assertFalse(calls.contains("delete:$oldId"))
        service.releaseDownload(download.getString("restoreId"))
        now += contract.DAY_MS
        service.createDaily(request())
        assertFalse(files.containsKey(oldId))
        assertTrue(calls.contains("delete:$oldId"))
    }

    @Test fun nativeSyncPermissionCannotBeBypassedByRendererEnablement() {
        service.setEnabled(true)
        nativeEnabled = false
        rejected("paused") { service.createDaily(request()) }
        assertTrue(calls.isEmpty())
    }

    @Test fun snapshotsWithoutAttachmentsAlsoUseIndependentCleanupSessions() {
        val result = service.download(publish(false))
        assertEquals(0, contract.parse(result.getString("data")).assets.size)
        assertEquals(1, stages().size)
        service.releaseDownload(result.getString("restoreId"))
        assertTrue(stages().isEmpty())
        assertArrayEquals(bytes, original.readBytes())
    }
}
