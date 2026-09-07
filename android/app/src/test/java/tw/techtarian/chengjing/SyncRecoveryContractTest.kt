package tw.techtarian.chengjing

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.util.TimeZone

class SyncRecoveryContractTest {
    private val contract = SyncRecoveryContract
    private fun fixture(): JSONObject {
        val stream = requireNotNull(javaClass.getResourceAsStream("/sync-recovery-contract.json"))
        return stream.bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
    }
    private fun strings(array: JSONArray) =
        (0 until array.length()).map { array.getString(it) }
    private fun files(array: JSONArray) =
        (0 until array.length()).map { array.getJSONObject(it) }

    private fun equalJson(expected: Any?, actual: Any?) {
        when {
            expected is JSONObject -> {
                assertTrue(actual is JSONObject)
                actual as JSONObject
                assertEquals(contract.keys(expected), contract.keys(actual))
                for (key in contract.keys(expected)) equalJson(expected.get(key), actual.get(key))
            }
            expected is JSONArray -> {
                assertTrue(actual is JSONArray)
                actual as JSONArray
                assertEquals(expected.length(), actual.length())
                for (index in 0 until expected.length()) equalJson(expected.get(index), actual.get(index))
            }
            expected is Number && actual is Number ->
                assertEquals(0, expected.toString().toBigDecimal().compareTo(actual.toString().toBigDecimal()))
            else -> assertEquals(expected, actual)
        }
    }
    private fun rejected(action: () -> Unit) {
        val error = runCatching(action).exceptionOrNull()
        assertNotNull("The invalid request must be rejected", error)
        assertTrue("Expected a safe recovery error, got $error",
            error?.message?.startsWith("sync-recovery-") == true)
    }
    private fun validRaw() = fixture().getJSONArray("payloads").getJSONObject(0).getString("raw")

    @Test fun tableNamesExactlyMatchElectron() {
        assertEquals(strings(fixture().getJSONArray("tables")), contract.TABLES)
    }

    @Test fun allDesktopPolicyFixturesProduceIdenticalResults() {
        val cases = fixture().getJSONArray("cases")
        assertTrue(cases.length() >= 10)
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val input = files(item.getJSONArray("files"))
            val expected = item.getJSONObject("expected")
            val result = contract.select(input, item.getLong("now"))
            equalJson(expected.getJSONObject("status"), result.publicJson())
            assertEquals(item.getString("name"), strings(expected.getJSONArray("retainedIds")),
                result.retained.map { it.id })
            assertEquals(strings(expected.getJSONArray("expiredIds")), result.expired.map { it.id })
            assertEquals(strings(expected.getJSONArray("pruneIds")),
                contract.pruneCandidates(input, item.getLong("now"),
                    strings(item.getJSONArray("protectedIds")).toSet()).map { it.id })
        }
    }

    @Test fun hashesOriginalUtf8BytesWithoutJsonReserialization() {
        val payloads = fixture().getJSONArray("payloads")
        for (index in 0 until payloads.length()) {
            val item = payloads.getJSONObject(index)
            val raw = item.getString("raw")
            val result = contract.parse(raw)
            assertEquals(raw, result.raw)
            assertEquals(item.getString("contentHash"), result.contentHash)
            assertEquals(item.getString("day"), result.day)
            assertEquals(item.getLong("size"), raw.toByteArray(Charsets.UTF_8).size.toLong())
            val assets = JSONArray()
            result.assets.forEach { assets.put(JSONObject().put("sha256", it.sha256).put("size", it.size)) }
            equalJson(item.getJSONArray("assets"), assets)
        }
    }

    @Test fun utcDateDoesNotChangeWithDeviceTimeZone() {
        val original = TimeZone.getDefault()
        try {
            for (zone in listOf("Asia/Taipei", "America/Los_Angeles", "Pacific/Kiritimati")) {
                TimeZone.setDefault(TimeZone.getTimeZone(zone))
                assertEquals("2028-02-29",
                    contract.day(Instant.parse("2028-03-01T00:00:01Z").toEpochMilli() - contract.DAY_MS))
            }
        } finally { TimeZone.setDefault(original) }
    }

    @Test fun rejectsMissingTablesAndPrivateRootFields() {
        val mutations: List<(JSONObject) -> Unit> = listOf(
            { it.getJSONObject("data").remove("tasks") },
            { it.getJSONObject("data").put("preferences", JSONArray()) },
            { it.put("communityIdentity", JSONObject().put("secret", "test-only")) },
            { it.put("syncRecords", JSONArray()) },
            { it.getJSONObject("data").put("cards", JSONObject()) }
        )
        for (mutate in mutations) {
            val value = JSONObject(validRaw())
            mutate(value)
            rejected { contract.parse(value.toString()) }
        }
    }

    @Test fun rejectsMalformedJsonAndUnsafeNumericTypes() {
        for (raw in listOf("", "{", "[]", validRaw() + " trailing-data")) {
            rejected { contract.parse(raw) }
        }
        for (timestamp in listOf<Any>("1", -1, 1.5, 9_007_199_254_740_992L)) {
            rejected { contract.parse(JSONObject(validRaw()).put("snapshotAt", timestamp).toString()) }
        }
    }

    @Test fun rejectsDuplicateAndNonStringRecordIds() {
        for (records in listOf(
            JSONArray().put(JSONObject().put("id", "same")).put(JSONObject().put("id", "same")),
            JSONArray().put(JSONObject().put("id", 123)),
            JSONArray().put(JSONObject().put("id", " "))
        )) {
            val value = JSONObject(validRaw())
            value.getJSONObject("data").put("fragments", records)
            rejected { contract.parse(value.toString()) }
        }
    }

    @Test fun rejectsLocalAttachmentPathsBlobsAndInconsistentSizes() {
        fun asset() = JSONObject().put("id", "asset").put("sha256", "b".repeat(64)).put("size", 12)
        val bad = listOf(
            JSONArray().put(asset().put("relativePath", "/private/local")),
            JSONArray().put(asset().put("blob", "local-only")),
            JSONArray().put(asset().put("sha256", "invalid")),
            JSONArray().put(asset().put("size", "12")),
            JSONArray().put(asset()).put(asset().put("id", "other").put("size", 13))
        )
        for (attachments in bad) {
            val value = JSONObject(validRaw())
            value.getJSONObject("data").put("attachments", attachments)
            rejected { contract.parse(value.toString()) }
        }
    }

    @Test fun onlyReferencedAttachmentSourcesAreSelected() {
        val required = listOf(SyncRecoveryContract.Asset("b".repeat(64), 12))
        fun source(hash: String, size: Int) = JSONObject()
            .put("relativePath", "test-file").put("sha256", hash).put("size", size)
        val result = contract.sources(required,
            JSONArray().put(source("b".repeat(64), 12)).put(source("c".repeat(64), 20)))
        assertEquals(1, result.size)
        assertEquals("b".repeat(64), result.single().sha256)
        rejected { contract.sources(required, JSONArray()) }
        rejected { contract.sources(required, JSONArray().put(source("b".repeat(64), 13))) }
    }

    @Test fun alteredBytesOrMetadataCannotBeRestored() {
        val raw = validRaw()
        val payload = contract.parse(raw)
        val expected = SyncRecoveryContract.Snapshot(
            "snapshot", payload.day, payload.snapshotAt, payload.snapshotAt,
            raw.toByteArray(Charsets.UTF_8).size.toLong(), payload.contentHash)
        assertEquals(raw, contract.verify(raw, expected).raw)
        rejected { contract.verify(raw + " ", expected) }
        rejected { contract.verify(raw, expected.copy(contentHash = "f".repeat(64))) }
        rejected { contract.verify(raw, expected.copy(size = expected.size + 1)) }
        rejected { contract.verify(raw, expected.copy(day = "2000-01-01")) }
    }

    @Test fun policyEvaluationDoesNotMutateInputMetadata() {
        val item = fixture().getJSONArray("cases").getJSONObject(0)
        val input = files(item.getJSONArray("files"))
        val before = input.map { it.toString() }
        contract.select(input, item.getLong("now"))
        contract.pruneCandidates(input, item.getLong("now"))
        assertEquals(before, input.map { it.toString() })
    }
}
