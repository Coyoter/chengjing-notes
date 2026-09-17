package tw.techtarian.chengjing

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SyncRecoveryNativeBridgeTest {
    private class Fixture {
        val calls = mutableListOf<String>()
        var initialized = 0
        var received: JSONObject? = null
        var failure: String? = null
        val actions = object : SyncRecoveryNativeBridge.Actions {
            private fun result(name: String): JSONObject {
                failure?.let { throw IllegalStateException(it) }
                calls.add(name)
                return JSONObject().put("method", name)
            }
            override fun setEnabled(value: Boolean): JSONObject {
                calls.add("enabled:$value")
                return JSONObject().put("enabled", value)
            }
            override fun getStatus() = result("status")
            override fun createDaily(request: JSONObject): JSONObject {
                received = request
                return result("create")
            }
            override fun download(id: String) = result("download:$id")
            override fun releaseDownload(restoreId: String) = result("release:$restoreId")
            override fun restoreAttachment(args: JSONObject) = result("attachment:${args.getString("id")}")
        }
        val bridge = SyncRecoveryNativeBridge { initialized++; actions }
        fun enable(value: Boolean = true) =
            bridge.call("syncRecovery.setEnabled", JSONObject().put("enabled", value))
    }
    private fun rejected(code: String, action: () -> Unit) {
        val error = runCatching(action).exceptionOrNull()
        assertNotNull(error)
        assertTrue("Expected $code, got $error", error?.message?.contains(code) == true)
    }

    @Test fun delegatesOnlyKnownRecoveryOperations() {
        val h = Fixture()
        h.enable()
        h.bridge.call("syncRecovery.getStatus", JSONObject())
        h.bridge.call("syncRecovery.createDaily", JSONObject().put("data", "test"))
        h.bridge.call("syncRecovery.download", JSONObject().put("id", "selected"))
        h.bridge.call("syncRecovery.releaseDownload", JSONObject().put("restoreId", "session"))
        h.bridge.call("syncRecovery.restoreAttachment", JSONObject().put("id", "image"))
        assertEquals(listOf("enabled:true", "status", "create", "download:selected",
            "release:session", "attachment:image"), h.calls)
    }

    @Test fun enableRequiresALiteralBoolean() {
        val h = Fixture()
        for (value in listOf<Any>("true", 1, JSONObject.NULL, JSONObject())) {
            rejected("enabled-invalid") {
                h.bridge.call("syncRecovery.setEnabled", JSONObject().put("enabled", value))
            }
        }
        assertEquals(0, h.initialized)
    }

    @Test fun unknownMethodsCannotAccessTheService() {
        val h = Fixture()
        for (method in listOf("syncRecovery.deleteAll", "cloud.write", "syncRecovery.")) {
            rejected("method-invalid") { h.bridge.prepare(method, JSONObject()) }
        }
        assertEquals(0, h.initialized)
    }

    @Test fun queuedWriteCannotGainAuthorityFromALaterResume() {
        val h = Fixture()
        h.enable()
        val queued = h.bridge.prepare("syncRecovery.createDaily", JSONObject().put("data", "old"))
        h.enable(false)
        h.enable(true)
        rejected("paused") { queued() }
        assertFalse(h.calls.contains("create"))
    }

    @Test fun repeatedEnableDoesNotCancelValidQueuedWork() {
        val h = Fixture()
        h.enable()
        val queued = h.bridge.prepare("syncRecovery.createDaily", JSONObject().put("data", "test"))
        h.enable()
        queued()
        assertEquals(1, h.calls.count { it == "create" })
    }

    @Test fun lifecycleInvalidationDoesNotInitializeAnUnusedService() {
        val h = Fixture()
        h.bridge.invalidate()
        h.bridge.invalidate()
        assertEquals(0, h.initialized)
        rejected("paused") {
            h.bridge.prepare("syncRecovery.download", JSONObject().put("id", "point"))
        }
    }

    @Test fun requestsAreFrozenBeforeExecutorQueuing() {
        val h = Fixture()
        h.enable()
        val args = JSONObject().put("data", "original")
        val queued = h.bridge.prepare("syncRecovery.createDaily", args)
        args.put("data", "changed")
        queued()
        assertEquals("original", h.received!!.getString("data"))
    }

    @Test fun cleanupRemainsPossibleAfterPauseOrLifecycleInvalidation() {
        val h = Fixture()
        h.enable()
        val cleanup = h.bridge.prepare("syncRecovery.releaseDownload",
            JSONObject().put("restoreId", "owned-session"))
        h.bridge.invalidate()
        cleanup()
        assertTrue(h.calls.contains("release:owned-session"))
    }

    @Test fun metadataReadsDoNotEnableSyncOrPermitRestoration() {
        val h = Fixture()
        h.bridge.call("syncRecovery.getStatus", JSONObject())
        assertEquals(listOf("status"), h.calls)
        rejected("paused") {
            h.bridge.call("syncRecovery.download", JSONObject().put("id", "point"))
        }
    }

    @Test fun errorsDoNotExposeCredentialsOrPrivatePaths() {
        val h = Fixture()
        h.failure = "Bearer private-token /Users/private/file"
        val error = runCatching {
            h.bridge.call("syncRecovery.getStatus", JSONObject())
        }.exceptionOrNull()
        assertEquals("sync-recovery-operation-failed", error?.message)
        assertFalse(error.toString().contains("private-token"))
        h.failure = "sync-recovery-manifest-corrupt"
        rejected("manifest-corrupt") {
            h.bridge.call("syncRecovery.getStatus", JSONObject())
        }
    }
}
