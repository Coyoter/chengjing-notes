package tw.techtarian.chengjing

import android.app.ActivityManager
import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class LocalInference(private val context: Context) {
    private val folder=File(context.filesDir,"models").apply{mkdirs()}
    private val model=File(folder,"gemma-4-E2B-it-gpu.litertlm")
    private val bytes=2008432640L
    private val hash="a53a59001894c58e6bdb5b9b227709f91a2e3e556baa7d85acf9c55402ba5cf5"
    private var engine: Engine?=null
    private fun supported(): Boolean { val info=ActivityManager.MemoryInfo();(context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info);return info.totalMem>=5_500_000_000L }
    fun status(): JSONObject = JSONObject().put("state",if(!supported())"unsupported" else if(model.isFile)"ready" else "not-downloaded").put("cached",model.isFile).put("progress",if(model.isFile)100 else 0).put("size",bytes).put("message",if(!supported())"本機 Gemma 建議至少 6 GB RAM；這台裝置仍可使用雲端或自訂 AI。" else if(model.isFile)"Gemma 4 已下載・Android 原生推論" else "尚未下載・Android 原生推論")
    @Synchronized fun download(): JSONObject {
        require(supported()){ "This device has insufficient RAM for local Gemma" }
        if(model.isFile)return status()
        require(folder.usableSpace > bytes + 512_000_000){"Insufficient storage for the model"}
        val part=File(folder,"gemma-download.part")
        val url="https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it-gpu.litertlm"
        val client=OkHttpClient.Builder().callTimeout(30,TimeUnit.MINUTES).build()
        try {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                require(response.isSuccessful){"Model download HTTP ${response.code}"}
                val digest=MessageDigest.getInstance("SHA-256");var received=0L;var last=0L
                response.body!!.byteStream().use { input -> part.outputStream().use { output ->
                    val buffer=ByteArray(65536)
                    while(true){val n=input.read(buffer);if(n<0)break;output.write(buffer,0,n);digest.update(buffer,0,n);received+=n
                        if(System.currentTimeMillis()-last>500){last=System.currentTimeMillis();(context as? MainActivity)?.emit("model-progress",JSONObject().put("progress",received*100.0/bytes))}
                    }
                } }
                require(received==bytes && digest.digest().joinToString(""){"%02x".format(it)}==hash){"Model download verification failed"}
            }
            check(part.renameTo(model));return status()
        }catch(error:Exception){part.delete();throw error}
    }
    @Synchronized fun generate(args: JSONObject): JSONObject {
        require(model.isFile){"Download the local model first"}
        if(engine==null){val loaded=Engine(EngineConfig(modelPath=model.path,backend=Backend.GPU()));loaded.initialize();engine=loaded}
        val messages=args.getJSONArray("messages");val prompt=(0 until messages.length()).joinToString("\n\n"){val m=messages.getJSONObject(it);"${m.getString("role")}: ${m.getString("content")}"}
        engine!!.createConversation().use { conversation ->
            val response=conversation.sendMessage(prompt, maxOutputToken=args.optInt("maxTokens",1024).coerceIn(32,8192))
            return JSONObject().put("text",response.toString()).put("model","gemma-4-E2B-it-litert-lm").put("finishReason","stop")
        }
    }
    @Synchronized fun remove(): JSONObject { engine?.close();engine=null;model.delete();return JSONObject().put("cleared",true) }
}
