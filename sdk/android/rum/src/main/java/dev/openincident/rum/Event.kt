package dev.openincident.rum

import org.json.JSONObject

/**
 * One thing that happened in the application, in the shape the ingest reads.
 *
 * Built by hand into a `JSONObject` rather than serialised from the class: the
 * endpoint takes a small, stable, hand-written object, and generating it from
 * Kotlin property names means a rename in this file silently changes the
 * protocol. `org.json` is in the platform, so this costs no dependency.
 */
internal data class Event(
    val kind: Kind,
    val at: Long,
    val screen: String = "",
    val vital: String = "",
    val value: Double = 0.0,
    val rating: String = "",
    val errorType: String = "",
    val message: String = "",
    val stack: String = "",
    val attributes: Map<String, String> = emptyMap(),
) {
    internal enum class Kind(val wire: String) {
        SCREEN_VIEW("page_view"),
        VITAL("mobile_vital"),
        ERROR("error"),
        RESOURCE("resource"),
        ACTION("action"),
        LONG_TASK("long_task"),
    }

    fun payload(session: String, view: String, user: String?): JSONObject {
        val out = JSONObject()
        out.put("type", kind.wire)
        out.put("ts", at)
        out.put("session", session)
        out.put("view", view)
        // A screen has no URL. `route` is what the product groups by — one row
        // per screen rather than one per user — and a screen name is exactly
        // that, so it goes there and `url` stays empty.
        out.put("route", screen)
        out.put("url", "")
        if (vital.isNotEmpty()) {
            out.put("vital", vital)
            out.put("rating", rating)
        }
        // Outside a vital, `value` is how long a resource took, which is the
        // one thing worth knowing about a network call.
        if (value != 0.0) out.put("value", value)
        if (errorType.isNotEmpty()) out.put("errorType", errorType)
        if (message.isNotEmpty()) out.put("message", message)
        if (stack.isNotEmpty()) out.put("stack", stack)
        if (attributes.isNotEmpty()) out.put("attributes", JSONObject(attributes.toMap()))
        if (!user.isNullOrEmpty()) out.put("user", user)
        return out
    }
}
