plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * The smallest application that exercises every public call in the SDK.
 *
 * It exists to be run. An SDK verified only by unit tests is an SDK nobody has
 * watched send anything, and the interesting failures — a cleartext policy
 * that blocks the request, a batch that never flushes because the app never
 * stops, a device string nobody would recognise — only appear on a device.
 */
android {
    namespace = "dev.openincident.rumdemo"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.openincident.rumdemo"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes {
        // Signed with the debug key: this is a harness, not a release.
        getByName("debug") { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(project(":rum"))
}
