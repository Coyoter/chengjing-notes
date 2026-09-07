package tw.techtarian.chengjing

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Daily recovery storage, independent of Android UI and Google authentication.
 * The adapter owns authenticated I/O, asset byte verification and safe deletion.
 * No legacy backup settings or synchronized records are modified here.
 */
internal class SyncRecoveryStore(
    private val io: IO,
    private val clock: () -> Long,
    private val mayWrite: () -> Boolean
) {
    interface IO {
        fun listFiles(kind: String): List<JSONObject>
        fun readText(id: String): String
        fun createManifest(raw: String, properties: JSONObject): JSONObject
        fun uploadAsset(source: SyncRecoveryContract.Source, properties: JSONObject): JSONObject
        // Must revalidate ownership/expiry and active download pins before deletion.
        fun deleteManifest(id: String)
        fun protectedIds(): Set<String> = emptySet()
    }

    data class DownloadAsset(val sha256: String, val size: Long, val fileId: String)
    data class VerifiedSnapshot(
        val data: String,
        val snapshot: SyncRecoveryContract.Snapshot,
        val assets: List<DownloadAsset>
    )

    private val contract = SyncRecoveryContract
    private val stateLock = Any()
    private val writeLock = Any()
    private var enabled = false
    private var generation = 0L

    /** This never waits behind network or filesystem operations. */
    fun setEnabled(value: Boolean): JSONObject = synchronized(stateLock) {
        if (enabled != value) {
            enabled = value
            generation++
        }
        JSONObject().put("enabled", enabled)
    }

    private fun assertWritable(ticket: Long) {
        val allowed = synchronized(stateLock) { enabled && generation == ticket }
        check(allowed && mayWrite()) { "sync-recovery-paused" }
    }

    private fun inventory(kind: String): List<JSONObject> =
        io.listFiles(kind).filter { file ->
            val props = file.optJSONObject("appProperties")
            !file.optBoolean("trashed") && props?.opt("app") == contract.APP
                && props.opt("kind") == kind
        }

    private fun matchingAsset(
        file: JSONObject, expected: SyncRecoveryContract.Asset, day: String
    ): Boolean {
        val props = file.optJSONObject("appProperties") ?: return false
        val id = file.opt("id") as? String ?: return false
        val size = runCatching {
            file.get("size").toString().toBigDecimal().longValueExact()
        }.getOrNull()
        return !file.optBoolean("trashed") && contract.validId(id)
            && props.opt("app") == contract.APP && props.opt("kind") == "asset"
            && props.opt("day") == day && props.opt("sha256") == expected.sha256
            && size == expected.size
    }

    fun getStatus(): JSONObject =
        contract.select(inventory("manifest"), clock()).publicJson()

    private fun verifiedRead(snapshot: SyncRecoveryContract.Snapshot): VerifiedSnapshot {
        val raw = io.readText(snapshot.id)
        val payload = contract.verify(raw, snapshot)
        val files = if (payload.assets.isEmpty()) emptyList() else inventory("asset")
        val assets = payload.assets.map { required ->
            val file = files.filter { matchingAsset(it, required, payload.day) }
                .minByOrNull { it.getString("id") }
                ?: throw IllegalStateException("sync-recovery-asset-missing")
            DownloadAsset(required.sha256, required.size, file.getString("id"))
        }
        return VerifiedSnapshot(raw, snapshot, assets)
    }

    /** Reads only retained, owned points; full asset bytes are verified by the adapter. */
    fun readSnapshot(id: String): VerifiedSnapshot {
        require(contract.validId(id)) { "sync-recovery-invalid-id" }
        val snapshot = contract.select(inventory("manifest"), clock())
            .retained.firstOrNull { it.id == id }
            ?: throw IllegalStateException("sync-recovery-point-unavailable")
        return verifiedRead(snapshot)
    }

    private fun result(
        skipped: Boolean,
        uploaded: Int,
        snapshot: SyncRecoveryContract.Snapshot,
        status: JSONObject
    ) = JSONObject()
        .put("skipped", skipped)
        .put("uploadedAssets", uploaded)
        .put("snapshot", snapshot.publicJson())
        .put("status", status)

    /**
     * Capture the generation before waiting for the write lock. A queued request
     * from before pause/resume must not gain authority from a newer session.
     */
    fun createDaily(request: JSONObject): JSONObject {
        val ticket = synchronized(stateLock) { generation }
        return synchronized(writeLock) { publish(request, ticket) }
    }

    private fun publish(request: JSONObject, ticket: Long): JSONObject {
        assertWritable(ticket)
        val raw = request.opt("data") as? String
            ?: throw IllegalArgumentException("sync-recovery-payload-invalid")
        val payload = contract.parse(raw)
        val startedAt = clock()
        require(payload.snapshotAt <= startedAt && payload.day == contract.day(startedAt)) {
            "sync-recovery-capture-date-changed"
        }
        val supplied = if (request.has("assets")) {
            request.optJSONArray("assets")
                ?: throw IllegalArgumentException("sync-recovery-asset-source-invalid")
        } else JSONArray()
        val sources = contract.sources(payload.assets, supplied)
        val initial = contract.select(inventory("manifest"), startedAt)
        initial.today?.let {
            verifiedRead(it)
            return result(true, 0, it, initial.publicJson())
        }

        var uploaded = 0
        val existingAssets = if (sources.isEmpty()) mutableListOf()
            else inventory("asset").toMutableList()
        for (source in sources) {
            assertWritable(ticket)
            val required = SyncRecoveryContract.Asset(source.sha256, source.size)
            if (existingAssets.any { matchingAsset(it, required, payload.day) }) continue
            val properties = JSONObject().put("app", contract.APP).put("kind", "asset")
                .put("day", payload.day).put("sha256", source.sha256)
            val file = io.uploadAsset(source, properties)
            check(matchingAsset(file, required, payload.day)) {
                "sync-recovery-asset-upload-invalid"
            }
            existingAssets.add(file)
            uploaded++
        }

        // Another device may have published while attachments were uploading.
        assertWritable(ticket)
        val beforePublish = contract.select(inventory("manifest"), clock())
        beforePublish.retained.firstOrNull { it.day == payload.day }?.let {
            verifiedRead(it)
            return result(true, uploaded, it, beforePublish.publicJson())
        }
        require(payload.day == contract.day(clock())) {
            "sync-recovery-capture-date-changed"
        }
        assertWritable(ticket)
        val properties = JSONObject()
            .put("app", contract.APP).put("kind", "manifest")
            .put("schemaVersion", contract.SCHEMA).put("day", payload.day)
            .put("snapshotAt", Instant.ofEpochMilli(payload.snapshotAt).toString())
            .put("contentHash", payload.contentHash)
        val file = io.createManifest(raw, properties)
        val snapshot = contract.normalize(file)
            ?: throw IllegalStateException("sync-recovery-manifest-upload-invalid")
        check(snapshot.contentHash == payload.contentHash
            && snapshot.snapshotAt == payload.snapshotAt && snapshot.day == payload.day) {
            "sync-recovery-manifest-upload-invalid"
        }
        verifiedRead(snapshot)

        var warning = ""
        try {
            cleanupAfterPublish(ticket)
        } catch (_: Exception) {
            // A cleanup failure must not invalidate an already verified snapshot.
            warning = "sync-recovery-cleanup-deferred"
        }
        return result(false, uploaded, snapshot, getStatus()).put("cleanupWarning", warning)
    }

    private fun cleanupAfterPublish(ticket: Long) {
        val files = inventory("manifest")
        val selected = contract.select(files, clock())
        if (selected.today == null) return
        // Never delete history before verifying every retained manifest and asset reference.
        for (snapshot in selected.retained) verifiedRead(snapshot)
        val candidates = contract.pruneCandidates(files, clock(), io.protectedIds())
        for (candidate in candidates) {
            assertWritable(ticket)
            if (candidate.id in io.protectedIds()) continue
            io.deleteManifest(candidate.id)
        }
        // Do not garbage-collect asset blobs here. Active downloads and concurrent
        // publishers require separate pin-aware, age-bounded asset cleanup.
    }
}
