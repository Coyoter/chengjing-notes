import java.security.KeyStore
import java.security.MessageDigest

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
val signingFile = rootProject.file("signing/credentials.json")
val signingValues = if (signingFile.exists()) groovy.json.JsonSlurper().parse(signingFile) as Map<*, *> else emptyMap<String,String>()
val distributionChannel = providers.gradleProperty("distributionChannel").orElse("direct").get()
require(distributionChannel in listOf("direct", "play")) { "Unknown distribution channel" }
android {
    namespace = "tw.techtarian.chengjing"
    compileSdk = 36
    defaultConfig {
        applicationId = "tw.techtarian.chengjing"
        minSdk = 28
        targetSdk = 36
        versionCode = 9
        versionName = "0.10.5"
        buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"$distributionChannel\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        create("production") {
            if(signingFile.exists()) {
                storeFile=rootProject.file("signing/chengjing-release.jks")
                storePassword=signingValues["password"] as String
                keyAlias=signingValues["alias"] as String
                keyPassword=storePassword
            }
        }
    }
    buildTypes { getByName("release") { signingConfig=signingConfigs.getByName("production");isMinifyEnabled=false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

val verifyGoogleOAuthSigning = tasks.register("verifyGoogleOAuthSigning") {
    group = "verification"
    description = "Check local release signing against the recorded Android OAuth registration; does not verify Google Cloud."
    doLast {
        val config = groovy.json.JsonSlurper().parse(rootProject.file("google-oauth.json")) as Map<*, *>
        check(config["package"] == android.defaultConfig.applicationId) { "OAuth package does not match applicationId" }
        check(config["scope"] == "https://www.googleapis.com/auth/drive.appdata") { "Unexpected Google Drive scope" }
        check((config["releaseClientId"] as? String)?.endsWith(".apps.googleusercontent.com") == true) { "Missing recorded release OAuth client" }
        check(signingFile.exists()) { "Release signing credentials are missing" }
        val signing = android.signingConfigs.getByName("production")
        val keystore = KeyStore.getInstance(signing.storeFile!!, signing.storePassword!!.toCharArray())
        val certificate = keystore.getCertificate(signing.keyAlias) ?: error("Release signing certificate is missing")
        val fingerprint = MessageDigest.getInstance("SHA-1").digest(certificate.encoded).joinToString(":") { "%02X".format(it) }
        check(fingerprint.equals(config["releaseCertificateSha1"] as? String, ignoreCase = true)) { "Release certificate differs from google-oauth.json. Verify the corresponding Google Cloud Android client before release." }
        logger.lifecycle("Local release signing matches the recorded OAuth fingerprint. Google Cloud registration and the Play App Signing certificate still require separate verification.")
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(verifyGoogleOAuthSigning) }

dependencies {
    // JVM tests only; these libraries are not packaged into the Android app.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260719")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.documentfile:documentfile:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.10.4")
    implementation("com.google.android.gms:play-services-auth:21.6.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.17.0")
}
