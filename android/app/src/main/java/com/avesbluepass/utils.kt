package com.avesbluepass

import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import android.media.AudioManager
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.widget.Toast
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL


// NFC Apdu + HCE      Minimum: API 19
// BLE + Advertising   Minimum: API 21

// API	Android Versiyonu	Çıkış Yılı
// -----------------------------------
// 21	Android 5.0 Lollipop	2014
// 26	Android 8.0 Oreo	    2017
// Projede 26 seçildi




/*
carddata.bin dosyası içeriği
offset  length   description
-------------------------------------------------------------------
  0       96     main card data
 96        6     year, month, day, hour, minute, second (encoded)
102        4     validtySecond
106        6     year, month, day, hour, minute, second (raw)
112        8     phoneID
-------------------------------------------------------------------
total    120 byte
*/

object SystemSoundHelper
{
     /**                                                      sound funcs
     * Sistemin standart tıklama sesini çalar.
     * Kullanım: SystemSoundHelper.playClick(context)
     */
    fun playClick(context: Context)
    {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        // FX_KEY_CLICK: Standart buton/klavye tıklama sesidir.
        // 1.0f: Ses seviyesi (Sistem ayarına göre otomatik ölçeklenir)
        audioManager.playSoundEffect(AudioManager.FX_KEY_CLICK, 1.0f)
    }

    /**
     * Alternatif olarak geri tuşu veya navigasyon sesini çalar.
     */
    fun playNavigationReturn(context: Context)
    {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.playSoundEffect(AudioManager.FX_FOCUS_NAVIGATION_UP, 1.0f)
    }

   // KULLANIM ÖRNEKLERİ:
   // 1 Activity içinde: SystemSoundHelper.playClick(this)
   // 2 Fragment içinde: SystemSoundHelper.playClick(requireContext())
   // 3 HCE Servisi veya Arka Plan İşlemi içinde: SystemSoundHelper.playClick(applicationContext)
}
//---------------------------------------------------------------------------






object Util
{
    @Volatile
    var UpdateInProgress = false

    @Volatile
    var ApduData = ByteArray(120)

    @Volatile
    var CardReadedFromDisk = false

    @Volatile
    var ValiditySecond: Int = 1

    @Volatile
    var CardCode: Int = 0

    @Volatile
    var BleActive: Int = 0

    @Volatile
    var RemainSecond:UInt = 0u


    const val RENEW_STATE_CHANGED = "RENEW_CHANGED"
    const val EXTRA_IS_ENABLED = "extra_is_enabled"

    fun _Broadcast_Renew_Button(context: Context, isEnabled: Boolean) {
        val intent = Intent(RENEW_STATE_CHANGED)
        intent.putExtra(EXTRA_IS_ENABLED, isEnabled)
        context.sendBroadcast(intent)
    }
    //---------------------------------------------------------------------------
    fun _Get_Phone_ID_ByteArray(context: Context): ByteArray
    {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: (Build.BOARD + Build.BRAND + Build.DEVICE)

        // String'i 64-bit Long'a dönüştür (deterministik)
        val value = androidId.fold(0L) { acc, c ->
            acc * 31 + c.code
        }

        // Long → 8 byte (big endian)
        return ByteArray(8) { i ->
            ((value shr (56 - i * 8)) and 0xFF).toByte()
        }
    }
    //---------------------------------------------------------------------------
    fun _Get_Phone_ID_HexStr(context: Context): String {
        return _Get_Phone_ID_ByteArray(context)
            .joinToString("") { "%02X".format(it) }
    }
    //---------------------------------------------------------------------------
    fun _Remain_Second(): UInt
    {
        try {
            CardCode =
                ( ApduData[0].toInt() and 0xFF) +
                ((ApduData[1].toInt() and 0xFF) shl 8) +
                ((ApduData[2].toInt() and 0xFF) shl 16) +
                ((ApduData[3].toInt() and 0xFF) shl 24)

            ValiditySecond =
                ( ApduData[102].toInt() and 0xFF) +
                ((ApduData[103].toInt() and 0xFF) shl 8) +
                ((ApduData[104].toInt() and 0xFF) shl 16) +
                ((ApduData[105].toInt() and 0xFF) shl 24)

            if (ValiditySecond == 0) return 0xFFFFFFFFu

            val year   = (ApduData[106].toInt() and 0xFF) + 2000
            val month  =  ApduData[107].toInt() and 0xFF
            val day    =  ApduData[108].toInt() and 0xFF
            val hour   =  ApduData[109].toInt() and 0xFF
            val minute =  ApduData[110].toInt() and 0xFF
            val second =  ApduData[111].toInt() and 0xFF



            val cardTime =
                java.time.LocalDateTime.of(year, month, day, hour, minute, second)

            val cardEpoch =
                cardTime.atZone(java.time.ZoneId.systemDefault()).toEpochSecond()

            val nowEpoch = System.currentTimeMillis() / 1000

            val elapsed = nowEpoch - cardEpoch
            val remain = ValiditySecond.toLong() - elapsed

            return if (remain <= 0) 0u else remain.toUInt()
        } catch (e: Exception) {
            e.printStackTrace()
            return 0u
        }
    }
    //---------------------------------------------------------------------------
    fun _Update_From_Server(context: Context, scope: CoroutineScope)
    {
        scope.launch(Dispatchers.IO) {
            val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
            val username = prefs.getString("e_mail", "") ?: ""
            val password = prefs.getString("pword", "") ?: ""
            val phoneID = _Get_Phone_ID_HexStr(context)

            val json = JSONObject()
            json.put("apiname" , "getCardData")
            json.put("username", username)
            json.put("password", password)
            json.put("phoneID" , phoneID)

            val response = UdpClient.__Send_And_Receive(context, json.toString())

            withContext(Dispatchers.Main) {
                if (response.success)
                {
                    val jsonResp = response.jsonAnswer
                    if (jsonResp == null)
                    {
                        Toast.makeText(context, "Sunucu cevabı boş", Toast.LENGTH_SHORT).show()
                        return@withContext
                    }

                    val b64 = jsonResp.optString("cardData")
                    if (b64.isEmpty())
                    {
                        Toast.makeText(context, "cardData eksik", Toast.LENGTH_SHORT).show()
                        return@withContext
                    }

                    val newData = Base64.decode(b64, Base64.DEFAULT)

                    if (newData.size == 112) _Write_To_Disk(context, newData)
                }
                else
                {
                    Toast.makeText(context, response.errorMessage, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
    //---------------------------------------------------------------------------
    fun __GET_FROM_SERVER(context: Context, scope: CoroutineScope)
    {
        if (!UpdateInProgress)
        {
            _Broadcast_Renew_Button(context, false)
            UpdateInProgress = true;

            _Update_From_Server(context, scope)

            UpdateInProgress = false;
            _Broadcast_Renew_Button(context, true)

            Log.d("CARD_STATE", "Server renew request")
        }
        else Log.d("CARD_STATE", "Renew progress")
    }
    //---------------------------------------------------------------------------
    fun _Save_Full_Name(context: Context, fullName: String)
    {
        val prefs = context.getSharedPreferences(
            "app_prefs",
            Context.MODE_PRIVATE
        )

        prefs.edit()
            .putString("fullName", fullName)
            .apply()
    }
    //---------------------------------------------------------------------------
    private suspend fun _Http_Download_And_Save_Photo(context: Context, tcNo: String)
    {
        withContext(Dispatchers.IO) {
            try {
                val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
                val serverIp = prefs.getString("server_ip", "192.168.1.10")

                val url = URL("http://$serverIp:8080/photo?tcNo=$tcNo")
                val connection = url.openConnection() as HttpURLConnection
                connection.connectTimeout = 4000
                connection.readTimeout = 4000
                connection.requestMethod = "GET"

                if (connection.responseCode == HttpURLConnection.HTTP_OK) {

                    val inputStream = connection.inputStream
                    val bytes = inputStream.readBytes()
                    inputStream.close()

                    // Eski photo dosyalarını temizle
                    context.filesDir.listFiles()?.forEach {
                        if (it.name.startsWith("photo.")) {
                            it.delete()
                        }
                    }

                    // Content-Type’a göre uzantı belirle
                    val extension = when (connection.contentType) {
                        "image/jpeg" -> ".jpg"
                        "image/jpg"  -> ".jpg"
                        "image/png"  -> ".png"
                        "image/bmp"  -> ".bmp"
                        else -> ".img"
                    }

                    val file = File(context.filesDir, "photo$extension")
                    file.writeBytes(bytes)
                }

                connection.disconnect()

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
    //---------------------------------------------------------------------------
    suspend fun _Get_BluePass_Inf(context: Context, tcNo: String): Boolean {

        return withContext(Dispatchers.IO) {

            try {
                val jsonReq = JSONObject()
                jsonReq.put("apiname", "getBluePassInf")
                jsonReq.put("tcNo", tcNo)

                val response = UdpClient.__Send_And_Receive(context, jsonReq.toString())

                if (response.success && response.jsonAnswer != null) {

                    val json = response.jsonAnswer

                    if (json.optInt("result") == 0) {

                        val fullName = json.optString("fullName", "")
                        _Save_Full_Name(context.applicationContext, fullName)

                        val hasPicture = json.optBoolean("hasPicture", false)

                        if (hasPicture) {
                            _Http_Download_And_Save_Photo(context, tcNo)
                        }

                        return@withContext true
                    }
                }

                false

            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }
    }
    //---------------------------------------------------------------------------
    suspend fun _Delete_User_Account(context: Context, tcNo: String, phoneID: String): Boolean {

        return withContext(Dispatchers.IO) {

            try {
                val jsonReq = JSONObject()
                jsonReq.put("apiname", "deleteAccount")
                jsonReq.put("tcNo"   , tcNo)
                jsonReq.put("phoneID", phoneID)

                val response = UdpClient.__Send_And_Receive(context, jsonReq.toString())

                if (response.success && response.jsonAnswer != null) {

                    val json = response.jsonAnswer

                    if (json.optInt("result") == 0) {
                        return@withContext true
                    }
                }

                false

            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }
    }
    //---------------------------------------------------------------------------
    fun _Get_Card_Data(context: Context): ByteArray
    {
        if (CardReadedFromDisk)
        {
            Log.d("CARD_STATE", "Apdudata returned from memory")
            RemainSecond = _Remain_Second()
            return ApduData
        }

        val file = File(context.filesDir, "carddata.bin")
        val phoneID = _Get_Phone_ID_ByteArray(context)
        CardReadedFromDisk = true

        if (file.exists())
        {
            ApduData = file.readBytes()
            RemainSecond = _Remain_Second()

            Log.d("CARD_STATE", "Card readed")

            if (ApduData.size == 120)
            {
                val phoneIdInFile = ApduData.copyOfRange(112, 120)

                if (phoneIdInFile.contentEquals(phoneID))
                {
                    Log.d("CARD_STATE", "Apdudata returned from disk")
                    return ApduData
                }
                Log.d("CARD_STATE", "Invalid phoneID")
            }
        }


        // create default
        for (i in 0 until 112) ApduData[i] = 0.toByte()
        System.arraycopy(phoneID, 0, ApduData, 112, 8)
        file.writeBytes(ApduData)
        Log.d("CARD_STATE", "Apdudata returned as default")
        return ApduData
    }
    //---------------------------------------------------------------------------
    fun _Write_To_Disk(context: Context, data: ByteArray): Byte
    {
        try
        {
            if (data.size != 112) return 0
            val file = File(context.filesDir, "carddata.bin")

            if (!file.exists()) return 0
            val fileSize = file.length().toInt()
            if (fileSize != 120) return 0

            RandomAccessFile(file, "rw").use { raf ->
                raf.seek(0)
                raf.write(data, 0, 112)
            }

            System.arraycopy(data, 0, ApduData, 0, 112) // refresh apdu data
            _Remain_Second() // for calculate ValiditySecond

            Log.d("CARD_STATE", "Data writed on disk")
            context.sendBroadcast(Intent("CARD_UPDATED")) // refresh qr

            return 1
        }
        catch (e: Exception)
        {
            e.printStackTrace()
            return 0
        }
    }
    //---------------------------------------------------------------------------
}




