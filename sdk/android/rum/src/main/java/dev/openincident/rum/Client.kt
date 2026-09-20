package dev.openincident.rum

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * One background thread for everything.
 *
 * A single serial executor rather than locks: the thread *is* the lock, so the
 * buffer below needs none, and the public surface is a queue of small tasks
 * that never touch the main looper.
 */
internal object Worker {
    private val pool: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "oi-rum").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
    }

    fun run(task: () -> Unit) {
        pool.execute(task)
    }

    fun every(seconds: Long, task: () -> Unit) {
        pool.scheduleWithFixedDelay(task, seconds, seconds, TimeUnit.SECONDS)
    }
}

/** The buffer and the request. Everything here runs on [Worker]'s thread. */
internal class Client(
    context: Context,
    applicationId: String,
    endpoint: String,
    private val session: Session,
    service: String,
) {
    companion object {
        /** The ingest's own ceiling. */
        const val MAX_EVENTS = 1000
        /** Flushed at this many, or on the timer, or when the app stops. */
        const val BATCH_AT = 40
        const val INTERVAL_S = 15L
    }

    private val url = URL(endpoint.trimEnd('/') + "/v1/rum?app=" + applicationId)
    private val device = describe(context, service)
    private val buffer = ArrayList<Event>()
    private var view = Session.newId()

    init {
        Worker.every(INTERVAL_S) { flush() }
    }

    fun newView() {
        view = Session.newId()
    }

    fun add(event: Event) {
        buffer.add(event)
        // A page producing more than a thousand between flushes has a loop in
        // it; dropping the oldest keeps the newest, which is the half anybody
        // would want.
        while (buffer.size > MAX_EVENTS) buffer.removeAt(0)
        if (buffer.size >= BATCH_AT) flush()
    }

    fun flush() {
        if (buffer.isEmpty()) return
        val batch = ArrayList(buffer)
        buffer.clear()

        val events = JSONArray()
        for (e in batch) events.put(e.payload(session.id, view, OpenIncidentRum.userValue()))
        val body = JSONObject()
            // The device states itself rather than being guessed from a
            // user-agent. A phone has no honest one to send, and a faked one is
            // how "Pixel" ends up filed under "Chrome".
            .put("app", JSONObject(device.toMap()))
            .put("events", events)
            .toString()

        var connection: HttpURLConnection? = null
        try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 10_000
                readTimeout = 10_000
                useCaches = false
            }
            connection.outputStream.use { out: OutputStream ->
                out.write(body.toByteArray(Charsets.UTF_8))
            }
            // The status is read because HttpURLConnection does not send the
            // body until somebody asks for one, and never sending it is how a
            // batch quietly stays in memory.
            connection.responseCode
        } catch (t: Throwable) {
            // A dropped batch is dropped. Holding it would grow without bound
            // in an application that is offline, and its events are stale by
            // the time the network returns.
        } finally {
            connection?.disconnect()
        }
    }

    private fun describe(context: Context, service: String): Map<String, String> {
        val name = service.ifEmpty {
            try {
                context.applicationInfo.loadLabel(context.packageManager).toString()
            } catch (t: Throwable) {
                "Android app"
            }
        }
        val version = try {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
        } catch (t: Throwable) {
            ""
        }
        return mapOf(
            "platform" to "android",
            "os" to "Android ${Build.VERSION.RELEASE}",
            // `Pixel 8` rather than `sdk_gphone64_arm64` where the device knows
            // its marketing name; the model is what a reader recognises.
            "device" to listOf(Build.MANUFACTURER, Build.MODEL)
                .filter { it.isNotBlank() }
                .joinToString(" ")
                .take(60),
            "app" to if (version.isEmpty()) name else "$name $version",
        )
    }
}
