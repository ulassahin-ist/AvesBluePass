package com.aves.hce

import android.app.*
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.lifecycleScope
import java.util.*
import kotlinx.coroutines.*

class _ble_service : Service()
{
    //---------------------------------------------------------------------------
    companion object {
        private const val TAG = "CARD_STATE"
        private const val CHANNEL_ID = "BLE_SERVICE_CHANNEL"

        val SERVICE_UUID: UUID =
            UUID.fromString("12345678-1234-1234-1234-1234567890ab")

        val CHAR_UUID: UUID =
            UUID.fromString("ab907856-3412-3412-3412-341278563412")

        var AdvertisingMessage: String = ""
    }
    //---------------------------------------------------------------------------
    private val serviceScope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO
    )


    private enum class ReaderState {
        CONNECTED,
        DISCONNECTED
    }

    private enum class AdvState {
        ADVERTISING,
        STOPPED
    }

    private var ReaderStatus = ReaderState.DISCONNECTED
    private var AdvStatus = AdvState.STOPPED


    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null

    private val bleHandler = Handler(Looper.getMainLooper())

    private var currentStatus: String = ""
    //---------------------------------------------------------------------------
    private fun __SendBleStatusMessage(message: String?)
    {
        if (Util.BleActive == 1)
        {
            var str: String = ""
            if (AdvStatus == AdvState.ADVERTISING) str = "BLE yayında"
                                              else str = "BLE yayında değil"

            val newMessage = message ?: ""

            if (newMessage != "") str += ", "
            str += newMessage

            if (currentStatus == str) {
                Log.d(TAG, "Aynı mesaj, atlanıyor: $str")
                return
            }

            //Log.d(TAG, "'$str'")
            currentStatus = str
            AdvertisingMessage = str
        }
        else
        {
            AdvertisingMessage = ""
        }

        val intent = Intent("LOCAL_BLE_STATUS_UPDATE")
        intent.putExtra("EXTRA_MESSAGE", AdvertisingMessage)
        sendBroadcast(intent)
    }
    //---------------------------------------------------------------------------
    private val btReceiver = object : BroadcastReceiver()
    {
        override fun onReceive(context: Context?, intent: Intent?)
        {
            if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return

            val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)

            Log.d(TAG, "ble satate changed > new state e: $state")

            bleHandler.post {
                when (state)
                {
                    BluetoothAdapter.STATE_OFF -> {
                        Log.d(TAG, "Bluetooth OFF -> reset")
                        stopAdvertising()
                        closeGatt()
                        __SendBleStatusMessage("") //Bluetooth Kapalı
                    }

                    BluetoothAdapter.STATE_ON -> {
                        Log.d(TAG, "Bluetooth ON -> GATT yeniden kuruluyor")
                        setupGattServer()
                    }
                }
            }
        }
    }
    //---------------------------------------------------------------------------
    override fun onCreate()
    {
        super.onCreate()

        Log.d(TAG, "on create")

        startMyForegroundService()

        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager

        bluetoothAdapter = bluetoothManager?.adapter

        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        registerReceiver(btReceiver, filter)

        if (bluetoothAdapter?.isEnabled == true)
        {
            setupGattServer()
        }
        else
        {
            __SendBleStatusMessage("") // Bluetooth kapalı
        }
    }
    //---------------------------------------------------------------------------
    override fun onDestroy()
    {
        Log.d(TAG, "********** onDestroy **********")

        unregisterReceiver(btReceiver)

        stopAdvertising()
        closeGatt()

        serviceScope.cancel()   // leak önlemek için

        super.onDestroy()
    }
    //---------------------------------------------------------------------------
    override fun onBind(intent: Intent?): IBinder? = null
    //---------------------------------------------------------------------------
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int
    {
        Log.d(TAG, "onStartCommand")
        return START_STICKY
    }
    //---------------------------------------------------------------------------
    private fun setupGattServer()
    {
        Log.d(TAG, "setup gatt server")

        closeGatt()

        gattServer = bluetoothManager?.openGattServer(this, gattServerCallback)

        val service = BluetoothGattService(
            SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        )

        val characteristic = BluetoothGattCharacteristic(
            CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_READ or
                       BluetoothGattCharacteristic.PROPERTY_WRITE,
                       BluetoothGattCharacteristic.PERMISSION_READ or
                       BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        service.addCharacteristic(characteristic)
        gattServer?.addService(service)
    }
    //---------------------------------------------------------------------------
    private fun closeGatt()
    {
        try
        {
            gattServer?.clearServices()
            gattServer?.close()
        }
        catch (e: Exception)
        {
            Log.e(TAG, "closeGatt hata: ${e.message}")
        }

        gattServer = null
    }
    //---------------------------------------------------------------------------
    private fun startAdvertising()
    {
        Log.d(TAG, "start advertising")

        if (AdvStatus == AdvState.ADVERTISING)
        {
            Log.d(TAG, "start advertising")
            return
        }

        if (bluetoothAdapter?.isEnabled != true)
        {
            __SendBleStatusMessage("") // Bluetooth kapalı
            return
        }

        val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: return

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()

        val data = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        advertiser.startAdvertising(settings, data, advertiseCallback)

        AdvStatus = AdvState.ADVERTISING // ok
    }
    //---------------------------------------------------------------------------
    private fun stopAdvertising()
    {
        Log.d(TAG, "stop advertising")

        try
        {
            bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        }
        catch (e: Exception)
        {
            Log.e(TAG, "stop advertising error: ${e.message}")
        }

        AdvStatus = AdvState.STOPPED // ok
    }
    //---------------------------------------------------------------------------
    private val gattServerCallback =
        object : BluetoothGattServerCallback()
        {
            /* ------ service addded ------- */
            override fun onServiceAdded(status: Int, service: BluetoothGattService) {

                Log.d(TAG, "********** onServiceAdded **********")
                Log.d(TAG, "status: $status")

                if (status == BluetoothGatt.GATT_SUCCESS) {
                    startAdvertising()
                }
            }


            /* ----- connection state ------ */
            override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int)
            {
                var msg: String = ""
                bleHandler.post {
                    when (newState)
                    {
                        BluetoothProfile.STATE_CONNECTED -> {
                            msg = "Okuyucu bağlandı"
                            ReaderStatus = ReaderState.CONNECTED // ok
                            //stopAdvertising()
                            __SendBleStatusMessage(msg)
                        }

                        BluetoothProfile.STATE_DISCONNECTED -> {
                            msg = "Okuyucu bağlantıyı kesti"
                            ReaderStatus = ReaderState.DISCONNECTED // ok
                            __SendBleStatusMessage(msg)
                            //startAdvertising()
                        }
                    }
                }

                Log.d(TAG, "newState: $newState  status: $status " + msg)
            }



            /* -------- READ BINARY -------- */
            override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic)
            {
                Log.d("CARD_STATE", "BLE read")

                val apduData = Util._Get_Card_Data(this@_ble_service)

                if (Util.RemainSecond == 0u)
                {
                    Log.d("CARD_STATE", "BLE read request. Expire validy")

                    Util.__GET_FROM_SERVER(this@_ble_service, serviceScope)

                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset,null)
                    return
                }

                if (offset >= apduData.size)
                {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset,null)
                    return
                }

                val dataToSend = apduData.copyOfRange(0, minOf(102, apduData.size))

                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS,0,dataToSend)
            }



            /* -------- WRITE BINARY -------- */
            override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
                                                      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray)
            {
                Log.d("CARD_STATE", "BLE write")

                if (value.size != 112)
                {
                    if (responseNeeded) gattServer?.sendResponse(device, requestId, 0x67, offset, null)
                    return
                }

                val writeResult = Util._Write_To_Disk(this@_ble_service, value)

                if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, byteArrayOf(writeResult))
            }
        }
    //---------------------------------------------------------------------------
    private val advertiseCallback =
        object : AdvertiseCallback()
        {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings)
            {
                Log.d(TAG, "onStartSuccess")
                AdvStatus = AdvState.ADVERTISING // ok
                __SendBleStatusMessage("")
            }

            override fun onStartFailure(errorCode: Int) {
                Log.d(TAG, "onStartFailure errorCode: $errorCode")
                AdvStatus = AdvState.STOPPED // ok
                __SendBleStatusMessage("Advertising hata: $errorCode")
            }
        }
    //---------------------------------------------------------------------------
    private fun startMyForegroundService()
    {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        {
            val channel = NotificationChannel(CHANNEL_ID, "BLE Service", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        val notification =
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("AVES BluePass")
                .setContentText("BLE active")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
        {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        }
        else
        {
            startForeground(1, notification)
        }
    }
}