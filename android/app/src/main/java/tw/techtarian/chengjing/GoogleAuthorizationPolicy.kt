package tw.techtarian.chengjing

/** Local authorization state is not proof that a remote sync has succeeded. */
internal object GoogleAuthorizationPolicy {
    const val AUTH_REQUIRED = "AUTH_REQUIRED"
    const val AUTH_ERROR = "Google authorization required; reconnect your account"

    fun requireToken(token: String?): String = token?.takeIf { it.isNotBlank() }
        ?: throw IllegalStateException(AUTH_ERROR)

    fun connected(token: String?, state: String?): Boolean =
        !token.isNullOrBlank() && state != AUTH_REQUIRED

    // Google CommonStatusCodes: SIGN_IN_REQUIRED and RESOLUTION_REQUIRED.
    fun requiresInteraction(statusCode: Int) = statusCode == 4 || statusCode == 6
}
