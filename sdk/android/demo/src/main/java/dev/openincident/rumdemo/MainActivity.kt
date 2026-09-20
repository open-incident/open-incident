package dev.openincident.rumdemo

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import dev.openincident.rum.OpenIncidentRum

/**
 * Read this as the example it is: one call starts the reporting, and the rest
 * is one line per thing worth measuring.
 *
 * The application id and the endpoint come from the build config rather than
 * being compiled in, so the same APK can be pointed at a different instance —
 * which is also how the harness is driven from a script.
 */
class MainActivity : Activity() {
    private var taps = 0
    private lateinit var label: TextView

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)

        OpenIncidentRum.start(
            context = this,
            applicationId = intent.getStringExtra("oi_app") ?: "",
            endpoint = intent.getStringExtra("oi_endpoint") ?: "http://10.0.2.2:4318",
            sampleRate = 1.0,
            service = "oi-demo-android",
        )
        OpenIncidentRum.identify("demo-user-42")

        label = TextView(this).apply {
            text = "Open Incident RUM"
            gravity = Gravity.CENTER
            setTextColor(Color.BLACK)
            textSize = 20f
        }
        val button = Button(this).apply {
            text = "Ajouter au panier"
            setOnClickListener {
                taps++
                label.text = "Panier : $taps"
                OpenIncidentRum.action("add_to_cart", mapOf("items" to taps.toString()))
                OpenIncidentRum.flush()
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            addView(label)
            addView(button)
        })

        OpenIncidentRum.screen("Home")
    }

    override fun onResume() {
        super.onResume()
        // A second screen, so `screen_load` has two calls to measure between.
        Handler(Looper.getMainLooper()).postDelayed({
            OpenIncidentRum.screen("Checkout")
            OpenIncidentRum.resource(
                url = "https://api.example.com/cart", method = "POST",
                status = 201, durationMs = 143.0,
            )
            OpenIncidentRum.error(
                type = "CheckoutError", message = "le paiement a été refusé",
                stack = "MainActivity.pay()\nandroid.view.View.performClick",
            )
            OpenIncidentRum.flush()
        }, 400)
    }
}
