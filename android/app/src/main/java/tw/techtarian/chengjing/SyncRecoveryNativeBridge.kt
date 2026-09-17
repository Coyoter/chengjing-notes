package tw.techtarian.chengjing

import org.json.JSONObject

/** Captures authority before executor queuing, without holding a lock during I/O. */
internal class SyncRecoveryNativeBridge(provider: () -> Actions) {
    interface Actions {
        fun setEnabled(value: Boolean): JSONObject
        fun getStatus(): JSONObject
        fun createDaily(request: JSONObject): JSONObject
        fun download(id: String): JSONObject
        fun releaseDownload(restoreId: String): JSONObject
        fun restoreAttachment(args: JSONObject): JSONObject
    }

    private val service = lazy(provider)
    private val control = Any()
    private var enabled = false
    private var generation = 0L

    private fun <T> safe(action: () -> T): T {
        try {
            return action()
        } catch (error: Exception) {
            val message = error.message ?: ""
            val code = if (Regex("sync-recovery-[a-z0-9-]+").matches(message))
                message else "sync-recovery-operation-failed"
            throw IllegalStateException(code)
        }
    }

    private fun setEnabled(value: Boolean): JSONObject = synchronized(control) {
        if (enabled != value) {
            enabled = value
            generation++
        }
        if (value || service.isInitialized()) service.value.setEnabled(value)
        else JSONObject().put("enabled", false)
    }

    /** Lifecycle invalidation never creates a service or waits for an upload. */
    fun invalidate() {
        synchronized(control) {
            generation++
            enabled = false
            if (service.isInitialized()) service.value.setEnabled(false)
        }
    }

    fun call(method: String, args: JSONObject): JSONObject = safe {
        if (method == "syncRecovery.setEnabled") {
            val value = args.opt("enabled")
            require(value is Boolean) { "sync-recovery-enabled-invalid" }
            setEnabled(value)
        } else prepare(method, args).invoke()
    }

    fun prepare(method: String, args: JSONObject): () -> JSONObject = safe {
        require(method in setOf(
            "syncRecovery.getStatus", "syncRecovery.createDaily",
            "syncRecovery.download", "syncRecovery.releaseDownload",
            "syncRecovery.restoreAttachment"
        )) { "sync-recovery-method-invalid" }
        val needsEnabled = method in setOf(
            "syncRecovery.createDaily", "syncRecovery.download", "syncRecovery.restoreAttachment"
        )
        val ticket = synchronized(control) {
            check(!needsEnabled || enabled) { "sync-recovery-paused" }
            generation
        }
        // Preserve the request as received, not a mutable object shared with the caller.
        val request = JSONObject(args.toString())
        val operation: () -> JSONObject = {
            safe {
                if (method != "syncRecovery.releaseDownload") {
                    synchronized(control) {
                        check(ticket == generation && (!needsEnabled || enabled)) {
                            "sync-recovery-paused"
                        }
                    }
                }
                when (method) {
                    "syncRecovery.getStatus" -> service.value.getStatus()
                    "syncRecovery.createDaily" -> service.value.createDaily(request)
                    "syncRecovery.download" -> service.value.download(request.getString("id"))
                    "syncRecovery.releaseDownload" -> service.value.releaseDownload(request.getString("restoreId"))
                    "syncRecovery.restoreAttachment" -> service.value.restoreAttachment(request)
                    else -> throw IllegalArgumentException("sync-recovery-method-invalid")
                }
            }
        }
        operation
    }
}
