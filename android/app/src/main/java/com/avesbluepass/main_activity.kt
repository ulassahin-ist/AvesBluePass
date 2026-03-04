package com.aves.hce

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.*
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.widget.TextView
import android.graphics.Color
import android.view.View
import android.graphics.Bitmap
import android.util.Log
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import android.graphics.BitmapFactory
import com.aves.hce.databinding.MainActivityBinding

class main_activity : AppCompatActivity()
{
    private lateinit var binding: MainActivityBinding

    private val PERMISSION_REQ = 101
    private var countdownTimer: CountDownTimer? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?)
    {
        super.onCreate(savedInstanceState)

        binding = MainActivityBinding.inflate(layoutInflater)
        setContentView(binding.root)

        __Startup_Jobs();

        _Check_And_Request_Permissions()


        binding.bSettings?.setOnClickListener {
            startActivity(Intent(this, settings_main::class.java))
        }

        binding.cardNfc.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NFC_SETTINGS))
        }

        binding.cardBle.setOnClickListener {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        }


        registerBleReceiver() // Broadcast receiver
        _Start_Ble_Service() // BLE servisini başlat

        // onclick ------------------------------------------------------------
        binding.bRenewQr.setOnClickListener {
            Util.__GET_FROM_SERVER(this@main_activity, lifecycleScope)
            SystemSoundHelper.playClick(this@main_activity)
        }
    }
    //---------------------------------------------------------------------------
    private val bleStatusReceiver = object : BroadcastReceiver()
    {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                "com.example.ble.STATUS_UPDATE" -> {
                    val message = intent.getStringExtra("EXTRA_MESSAGE") ?: ""
                    Log.d("MAIN_ACTIVITY", "Broadcast alındı: $message")

                    // UI'ı güncelle
                    runOnUiThread {
                        binding.tBleStatusMessage.text = message
                        binding.tBleStatusMessage.setTextColor(Color.GRAY)
                        binding.tBleStatusMessage.visibility = View.VISIBLE
                    }
                }
                "LOCAL_BLE_STATUS_UPDATE" -> {
                    val message = intent.getStringExtra("EXTRA_MESSAGE") ?: ""
                    Log.d("MAIN_ACTIVITY", "Local broadcast alındı: $message")

                    runOnUiThread {
                        binding.tBleStatusMessage.text = message
                        binding.tBleStatusMessage.setTextColor(Color.GRAY)
                        binding.tBleStatusMessage.visibility = View.VISIBLE
                    }
                }
                // Alternatif action'ları da dinle
                "BLE_STATUS_UPDATE" -> {
                    val message = intent.getStringExtra("message") ?: ""
                    Log.d("MAIN_ACTIVITY", "BLE_STATUS_UPDATE alındı: $message")

                    runOnUiThread {
                        binding.tBleStatusMessage.text = message
                        binding.tBleStatusMessage.setTextColor(Color.GRAY)
                        binding.tBleStatusMessage.visibility = View.VISIBLE
                    }
                }
            }
        }
    }
    //---------------------------------------------------------------------------
    private fun __Startup_Jobs()
    {
        Util._Get_Card_Data(this)

        _Load_User_Info()
    }
    //---------------------------------------------------------------------------
    private fun registerBleReceiver()
    {
        val filter = IntentFilter().apply {
            addAction("com.example.ble.STATUS_UPDATE")
            addAction("LOCAL_BLE_STATUS_UPDATE")
            addAction("BLE_STATUS_UPDATE")  // Alternatif action
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(bleStatusReceiver, filter, RECEIVER_EXPORTED)
        } else {
            registerReceiver(bleStatusReceiver, filter)
        }

        Log.d("MAIN_ACTIVITY", "BLE receiver kaydedildi")
    }
    //---------------------------------------------------------------------------


    // Kart verisi güncellendiğinde tetiklenen receiver
    private val cardUpdateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            mainHandler.post {
                Util.UpdateInProgress = false
                _Update_QR()
            }
        }
    }
    //---------------------------------------------------------------------------
    // Servis durumunu (aktif/pasif) kontrol eden receiver
    private val renewButtonReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val isEnabled = intent?.getBooleanExtra(Util.EXTRA_IS_ENABLED, true) ?: true

            if (isEnabled) binding.bRenewQr.visibility = View.VISIBLE
                      else binding.bRenewQr.visibility = View.GONE
        }
    }
    //---------------------------------------------------------------------------
    private fun _Update_Nfc_Ble_Statuses()
    {
        val nfcAdapter = android.nfc.NfcAdapter.getDefaultAdapter(this)
        if (nfcAdapter != null && nfcAdapter.isEnabled) {
            binding.tNfcStatus.text = "NFC : ON"
            binding.tNfcStatus.setTextColor(Color.parseColor("#2E7D32"))
            binding.imgNfc.setColorFilter(Color.parseColor("#2E7D32"))
        } else {
            binding.tNfcStatus.text = "NFC : OFF"
            binding.tNfcStatus.setTextColor(Color.parseColor("#C62828"))
            binding.imgNfc.setColorFilter(Color.parseColor("#C62828"))
        }

        val manager = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = manager.adapter
        if (adapter != null && adapter.isEnabled) {
            Util.BleActive = 1;
            binding.tBleStatus.text = "BLE : ON"
            binding.tBleStatus.setTextColor(Color.parseColor("#2E7D32"))
            binding.imgBle.setColorFilter(Color.parseColor("#2E7D32"))
        } else {
            Util.BleActive = 0;
            binding.tBleStatus.text = "BLE : OFF"
            binding.tBleStatus.setTextColor(Color.parseColor("#C62828"))
            binding.imgBle.setColorFilter(Color.parseColor("#C62828"))
        }
    }
    //---------------------------------------------------------------------------
    private val uiNfcReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "android.nfc.action.ADAPTER_STATE_CHANGED") {
                _Update_Nfc_Ble_Statuses()
            }
        }
    }
    //---------------------------------------------------------------------------
    private val uiBluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                _Update_Nfc_Ble_Statuses()
            }
        }
    }
    //---------------------------------------------------------------------------
    override fun onResume() {
        super.onResume()

        _Update_Nfc_Ble_Statuses()
        _Check_Battery_Optimizations()

        // Broadcast Kayıtları
        registerReceiver(uiNfcReceiver, IntentFilter("android.nfc.action.ADAPTER_STATE_CHANGED"))
        registerReceiver(uiBluetoothReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))

        val cardFilter = IntentFilter("CARD_UPDATED")
        val stateFilter = IntentFilter(Util.RENEW_STATE_CHANGED)



        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(cardUpdateReceiver, cardFilter, RECEIVER_EXPORTED)
            registerReceiver(renewButtonReceiver, stateFilter, RECEIVER_EXPORTED)
        } else {
            registerReceiver(cardUpdateReceiver, cardFilter)
            registerReceiver(renewButtonReceiver, stateFilter)
        }

        try {
            registerBleReceiver()
        } catch (e: Exception) {
            Log.e("MAIN_ACTIVITY", "Receiver kaydedilirken hata: ${e.message}")
        }

        _Start_Ble_Service()
        _Update_QR()
        _Load_User_Info()
    }
    //---------------------------------------------------------------------------
    override fun onPause() {
        super.onPause()
        try {
            unregisterReceiver(uiNfcReceiver)
            unregisterReceiver(uiBluetoothReceiver)
            unregisterReceiver(cardUpdateReceiver)
            unregisterReceiver(renewButtonReceiver)
        } catch (e: Exception) { }
    }
    //---------------------------------------------------------------------------
    private fun _Check_And_Request_Permissions() {
        val permissionsNeeded = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissionsNeeded.add(Manifest.permission.BLUETOOTH_SCAN)
            permissionsNeeded.add(Manifest.permission.BLUETOOTH_CONNECT)
            permissionsNeeded.add(Manifest.permission.BLUETOOTH_ADVERTISE)
        } else {
            permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        val listToRequest = permissionsNeeded.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (listToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, listToRequest.toTypedArray(), PERMISSION_REQ)
        }
    }
    //---------------------------------------------------------------------------
    private fun _Update_QR()
    {
        if (Util.CardCode == 0)
        {
            binding.imgQr.visibility = View.GONE
            binding.tCardCode.visibility = View.GONE
            binding.tCountdown.visibility = View.GONE
            binding.bRenewQr.       visibility = View.GONE
            return
        }

        val cardData = Util.ApduData
        if (cardData.isEmpty()) return

        Log.d("CARD_STATE", " >>>>>>> QR refreshed")

        try {

            val qrPayload = cardData.copyOfRange(0, 102)


            val prefs = getSharedPreferences("settings", Context.MODE_PRIVATE)
            val savedLevel = prefs.getString("qr_quality", "L") ?: "L"

            val ecLevel = when (savedLevel) {
                "L" -> ErrorCorrectionLevel.L
                "M" -> ErrorCorrectionLevel.M
                "Q" -> ErrorCorrectionLevel.Q
                "H" -> ErrorCorrectionLevel.H
                else -> ErrorCorrectionLevel.L
            }

            val hints = mapOf(
                EncodeHintType.CHARACTER_SET to "ISO-8859-1",
                EncodeHintType.ERROR_CORRECTION to ecLevel,
                EncodeHintType.MARGIN to 1
            )


            val qrSize = 240
            val writer = QRCodeWriter()

            val matrix = writer.encode(String(qrPayload, Charsets.ISO_8859_1), BarcodeFormat.QR_CODE, qrSize, qrSize, hints)

            val pixels = IntArray(qrSize * qrSize)
            for (y in 0 until qrSize) {
                val offset = y * qrSize
                for (x in 0 until qrSize) {
                    pixels[offset + x] = if (matrix[x, y]) Color.BLACK else Color.WHITE
                }
            }

            // Bitmap oluşturma (RGB_565 hafıza dostudur)
            val bitmap = Bitmap.createBitmap(qrSize, qrSize, Bitmap.Config.RGB_565)
            bitmap.setPixels(pixels, 0, qrSize, 0, 0, qrSize, qrSize)


            binding.imgQr.setImageBitmap(bitmap)
            binding.imgQr.visibility = View.VISIBLE

            binding.tCardCode.text = Util.CardCode.toString()
            binding.tCardCode.visibility = View.VISIBLE

            _Start_Count_Down()
        }
        catch (e: Exception)
        {
            binding.imgQr.visibility = View.GONE
            binding.tCardCode.visibility = View.GONE
        }
    }
    //---------------------------------------------------------------------------
    override fun onDestroy() {
        super.onDestroy()
        try {
            // Sadece destroy'da kaldır
            unregisterReceiver(bleStatusReceiver)
        } catch (e: Exception) { }
    }
    //---------------------------------------------------------------------------
    private fun _Start_Count_Down()
    {
        Log.d("CARD_STATE", "Counting start")

        val remainSecond:UInt = Util._Remain_Second()
        countdownTimer?.cancel()

        if (remainSecond != 0xFFFFFFFFu)
        {
            countdownTimer = object : CountDownTimer((remainSecond * 1000u).toLong(), 1000) {
                override fun onTick(millisUntilFinished: Long)
                {
                    binding.tCountdown.text = (millisUntilFinished / 1000).toString()
                    binding.tCountdown.visibility = View.VISIBLE
                    //Log.d("CARD_STATE", "Counting changed")
                }

                override fun onFinish() {
                    binding.tCountdown.visibility = View.GONE
                    binding.imgQr.visibility = View.GONE
                    binding.tCardCode.visibility = View.GONE
                    Log.d("CARD_STATE", "Counting End")
                }
            }.start()
        }
        else
        {
            binding.tCountdown.text = ""
        }
    }
    //---------------------------------------------------------------------------
    private fun _Load_User_Info() {

        val prefs = getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
        val fullName = prefs.getString("fullName", "") ?: ""

        binding.tFullName.text =
            if (fullName.isNotEmpty()) fullName
            else ""

        val photoFile = filesDir.listFiles()?.firstOrNull {
            it.name.startsWith("photo.")
        }

        if (photoFile != null && photoFile.exists()) {
            val bitmap = BitmapFactory.decodeFile(photoFile.absolutePath)
            binding.imgPerson.setImageBitmap(bitmap)
        } else {
            binding.imgPerson.setImageDrawable(null)
        }
    }
    //---------------------------------------------------------------------------
    private fun _Start_Ble_Service() {
        val manager = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
        if (manager.adapter?.isEnabled == true) {
            val intent = Intent(this, _ble_service::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, intent)
            } else {
                startService(intent)
            }
        }
    }
    //---------------------------------------------------------------------------
    private fun _Check_Battery_Optimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) { }
            }
        }
    }
    //---------------------------------------------------------------------------
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQ && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            _Start_Ble_Service()
        }
    }
}