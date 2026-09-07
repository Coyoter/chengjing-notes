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
        versionCode = 5
        versionName = "0.10.1"
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
dependencies {
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
