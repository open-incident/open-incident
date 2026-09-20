plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

/**
 * The library an application adds.
 *
 * No dependencies, and that is a requirement rather than an accident: this
 * goes into somebody else's shipping app, and every transitive dependency it
 * brings is a version conflict in a project nobody here can see. JSON comes
 * from `org.json`, which is in the platform, and the request from
 * `HttpURLConnection`, which is too — so adding this SDK cannot drag in a
 * second copy of OkHttp.
 */
android {
    namespace = "dev.openincident.rum"
    compileSdk = 36

    defaultConfig {
        // API 21 is where `SharedPreferences`, `HttpURLConnection` and the
        // lifecycle callbacks all behave the way this code assumes.
        minSdk = 21
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    // JUnit and nothing else. The session is tested against a SharedPreferences
    // written in the test file — the interface is four methods — and standing
    // up Robolectric to obtain a hash map would trade a nine-second test run
    // for a forty-second one.
    testImplementation("junit:junit:4.13.2")
}
