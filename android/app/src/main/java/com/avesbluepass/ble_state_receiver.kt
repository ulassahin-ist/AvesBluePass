package com.aves.hce

import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log


class ble_state_receiver : BroadcastReceiver()
{
    override fun onReceive(context: Context, intent: Intent)
    {
        if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED)
        {
            val state = intent.getIntExtra(
                BluetoothAdapter.EXTRA_STATE,
                BluetoothAdapter.ERROR
            )

            val serviceIntent = Intent(context, _ble_service::class.java)

            when (state)
            {
                BluetoothAdapter.STATE_ON -> {
                    Log.d("BLE_RECEIVER", "Bluetooth açıldı -> Servis başlatılıyor")

                    // KRİTİK REVİZYON: Android 8.0+ için startForegroundService kullanılmalı
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            context.startForegroundService(serviceIntent)
                        } else {
                            context.startService(serviceIntent)
                        }
                    } catch (e: Exception) {
                        Log.e("BLE_RECEIVER", "Servis başlatılamadı: ${e.message}")
                    }
                }
                BluetoothAdapter.STATE_OFF -> {
                    Log.d("BLE_RECEIVER", "Bluetooth kapandı -> Servis durduruluyor")
                    context.stopService(serviceIntent)
                }
            }
        }
    }
}