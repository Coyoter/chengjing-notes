package tw.techtarian.chengjing

import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Android recovery filesystem boundary. It has no Context or credential access,
 * so the same implementation can be exercised in isolated JVM tests.
 */
internal class SyncRecoveryService(
    private val stagingDirectory: File,
    private val attachmentsDirectory: File,
    private val remote: Remote,
    private val mayWrite: () -> Boolean,
    private val clock: () -> Long = { System.currentTimeMillis() }
) : SyncRecoveryNativeBridge.Actions {
    companion object {
        const val BACKUP_PREFIX = "sync-recovery:"
    }

    interface Remote {
        fun listFiles(kind: String): List<JSONObject>
        fun readText(id: String): String
        fun createManifest(raw: String, properties: JSONObject): JSONObject
        fun uploadAsset(
            file: File, source: SyncRecoveryContract.Source, properties: JSONObject
        ): JSONObject
        fun downloadAsset(id: String, destination: File, sha256: String, size: Long)
        fun deleteExpiredManifest(id: String, now: Long, protected: () -> Boolean)
    }

    private class DownloadSession(
        val directory: Path,
        val snapshotId: String
    ) {
        var ready = false
        var attachments: Map<String, JSONObject> = emptyMap()
    }

    private val contract = SyncRecoveryContract
    private val control = Any()
    private val writes = Any()
    private val pins = Any()
    private var enabled = false
    private var generation = 0L
    private val writeTicket = ThreadLocal<Long>()
    private val downloads = ConcurrentHashMap<String, DownloadSession>()

    private fun allowed(ticket: Long): Boolean =
        synchronized(control) { enabled && generation == ticket } && mayWrite()

    private fun assertWrite() {
        val ticket = writeTicket.get()
        check(ticket != null && allowed(ticket)) { "sync-recovery-paused" }
    }

    private val store = SyncRecoveryStore(object : SyncRecoveryStore.IO {
        override fun listFiles(kind: String) = remote.listFiles(kind)
        override fun readText(id: String) = remote.readText(id)

        override fun createManifest(raw: String, properties: JSONObject): JSONObject {
            assertWrite()
            return remote.createManifest(raw, properties)
        }

        override fun uploadAsset(
            source: SyncRecoveryContract.Source, properties: JSONObject
        ): JSONObject {
            assertWrite()
            val original = attachmentPath(source.relativePath)
            val directory = newStaging("upload-")
            try {
                val staged = directory.resolve("asset")
                copyVerified(original, staged, source.sha256, source.size)
                assertWrite()
                return remote.uploadAsset(staged.toFile(), source, properties)
            } finally {
                removeStaging(directory)
            }
        }

        override fun protectedIds(): Set<String> =
            downloads.values.map { it.snapshotId }.toSet()

        override fun deleteManifest(id: String) {
            assertWrite()
            val ticket = writeTicket.get()!!
            // A new local download cannot race between the pin check and deletion.
            synchronized(pins) {
                remote.deleteExpiredManifest(id, clock()) {
                    !allowed(ticket) || downloads.values.any { it.snapshotId == id }
                }
            }
        }
    }, clock, mayWrite)

    override fun setEnabled(value: Boolean): JSONObject = synchronized(control) {
        if (enabled != value) {
            enabled = value
            generation++
        }
        store.setEnabled(value)
    }

    override fun getStatus(): JSONObject = store.getStatus()

    override fun createDaily(request: JSONObject): JSONObject {
        // Capture before waiting: pause/resume must invalidate already queued work.
        val ticket = synchronized(control) { generation }
        return synchronized(writes) {
            check(allowed(ticket)) { "sync-recovery-paused" }
            writeTicket.set(ticket)
            try {
                store.createDaily(request)
            } finally {
                writeTicket.remove()
            }
        }
    }

    private fun directory(path: File): Path {
        check(!Files.isSymbolicLink(path.toPath())) { "sync-recovery-path-invalid" }
        Files.createDirectories(path.toPath())
        check(Files.isDirectory(path.toPath(), LinkOption.NOFOLLOW_LINKS)) {
            "sync-recovery-path-invalid"
        }
        return path.toPath().toRealPath()
    }

    private fun newStaging(prefix: String): Path {
        val root = directory(stagingDirectory)
        val attachments = directory(attachmentsDirectory)
        check(!root.startsWith(attachments) && !attachments.startsWith(root)) {
            "sync-recovery-directories-invalid"
        }
        return Files.createTempDirectory(root, prefix)
    }

    private fun attachmentPath(name: String): Path {
        // Native attachment storage uses flat, app-generated filenames.
        require(name.isNotBlank() && name != "." && name != ".."
            && !name.contains('/') && !name.contains('\\')
            && !name.contains(':') && !name.contains('\u0000')) {
            "sync-recovery-path-invalid"
        }
        val root = directory(attachmentsDirectory)
        val file = root.resolve(name)
        check(Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
            && !Files.isSymbolicLink(file) && file.toRealPath().parent == root) {
            "sync-recovery-path-invalid"
        }
        return file
    }

    private fun copyVerified(source: Path, target: Path, hash: String, size: Long) {
        require(contract.validHash(hash) && size >= 0) { "sync-recovery-asset-invalid" }
        check(Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) {
            "sync-recovery-attachment-missing"
        }
        var created = false
        try {
            FileChannel.open(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { output ->
                created = true
                val digest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                Files.newInputStream(source, LinkOption.NOFOLLOW_LINKS).use { input ->
                    val buffer = ByteArray(65_536)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        check(total <= size) { "sync-recovery-attachment-corrupt" }
                        digest.update(buffer, 0, count)
                        val bytes = ByteBuffer.wrap(buffer, 0, count)
                        while (bytes.hasRemaining()) output.write(bytes)
                    }
                }
                check(total == size
                    && digest.digest().joinToString("") { "%02x".format(it) } == hash) {
                    "sync-recovery-attachment-corrupt"
                }
                output.force(true)
            }
        } catch (error: Exception) {
            if (created) Files.deleteIfExists(target)
            throw error
        }
    }

    private fun verifyDownloaded(path: Path, hash: String, size: Long) {
        check(Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            "sync-recovery-attachment-missing"
        }
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS).use { input ->
            val buffer = ByteArray(65_536)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                check(total <= size) { "sync-recovery-attachment-corrupt" }
                digest.update(buffer, 0, count)
            }
        }
        check(total == size && digest.digest().joinToString("") { "%02x".format(it) } == hash) {
            "sync-recovery-attachment-corrupt"
        }
    }

    private fun removeStaging(path: Path) {
        val root = stagingDirectory.canonicalFile.toPath()
        check(path.parent == root
            && (path.fileName.toString().startsWith("upload-")
                || path.fileName.toString().startsWith("download-"))) {
            "sync-recovery-staging-path-invalid"
        }
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return
        // walkFileTree does not follow symbolic links without FOLLOW_LINKS.
        Files.walkFileTree(path, object : SimpleFileVisitor<Path>() {
            override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                Files.delete(file)
                return FileVisitResult.CONTINUE
            }
            override fun postVisitDirectory(dir: Path, error: IOException?): FileVisitResult {
                if (error != null) throw error
                Files.delete(dir)
                return FileVisitResult.CONTINUE
            }
        })
    }

    override fun download(id: String): JSONObject {
        require(contract.validId(id)) { "sync-recovery-invalid-id" }
        val restoreId = UUID.randomUUID().toString()
        val session = DownloadSession(newStaging("download-"), id)
        synchronized(pins) { downloads[restoreId] = session }
        return synchronized(session) {
            try {
                val result = store.readSnapshot(id)
                val payload = contract.parse(result.data)
                val assetRoot = Files.createDirectory(
                    session.directory.resolve("ChengJing-AutoBackup-Assets")
                )
                for (asset in result.assets) {
                    val target = assetRoot.resolve(asset.sha256)
                    remote.downloadAsset(asset.fileId, target.toFile(), asset.sha256, asset.size)
                    verifyDownloaded(target, asset.sha256, asset.size)
                }
                val manifest = session.directory.resolve("SyncRecovery.json")
                FileChannel.open(manifest,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { output ->
                    val bytes = ByteBuffer.wrap(result.data.toByteArray(Charsets.UTF_8))
                    while (bytes.hasRemaining()) output.write(bytes)
                    output.force(true)
                }
                val rows = payload.root.getJSONObject("data").getJSONArray("attachments")
                session.attachments = (0 until rows.length()).associate { index ->
                    val row = rows.getJSONObject(index)
                    row.getString("id") to JSONObject(row.toString())
                }
                session.ready = true
                JSONObject().put("restoreId", restoreId).put("data", result.data)
                    .put("backupFilePath", BACKUP_PREFIX + restoreId)
                    .put("snapshot", result.snapshot.publicJson())
            } catch (error: Exception) {
                // Keep the pin if cleanup itself fails; never remove another session.
                if (runCatching { removeStaging(session.directory) }.isSuccess) {
                    downloads.remove(restoreId, session)
                }
                throw error
            }
        }
    }

    private fun validRestoreId(id: String) =
        Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}").matches(id)

    override fun restoreAttachment(args: JSONObject): JSONObject {
        val reference = args.opt("backupFilePath") as? String
            ?: throw IllegalArgumentException("sync-recovery-restore-id-invalid")
        require(reference.startsWith(BACKUP_PREFIX)) { "sync-recovery-restore-id-invalid" }
        val restoreId = reference.removePrefix(BACKUP_PREFIX)
        require(validRestoreId(restoreId)) { "sync-recovery-restore-id-invalid" }
        val session = downloads[restoreId]
            ?: throw IllegalStateException("sync-recovery-point-unavailable")

        return synchronized(session) {
            check(session.ready && downloads[restoreId] === session) {
                "sync-recovery-point-unavailable"
            }
            val id = args.opt("id") as? String
                ?: throw IllegalArgumentException("sync-recovery-record-invalid")
            val expected = session.attachments[id]
                ?: throw IllegalStateException("sync-recovery-asset-missing")
            val hash = expected.getString("sha256")
            check(args.opt("sha256") == hash) { "sync-recovery-attachment-corrupt" }
            val source = session.directory.resolve("ChengJing-AutoBackup-Assets").resolve(hash)
            val relativePath = UUID.randomUUID().toString()
            val target = directory(attachmentsDirectory).resolve(relativePath)
            copyVerified(source, target, hash, expected.getLong("size"))
            JSONObject(expected.toString()).put("storage", "file").put("relativePath", relativePath)
        }
    }

    override fun releaseDownload(restoreId: String): JSONObject {
        require(validRestoreId(restoreId)) { "sync-recovery-restore-id-invalid" }
        val session = downloads[restoreId] ?: return JSONObject().put("cleaned", true)
        return synchronized(session) {
            if (downloads[restoreId] === session) {
                removeStaging(session.directory)
                downloads.remove(restoreId, session)
                session.ready = false
            }
            JSONObject().put("cleaned", true)
        }
    }
}
