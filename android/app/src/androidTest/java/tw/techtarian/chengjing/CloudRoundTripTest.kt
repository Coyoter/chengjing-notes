package tw.techtarian.chengjing
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.json.JSONObject
import org.json.JSONArray
import java.util.UUID
import android.util.Base64

@RunWith(AndroidJUnit4::class)
class CloudRoundTripTest {
    @Test fun snapshotAssetAndPreviousDayRoundTrip() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val fixture="chengjing-backup-qa-${UUID.randomUUID()}"
        var now=System.currentTimeMillis()-86400000L
        val service=NativeServices(context,fixture,fixture,{now})
        var asset:JSONObject?=null
        try {
            service.call("cloud.init",JSONObject())
            asset=service.call("attachments.importData",JSONObject().put("id","qa-asset").put("name","qa.txt").put("mime","text/plain").put("data",Base64.encodeToString("backup attachment round trip".toByteArray(),Base64.NO_WRAP))) as JSONObject
            fun payload(text:String, withAsset:Boolean=true):JSONObject {
                val data=JSONObject().put("cards",JSONArray().put(JSONObject().put("id","qa-card").put("plainText",text))).put("attachments",if(withAsset)JSONArray().put(asset)else JSONArray())
                val raw=JSONObject().put("format","chengjing-backup").put("version",2).put("attachmentMode","content-addressed").put("data",data).toString()
                return JSONObject().put("data",raw).put("assets",if(withAsset)JSONArray().put(asset)else JSONArray())
            }
            val first=service.call("cloud.write",payload("yesterday")) as JSONObject
            now+=86400000L
            val second=service.call("cloud.write",payload("today")) as JSONObject
            assertEquals(first.getJSONObject("current").getString("id"),second.getJSONObject("previous").getString("id"))
            val downloaded=service.call("cloud.download",JSONObject().put("slot","current")) as JSONObject
            assertTrue(downloaded.getString("data").contains("today"))
            val restored=service.call("attachments.restoreFromBackup",JSONObject(asset.toString()).put("backupFilePath",downloaded.getString("backupFilePath"))) as JSONObject
            assertEquals(asset.getString("sha256"),restored.getString("sha256"))
            service.safeFile(restored.getString("relativePath")).delete()
            val previous=service.call("cloud.download",JSONObject().put("slot","previous")) as JSONObject
            assertTrue(previous.getString("data").contains("yesterday"))
            val unchanged=service.call("cloud.write",payload("today")) as JSONObject
            assertTrue(unchanged.getBoolean("skipped"))
            now+=3*86400000L
            val expired=service.call("cloud.status",JSONObject()) as JSONObject
            assertTrue(expired.isNull("previous"));assertFalse(expired.isNull("current"))
            service.call("cloud.write",payload("no longer contains the old attachment",false))
            assertEquals(0,service.driveList("asset",fixture).getJSONArray("files").length())
        } finally {
            service.cleanupFixture()
            asset?.let{service.safeFile(it.getString("relativePath")).delete()}
        }
    }
    @Test fun localRetentionPreservesOnlyReferencedAssetsAndUnrelatedFiles() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=java.nio.file.Files.createTempDirectory(context.cacheDir.toPath(),"backup-retention-").toFile()
        try {
            val assets=java.io.File(folder,"assets").apply{mkdirs()}
            for(index in 1..12){val hash=index.toString().padStart(64,'0');java.io.File(assets,hash).writeText("asset-$index");java.io.File(folder,"ChengJing-$index.json").writeText(JSONObject().put("format","chengjing-backup").put("version",2).put("data",JSONObject().put("attachments",JSONArray().put(JSONObject().put("sha256",hash)))).toString())}
            val unrelated=java.io.File(folder,"personal.txt").apply{writeText("not owned")}
            BackupRetention.prunePrivate(folder)
            assertEquals(10,folder.listFiles()!!.count{it.extension=="json"})
            assertEquals(10,assets.listFiles()!!.size);assertTrue(unrelated.exists())
            java.io.File(folder,"ChengJing-13.json").writeText("corrupt")
            assertTrue(runCatching{BackupRetention.prunePrivate(folder)}.isFailure)
            assertEquals(11,folder.listFiles()!!.count{it.extension=="json"})
        } finally { folder.deleteRecursively() }
    }
}
