package dev.openincident.rum

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A `SharedPreferences` that is a map.
 *
 * Written rather than mocked or emulated: the interface is four methods the
 * session actually uses, and standing up Robolectric to get a hash map is a
 * forty-second test run in exchange for nothing.
 */
private class FakePrefs : SharedPreferences {
    val values = mutableMapOf<String, Any?>()

    override fun getAll() = values.toMap()
    override fun getString(key: String?, defValue: String?) = values[key] as? String ?: defValue
    override fun getStringSet(key: String?, d: MutableSet<String>?) = d
    override fun getInt(key: String?, defValue: Int) = values[key] as? Int ?: defValue
    override fun getLong(key: String?, defValue: Long) = values[key] as? Long ?: defValue
    override fun getFloat(key: String?, defValue: Float) = values[key] as? Float ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean) = values[key] as? Boolean ?: defValue
    override fun contains(key: String?) = values.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        override fun putString(key: String?, value: String?) = apply { values[key!!] = value }
        override fun putStringSet(key: String?, v: MutableSet<String>?) = this
        override fun putInt(key: String?, value: Int) = apply { values[key!!] = value }
        override fun putLong(key: String?, value: Long) = apply { values[key!!] = value }
        override fun putFloat(key: String?, value: Float) = apply { values[key!!] = value }
        override fun putBoolean(key: String?, value: Boolean) = apply { values[key!!] = value }
        override fun remove(key: String?) = apply { values.remove(key) }
        override fun clear() = apply { values.clear() }
        override fun commit() = true
        override fun apply() {}
    }
}

class SessionTest {
    private val now = 1_789_920_000_000L

    @Test
    fun `starts fresh`() {
        val s = Session.resume(FakePrefs(), sampleRate = 1.0, now = now)
        assertEquals(24, s.id.length)
        assertTrue(s.sampled)
    }

    @Test
    fun `resumes after a short absence`() {
        val store = FakePrefs()
        val first = Session.resume(store, 1.0, now)
        val later = Session.resume(store, 1.0, now + 14 * 60_000)
        assertEquals(first.id, later.id)
    }

    @Test
    fun `starts again after the timeout`() {
        val store = FakePrefs()
        val first = Session.resume(store, 1.0, now)
        val after = Session.resume(store, 1.0, now + 16 * 60_000)
        assertNotEquals(first.id, after.id)
    }

    /**
     * The window moves with use: fifteen minutes of *silence*, not a
     * fifteen-minute cap on a visit.
     */
    @Test
    fun `use extends the window`() {
        val store = FakePrefs()
        val first = Session.resume(store, 1.0, now)
        Session.touch(store, now + 10 * 60_000)
        val later = Session.resume(store, 1.0, now + 20 * 60_000)
        assertEquals(first.id, later.id)
    }

    /**
     * The draw is taken once. Per launch it would report the first half of a
     * visit and not the second, which reads as a user who left.
     */
    @Test
    fun `the draw survives a resume`() {
        val store = FakePrefs()
        var draws = 0
        val first = Session.resume(store, 0.5, now) { draws++; 0.9 }
        assertFalse(first.sampled)
        val later = Session.resume(store, 0.5, now + 60_000) { draws++; 0.1 }
        assertFalse(later.sampled)
        assertEquals(first.id, later.id)
        assertEquals("the draw must be taken once per session, not per launch", 1, draws)
    }

    @Test
    fun `ids look like the browser sdks`() {
        val id = Session.newId()
        assertEquals(24, id.length)
        assertTrue(id, id.all { it.isDigit() || it in 'a'..'f' })
    }
}

class RatingTest {
    @Test
    fun `app start`() {
        assertEquals("good", Rating.of("app_start", 1200.0))
        assertEquals("good", Rating.of("app_start", 2000.0))
        assertEquals("needs-improvement", Rating.of("app_start", 3000.0))
        assertEquals("poor", Rating.of("app_start", 9000.0))
    }

    @Test
    fun `screen load`() {
        assertEquals("good", Rating.of("screen_load", 400.0))
        assertEquals("needs-improvement", Rating.of("screen_load", 1800.0))
        assertEquals("poor", Rating.of("screen_load", 4000.0))
    }

    @Test
    fun `an unknown timing is not rated`() {
        assertEquals("", Rating.of("LCP", 100.0))
    }
}
