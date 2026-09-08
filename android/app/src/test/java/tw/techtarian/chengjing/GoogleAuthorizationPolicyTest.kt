package tw.techtarian.chengjing

import org.junit.Assert.*
import org.junit.Test

class GoogleAuthorizationPolicyTest {
    @Test fun absentTokensNeverMeanSuccess() {
        for (token in listOf(null, "", "  ", "\n\t")) {
            assertFalse(GoogleAuthorizationPolicy.connected(token, "AUTHORIZED"))
            try {
                GoogleAuthorizationPolicy.requireToken(token)
                fail("An absent token must fail authorization")
            } catch (error: IllegalStateException) {
                assertEquals(GoogleAuthorizationPolicy.AUTH_ERROR, error.message)
            }
        }
    }

    @Test fun knownReauthorizationOverridesStaleLocalToken() {
        assertFalse(GoogleAuthorizationPolicy.connected("old-token", "AUTH_REQUIRED"))
        assertTrue(GoogleAuthorizationPolicy.connected("new-token", "AUTHORIZED"))
        assertTrue(GoogleAuthorizationPolicy.connected("legacy-token", null))
        assertEquals("new-token", GoogleAuthorizationPolicy.requireToken("new-token"))
    }

    @Test fun networkErrorsAreNotMisclassifiedAsRevokedAuthorization() {
        assertTrue(GoogleAuthorizationPolicy.requiresInteraction(4))
        assertTrue(GoogleAuthorizationPolicy.requiresInteraction(6))
        assertFalse(GoogleAuthorizationPolicy.requiresInteraction(7))
        assertFalse(GoogleAuthorizationPolicy.requiresInteraction(8))
        assertFalse(GoogleAuthorizationPolicy.requiresInteraction(15))
    }
}
