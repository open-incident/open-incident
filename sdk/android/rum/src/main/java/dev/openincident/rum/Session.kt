package dev.openincident.rum

import android.content.SharedPreferences
import java.util.UUID

/**
 * The session, and the one decision taken about it.
 *
 * A mobile session is not a browser tab: the application is stopped and
 * resumed rather than closed, so "the same session" has to be defined in time.
 * Fifteen minutes of silence is the convention every mobile RUM tool settled
 * on, and it is here for the reason they chose it — somebody who checks a
 * message and comes back is in the same visit; somebody who returns the next
 * morning is not.
 *
 * The sampling draw is stored beside the id, so a session being reported keeps
 * being reported across stops. Drawing per launch would report the first half
 * of a visit and not the second, which reads as a user who left.
 */
internal data class Session(val id: String, val sampled: Boolean) {

    internal companion object {
        const val TIMEOUT_MS = 15L * 60L * 1000L

        private const val ID = "oi.rum.session.id"
        private const val SEEN = "oi.rum.session.seen"
        private const val SAMPLED = "oi.rum.session.sampled"

        /** `now` and `draw` are parameters so the expiry can be tested. */
        fun resume(
            store: SharedPreferences,
            sampleRate: Double,
            now: Long = System.currentTimeMillis(),
            draw: () -> Double = { Math.random() },
        ): Session {
            val held = store.getString(ID, null)
            val seen = store.getLong(SEEN, 0L)
            if (held != null && seen > 0L && now - seen < TIMEOUT_MS) {
                store.edit().putLong(SEEN, now).apply()
                return Session(held, store.getBoolean(SAMPLED, false))
            }
            val fresh = Session(newId(), draw() < sampleRate)
            store.edit()
                .putString(ID, fresh.id)
                .putBoolean(SAMPLED, fresh.sampled)
                .putLong(SEEN, now)
                .apply()
            return fresh
        }

        fun touch(store: SharedPreferences, now: Long = System.currentTimeMillis()) {
            store.edit().putLong(SEEN, now).apply()
        }

        /** Twenty-four hex characters, the same shape the browser SDK writes,
         *  so one product does not hold two shapes of session id. */
        fun newId(): String =
            UUID.randomUUID().toString().replace("-", "").lowercase().take(24)
    }
}

/**
 * The thresholds the two mobile timings are rated against, in milliseconds.
 *
 * Carried in the event rather than applied when the chart is drawn: a rating
 * that moved under a stored row is a chart nobody can compare to last month.
 */
internal object Rating {
    fun of(vital: String, ms: Double): String {
        val bounds = when (vital) {
            "app_start" -> 2000.0 to 5000.0
            "screen_load" -> 1000.0 to 2500.0
            else -> return ""
        }
        return when {
            ms <= bounds.first -> "good"
            ms <= bounds.second -> "needs-improvement"
            else -> "poor"
        }
    }
}
