package com.avesbluepass

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class BleServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "BleServiceModule"

    // ── Forward LOCAL_BLE_STATUS_UPDATE broadcasts to JS ──────────────────
    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val msg = intent?.getStringExtra("EXTRA_MESSAGE") ?: ""
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("BLE_STATUS_UPDATE", msg)
        }
    }

    init {
        val filter = IntentFilter("LOCAL_BLE_STATUS_UPDATE")
        // Android 14+ (API 34) requires explicit exported/not-exported flag.
        // This receiver only handles our own local broadcasts so NOT_EXPORTED is correct.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            reactContext.registerReceiver(statusReceiver, filter)
        }
    }

    // Required boilerplate for NativeEventEmitter on the JS side
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ── Start the foreground BLE service ──────────────────────────────────
    @ReactMethod
    fun startService() {
        val intent = Intent(reactContext, ble_service::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    // ── Stop the foreground BLE service ───────────────────────────────────
    @ReactMethod
    fun stopService() {
        reactContext.stopService(Intent(reactContext, ble_service::class.java))
    }
}