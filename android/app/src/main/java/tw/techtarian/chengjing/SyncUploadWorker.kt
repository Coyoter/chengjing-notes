package tw.techtarian.chengjing
import android.content.Context
import androidx.work.*
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class SyncUploadWorker(context:Context,params:WorkerParameters):Worker(context,params){
    override fun doWork():Result{
        if(!applicationContext.getSharedPreferences("settings",Context.MODE_PRIVATE).getBoolean("sync-enabled",false))return Result.success()
        val services=NativeServices(applicationContext)
        try{
            val auth=Tasks.await(Identity.getAuthorizationClient(applicationContext).authorize(AuthorizationRequest.builder().setRequestedScopes(listOf(Scope("https://www.googleapis.com/auth/drive.appdata"))).build()),30,TimeUnit.SECONDS)
            if(auth.hasResolution())return Result.failure()
            if(isStopped||!applicationContext.getSharedPreferences("settings",Context.MODE_PRIVATE).getBoolean("sync-enabled",false))return Result.success()
            services.store.put("google-token",auth.accessToken?:return Result.failure())
            val folder=File(applicationContext.filesDir,"sync-upload")
            val known=services.driveList("packet").getJSONArray("files");val names=(0 until known.length()).map{known.getJSONObject(it).getString("name")}.toSet()
            for(file in folder.listFiles().orEmpty().filter{it.extension=="json"}){
                if(isStopped||!applicationContext.getSharedPreferences("settings",Context.MODE_PRIVATE).getBoolean("sync-enabled",false))return Result.retry()
                val packet=JSONObject(file.readText());val id=packet.getString("id")
                if(id !in names){
                    val operations=packet.getJSONArray("operations")
                    for(i in 0 until operations.length()){val op=operations.getJSONObject(i);if(op.optString("table")=="attachments"&&!op.isNull("value"))services.call("sync.uploadAsset",op.getJSONObject("value"))}
                    services.drivePut(id,packet.toString(),"packet")
                }
                file.delete()
            }
            return Result.success()
        }catch(_:Exception){return if(runAttemptCount<5)Result.retry()else Result.failure()}
    }
    companion object{
        fun enqueue(context:Context){
            val request=OneTimeWorkRequestBuilder<SyncUploadWorker>().setInitialDelay(10,TimeUnit.SECONDS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build()
            val manager=WorkManager.getInstance(context)
            manager.enqueueUniqueWork("chengjing-sync-upload",ExistingWorkPolicy.KEEP,request)
            manager.enqueueUniquePeriodicWork("chengjing-sync-recovery",ExistingPeriodicWorkPolicy.KEEP,PeriodicWorkRequestBuilder<SyncUploadWorker>(15,TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }
}
