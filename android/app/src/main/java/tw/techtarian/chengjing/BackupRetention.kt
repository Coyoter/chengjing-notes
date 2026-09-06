package tw.techtarian.chengjing

import java.io.File
import org.json.JSONObject

/** Only app-owned snapshot names are eligible. Unknown files always survive. */
internal object BackupRetention {
    private val ownedName = Regex("ChengJing-[0-9]+\\.json")
    fun referencedHashes(raw: String): Set<String> {
        val backup=JSONObject(raw)
        require(backup.optString("format")=="chengjing-backup" && backup.optInt("version")==2)
        val list=backup.getJSONObject("data").getJSONArray("attachments")
        return (0 until list.length()).mapNotNull { index ->
            list.getJSONObject(index).optString("sha256").takeIf { it.matches(Regex("[a-f0-9]{64}")) }
        }.toSet()
    }
    fun prunePrivate(folder: File, keep: Int=10) {
        val snapshots=folder.listFiles().orEmpty().filter { it.isFile && ownedName.matches(it.name) }
            .sortedByDescending { it.name.removePrefix("ChengJing-").removeSuffix(".json").toLong() }
        // Validate all before deleting anything; a damaged snapshot needs attention.
        val references=snapshots.associateWith { referencedHashes(it.readText()) }
        val removed=snapshots.drop(keep.coerceAtLeast(2)).filter { it.delete() }.toSet()
        val keptHashes=references.filterKeys { it !in removed }.values.flatten().toSet()
        File(folder,"assets").listFiles().orEmpty().filter { it.isFile && it.name.matches(Regex("[a-f0-9]{64}")) && it.name !in keptHashes }.forEach { it.delete() }
    }
}
