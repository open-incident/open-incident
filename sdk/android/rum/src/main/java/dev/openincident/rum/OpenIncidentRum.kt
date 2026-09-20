package dev.openincident.rum

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock

/**
 * Open Incident — real user monitoring, in an Android application.
 *
 * The same two rules as the iOS and browser SDKs, because they are the rules of
 * any library that ships inside somebody else's product:
 *
 *  1. **It never throws into the host application.** Every public entry point
 *     swallows its own failure; a mistake here costs its measurement and
 *     nothing else.
 *  2. **It never blocks.** Every call hands work to one background thread and
 *     returns. Nothing is encoded, and no request is made, on the thread that
 *     is drawing the screen.
 *
 * What it does **not** do, said here rather than discovered later: it does not
 * capture crashes. An `UncaughtExceptionHandler` would catch a Java throw and
 * miss every native one, would have to write to disk and replay on the next
 * launch to be trustworthy, and would fight whatever crash reporter the
 * application already installs. An SDK that claims crash reporting and
 * delivers a try/catch is worse than one that says it has none, because
 * somebody stops looking for a real one. Report what you catch with [error].
 */
object OpenIncidentRum {

    // MARK: starting

    /**
     * Starts reporting. Safe to call twice; the second call is ignored.
     *
     * [applicationId] is a public write-only token: it ships inside your APK
     * and anybody can read it out. The workspace has to allow mobile
     * applications before it is accepted at all.
     */
    @JvmStatic
    @JvmOverloads
    fun start(
        context: Context,
        applicationId: String,
        endpoint: String,
        sampleRate: Double = 1.0,
        service: String = "",
    ) {
        try {
            if (client != null || applicationId.isEmpty()) return
            val app = context.applicationContext
            store = app.getSharedPreferences("oi.rum", Context.MODE_PRIVATE)
            val session = Session.resume(store!!, sampleRate)
            if (!session.sampled) return
            client = Client(app, applicationId, endpoint, session, service)
            (app as? Application)?.registerActivityLifecycleCallbacks(Lifecycle)
            reportLaunch()
        } catch (t: Throwable) {
            // A monitoring library that takes the application down with it has
            // done more harm than the absence of monitoring ever could.
        }
    }

    // MARK: what the application reports

    /**
     * A screen the user is now looking at.
     *
     * Also closes the previous one: the time between two calls is what
     * `screen_load` measures, which is the number a user feels after a tap.
     */
    @JvmStatic
    fun screen(name: String) {
        val at = System.currentTimeMillis()
        submit {
            val c = client ?: return@submit
            store?.let { Session.touch(it, at) }
            val opened = screenOpenedAt
            if (opened != null && currentScreen.isNotEmpty() && currentScreen !in measured) {
                // Only the first paint of a screen is a load. A screen the user
                // sat on for four minutes is not a four-minute load.
                measured.add(currentScreen)
                c.add(vital("screen_load", (at - opened).toDouble(), currentScreen, at))
            }
            currentScreen = name
            screenOpenedAt = at
            c.newView()
            c.add(Event(Event.Kind.SCREEN_VIEW, at, screen = name))
        }
    }

    /** Anything the application wants on the timeline: a tap, a step, a purchase. */
    @JvmStatic
    @JvmOverloads
    fun action(name: String, attributes: Map<String, String> = emptyMap()) {
        val at = System.currentTimeMillis()
        submit {
            val c = client ?: return@submit
            store?.let { Session.touch(it, at) }
            c.add(Event(Event.Kind.ACTION, at, screen = currentScreen, message = name, attributes = attributes))
        }
    }

    /** Something that went wrong and was caught. */
    @JvmStatic
    @JvmOverloads
    fun error(throwable: Throwable, type: String = "") {
        report(
            type = type.ifEmpty { throwable.javaClass.simpleName },
            message = throwable.message ?: throwable.toString(),
            stack = throwable.stackTrace.take(40).joinToString("\n") { it.toString() },
        )
    }

    /** The same, when there is no throwable to hand. */
    @JvmStatic
    @JvmOverloads
    fun error(type: String, message: String, stack: String = "") = report(type, message, stack)

    /**
     * One network call, with what came back.
     *
     * Reported by the application rather than intercepted. Interception means
     * an OkHttp interceptor we install into a client we do not own, or a
     * `URL.setURLStreamHandlerFactory` that can be set once per process and
     * will fight whatever else wanted it. The trade is honest: a line of code
     * per call site, and no chance of breaking the network of the app we were
     * added to measure.
     */
    @JvmStatic
    @JvmOverloads
    fun resource(
        url: String,
        method: String = "GET",
        status: Int = 0,
        durationMs: Double = 0.0,
        error: String = "",
    ) {
        val at = System.currentTimeMillis()
        submit {
            val c = client ?: return@submit
            store?.let { Session.touch(it, at) }
            val attributes = mutableMapOf("http.method" to method, "http.url" to url)
            if (status > 0) attributes["http.status_code"] = status.toString()
            if (error.isNotEmpty()) attributes["error"] = error
            c.add(Event(Event.Kind.RESOURCE, at, screen = currentScreen,
                value = durationMs, message = url, attributes = attributes))
        }
    }

    /**
     * Name the person, however the application knows them. Hashed on arrival,
     * with the workspace's own salt, and the value is thrown away.
     */
    @JvmStatic
    fun identify(value: String?) = submit { user = value }

    /**
     * Sends whatever is buffered. Called for you when the application stops;
     * exposed because a test wants to be sure.
     */
    @JvmStatic
    fun flush() = submit { client?.flush() }

    // MARK: inside

    private var client: Client? = null
    private var store: SharedPreferences? = null
    private var user: String? = null
    private var currentScreen = ""
    private var screenOpenedAt: Long? = null
    private val measured = mutableSetOf<String>()
    private var launched = false

    internal fun userValue(): String? = user

    private fun submit(work: () -> Unit) {
        try {
            Worker.run {
                try {
                    work()
                } catch (t: Throwable) {
                    // As above: never into the host application.
                }
            }
        } catch (t: Throwable) {
        }
    }

    private fun report(type: String, message: String, stack: String) {
        val at = System.currentTimeMillis()
        submit {
            val c = client ?: return@submit
            store?.let { Session.touch(it, at) }
            c.add(Event(Event.Kind.ERROR, at, screen = currentScreen,
                errorType = type, message = message, stack = stack))
        }
    }

    private fun vital(name: String, ms: Double, screen: String, at: Long) =
        Event(Event.Kind.VITAL, at, screen = screen, vital = name,
            value = Math.round(ms).toDouble(), rating = Rating.of(name, ms))

    /**
     * Cold start: from the moment the process began to the moment the first
     * frame is on the glass.
     *
     * `Process.getStartUptimeMillis` rather than a timestamp taken in [start],
     * because by then the expensive part — the zygote fork, the class loading,
     * the Application object — has already happened, and a launch metric that
     * starts after the launch measures nothing. The first frame is taken from
     * the next main-looper turn, which is the closest a library can get without
     * attaching to the choreographer of an activity it does not own.
     */
    private fun reportLaunch() {
        if (launched) return
        launched = true
        Handler(Looper.getMainLooper()).post {
            val ms = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    (SystemClock.uptimeMillis() - Process.getStartUptimeMillis()).toDouble()
                } else {
                    return@post
                }
            } catch (t: Throwable) {
                return@post
            }
            // A process the system kept warm can report hours. Beyond a minute
            // it is not a launch, it is a clock.
            if (ms <= 0 || ms >= 60_000) return@post
            submit { client?.add(vital("app_start", ms, currentScreen, System.currentTimeMillis())) }
        }
    }

    /**
     * Screens named for free, and the flush when the application leaves.
     *
     * Registered only if the context given to [start] is the `Application`, so
     * an SDK started from a library context does not silently do nothing
     * different — it does nothing extra, and [screen] still works by hand.
     */
    private object Lifecycle : Application.ActivityLifecycleCallbacks {
        private var visible = 0
        override fun onActivityCreated(a: Activity, b: Bundle?) {}
        override fun onActivityStarted(a: Activity) {
            visible++
        }
        override fun onActivityResumed(a: Activity) {
            store?.let { Session.touch(it) }
        }
        override fun onActivityPaused(a: Activity) {}
        override fun onActivityStopped(a: Activity) {
            visible--
            // Zero visible activities is the moment Android stops promising the
            // process anything, which makes it this platform's `pagehide`.
            if (visible <= 0) flush()
        }
        override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
        override fun onActivityDestroyed(a: Activity) {}
    }
}
