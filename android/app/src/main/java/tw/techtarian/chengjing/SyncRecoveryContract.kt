package tw.techtarian.chengjing

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset

/** Shared wire contract. No account, network, database or filesystem access. */
internal object SyncRecoveryContract {
    const val APP = "chengjing-sync-recovery-v1"
    const val SCHEMA = "1"
    const val DAY_MS = 86_400_000L
    const val MAX_BYTES = 64 * 1024 * 1024
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    private const val MAX_DATE = 8_640_000_000_000_000L
    private const val CLOCK_SKEW = 300_000L
    private val idPattern = Regex("[A-Za-z0-9_-]{1,200}")
    private val hashPattern = Regex("[a-f0-9]{64}")
    val TABLES = listOf(
        "cards", "boards", "boardNodes", "boardEdges", "kanbanBoards", "kanbanLists",
        "kanbanPlacements", "tags", "tasks", "highlights", "attachments", "fragments",
        "knowledgeGroups", "chatThreads", "chatMessages", "cardVersions", "brainEdges",
        "brainReports", "brainShares"
    )

    data class Snapshot(
        val id: String, val day: String, val snapshotAt: Long, val createdAt: Long,
        val size: Long, val contentHash: String
    ) {
        fun publicJson() = JSONObject().put("id", id).put("day", day)
            .put("snapshotAt", snapshotAt).put("size", size).put("contentHash", contentHash)
    }
    data class Inventory(
        val today: Snapshot?, val yesterday: Snapshot?, val dayBeforeYesterday: Snapshot?,
        val retained: List<Snapshot>, val expired: List<Snapshot>
    ) {
        fun publicJson() = JSONObject().put("dayBasis", "UTC")
            .put("today", today?.publicJson() ?: JSONObject.NULL)
            .put("yesterday", yesterday?.publicJson() ?: JSONObject.NULL)
            .put("dayBeforeYesterday", dayBeforeYesterday?.publicJson() ?: JSONObject.NULL)
    }
    data class Asset(val sha256: String, val size: Long)
    data class Source(val relativePath: String, val sha256: String, val size: Long)
    data class Payload(
        val raw: String, val root: JSONObject, val day: String, val snapshotAt: Long,
        val contentHash: String, val assets: List<Asset>
    )

    fun keys(value: JSONObject): Set<String> = value.keys().asSequence().toSet()
    fun rows(value: JSONArray): List<Any?> = (0 until value.length()).map { value.opt(it) }
    fun validId(value: String) = idPattern.matches(value)
    fun validHash(value: String) = hashPattern.matches(value)
    fun day(timestamp: Long): String {
        require(timestamp in -MAX_DATE..MAX_DATE) { "sync-recovery-invalid-time" }
        return Instant.ofEpochMilli(timestamp).atOffset(ZoneOffset.UTC).toLocalDate().toString()
    }
    fun hash(raw: String): String = MessageDigest.getInstance("SHA-256")
        .digest(raw.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    // JSON numbers only: strings, fractions and unsafe integers are invalid.
    private fun safeNumber(value: Any?): Long? {
        if (value !is Number) return null
        val decimal = runCatching { value.toString().toBigDecimal() }.getOrNull() ?: return null
        val result = runCatching { decimal.longValueExact() }.getOrNull() ?: return null
        return result.takeIf { it in 0..MAX_SAFE_INTEGER }
    }
    private fun time(value: Any?): Long? {
        val text = value as? String ?: return null
        return runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
            ?.takeIf { it in 0..MAX_DATE }
    }

    fun normalize(file: JSONObject): Snapshot? {
        val props = file.optJSONObject("appProperties") ?: return null
        if (file.optBoolean("trashed") || props.opt("app") != APP
            || props.opt("kind") != "manifest" || props.opt("schemaVersion") != SCHEMA) return null
        val id = file.opt("id") as? String ?: return null
        val hash = props.opt("contentHash") as? String ?: return null
        val date = props.opt("day") as? String ?: return null
        if (!validId(id) || !validHash(hash)) return null
        val captured = time(props.opt("snapshotAt")) ?: return null
        val created = time(file.opt("createdTime")) ?: return null
        val sizeValue = file.opt("size")
        val size = if (sizeValue is String) sizeValue.toLongOrNull() else safeNumber(sizeValue)
        if (size == null || size !in 1..MAX_SAFE_INTEGER
            || !Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(date)
            || date != day(captured) || captured > created + CLOCK_SKEW) return null
        return Snapshot(id, date, captured, created, size, hash)
    }

    fun select(files: List<JSONObject>, now: Long): Inventory {
        require(now in 0..MAX_DATE) { "sync-recovery-invalid-time" }
        val days = (0..2).map { day(now - it * DAY_MS) }
        val snapshots = files.mapNotNull(::normalize).associateBy { it.id }.values
            .filter { it.snapshotAt <= now && it.createdAt <= now + CLOCK_SKEW }
            .sortedWith(compareBy<Snapshot> { it.createdAt }.thenBy { it.id })
        return Inventory(
            snapshots.firstOrNull { it.day == days[0] },
            snapshots.firstOrNull { it.day == days[1] },
            snapshots.firstOrNull { it.day == days[2] },
            snapshots.filter { it.day in days },
            snapshots.filter { it.day < days[2] }
        )
    }

    fun pruneCandidates(
        files: List<JSONObject>, now: Long, protectedIds: Set<String> = emptySet()
    ): List<Snapshot> {
        val inventory = select(files, now)
        if (inventory.today == null) return emptyList()
        return inventory.expired.filter {
            it.id !in protectedIds && now - it.createdAt >= DAY_MS
        }
    }

    fun parse(raw: String): Payload {
        require(raw.isNotEmpty() && raw.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) {
            "sync-recovery-payload-size"
        }
        val root = try {
            val tokener = JSONTokener(raw)
            val value = tokener.nextValue()
            require(value is JSONObject && tokener.nextClean() == '\u0000')
            value
        } catch (_: Exception) {
            throw IllegalArgumentException("sync-recovery-payload-invalid")
        }
        require(root.opt("format") == "chengjing-sync-recovery"
            && safeNumber(root.opt("version")) == 1L
            && root.opt("dayBasis") == "UTC") { "sync-recovery-payload-invalid" }
        require(keys(root) == setOf("format", "version", "dayBasis", "snapshotAt", "data")) {
            "sync-recovery-private-fields"
        }
        val captured = safeNumber(root.opt("snapshotAt"))
            ?: throw IllegalArgumentException("sync-recovery-invalid-time")
        require(captured <= MAX_DATE) { "sync-recovery-invalid-time" }
        val data = root.optJSONObject("data")
            ?: throw IllegalArgumentException("sync-recovery-payload-invalid")
        require(keys(data) == TABLES.toSet()) { "sync-recovery-tables-incomplete" }

        val assets = linkedMapOf<String, Asset>()
        for (name in TABLES) {
            val records = data.optJSONArray(name)
                ?: throw IllegalArgumentException("sync-recovery-table-invalid")
            val ids = mutableSetOf<String>()
            for (entry in rows(records)) {
                val row = entry as? JSONObject
                    ?: throw IllegalArgumentException("sync-recovery-record-invalid")
                val id = row.opt("id") as? String
                require(id != null && id.isNotBlank() && id.length <= 1024 && ids.add(id)) {
                    "sync-recovery-record-invalid"
                }
                if (name != "attachments") continue
                require(!row.has("blob") && !row.has("relativePath")) {
                    "sync-recovery-local-attachment-path"
                }
                val digest = row.opt("sha256") as? String
                val size = safeNumber(row.opt("size"))
                require(digest != null && validHash(digest) && size != null) {
                    "sync-recovery-asset-invalid"
                }
                require(assets[digest] == null || assets[digest]?.size == size) {
                    "sync-recovery-asset-size-conflict"
                }
                assets[digest] = Asset(digest, size)
            }
        }
        return Payload(raw, root, day(captured), captured, hash(raw), assets.values.toList())
    }

    fun sources(required: List<Asset>, supplied: JSONArray): List<Source> {
        val byHash = linkedMapOf<String, Source>()
        for (entry in rows(supplied)) {
            val row = entry as? JSONObject
                ?: throw IllegalArgumentException("sync-recovery-asset-source-invalid")
            val digest = row.opt("sha256") as? String
            val relative = row.opt("relativePath") as? String
            val size = safeNumber(row.opt("size"))
            require(digest != null && validHash(digest)
                && relative != null && relative.isNotEmpty() && size != null) {
                "sync-recovery-asset-source-invalid"
            }
            require(byHash[digest] == null || byHash[digest]?.size == size) {
                "sync-recovery-asset-size-conflict"
            }
            byHash[digest] = Source(relative, digest, size)
        }
        // Unreferenced sources must never be uploaded.
        return required.map { asset ->
            val source = byHash[asset.sha256]
            require(source != null && source.size == asset.size) { "sync-recovery-asset-missing" }
            source
        }
    }

    fun verify(raw: String, expected: Snapshot): Payload {
        val payload = parse(raw)
        require(payload.contentHash == expected.contentHash && payload.day == expected.day
            && payload.snapshotAt == expected.snapshotAt
            && raw.toByteArray(Charsets.UTF_8).size.toLong() == expected.size) {
            "sync-recovery-manifest-corrupt"
        }
        return payload
    }
}
