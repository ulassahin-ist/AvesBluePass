package com.aves.hce

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import androidx.core.widget.doAfterTextChanged
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import android.widget.ArrayAdapter
import com.aves.hce.databinding.SettingsMainBinding

class settings_main : AppCompatActivity() {

    private lateinit var binding: SettingsMainBinding
    private var ServerConnected = false

    fun _Enable_Control()
    {
        if (ServerConnected)
        {
            binding.btnConnectServer.visibility = View.GONE


            val prefs = this.getSharedPreferences("settings", Context.MODE_PRIVATE)
            val tcNo = prefs.getString("tcNo", "") ?: ""

            if (tcNo.isEmpty())
            {
                binding.bCreateLoginPar.visibility = View.VISIBLE
                binding.bUpdateUserInfo.visibility = View.GONE
                binding.bDeleteAccount.visibility = View.GONE
            }
            else
            {
                binding.bCreateLoginPar.visibility = View.GONE
                binding.bUpdateUserInfo.visibility = View.VISIBLE
                binding.bDeleteAccount.visibility = View.VISIBLE
            }
        }
        else
        {
            binding.btnConnectServer.visibility = View.VISIBLE

            binding.bCreateLoginPar.visibility = View.GONE
            binding.bUpdateUserInfo.visibility = View.GONE
            binding.bDeleteAccount.visibility = View.GONE
        }
    }
    //---------------------------------------------------------------------------
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        binding = SettingsMainBinding.inflate(layoutInflater)
        setContentView(binding.root)


        binding.toolbar.setNavigationOnClickListener { finish() }

        val prefs = getSharedPreferences("settings", MODE_PRIVATE)
          // Kayıtlı verileri yükle
          binding.etServerIp.setText(prefs.getString("server_ip", "192.168.1.10"))
          binding.etServerPort.setText(prefs.getInt("server_port", 9000).toString())

        // onclick ------------------------------------------------------------
        binding.bCreateLoginPar.setOnClickListener {
            val intent = Intent(this@settings_main, settings_create_login::class.java)
            startActivity(intent)
        }
        // onclick ------------------------------------------------------------
        binding.bUpdateUserInfo.setOnClickListener {

            val prefs = this.getSharedPreferences("settings", Context.MODE_PRIVATE)
              val tcNo = prefs.getString("tcNo", "1234") ?: "1234"

            lifecycleScope.launch {
                val success = Util._Get_BluePass_Inf(this@settings_main, tcNo)

                if(success) {
                    Toast.makeText(
                        this@settings_main,
                        "Kişisel bilgileriniz güncellendi",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
        // onclick ------------------------------------------------------------
        binding.bDeleteAccount.setOnClickListener {

                MaterialAlertDialogBuilder(this)
                    .setTitle("Dikkat")
                    .setMessage("Hesabınız silinecek. İşleme devam etmek istiyor musunuz?")
                    .setCancelable(false)
                    .setPositiveButton("Evet") { _, _ ->

                        val prefs = this.getSharedPreferences("settings", Context.MODE_PRIVATE)
                          val tcNo = prefs.getString("tcNo", "1234") ?: "1234"
                          val phoneID = Util._Get_Phone_ID_HexStr(this@settings_main)

                        lifecycleScope.launch {
                            val success = Util._Delete_User_Account(this@settings_main, tcNo, phoneID)

                            if(success)
                            {
                                deleteFile("carddata.bin")
                                deleteSharedPreferences("settings")
                                deleteSharedPreferences("app_prefs")
                                filesDir.listFiles()?.forEach { it.delete() }

                                Toast.makeText(
                                    this@settings_main,
                                    "Hesabınız silindi",
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        }
                    }
                    .setNegativeButton("Hayır") { dialog, _ ->
                        dialog.dismiss()
                    }
                    .show()
        }





        fun _Connect_To_Server() {
             val portText = binding.etServerPort.text.toString()
             val portInt = portText.toIntOrNull() ?: 9000

             val prefs = this.getSharedPreferences("settings", Context.MODE_PRIVATE)
             prefs.edit()
                 .putString("server_ip", binding.etServerIp.text.toString())
                 .putInt("server_port", portInt)
                 .apply()


             lifecycleScope.launch {
                binding.btnConnectServer.isEnabled = false

                val json = JSONObject().apply {
                    put("apiname", "test")
                }

                val response = UdpClient.__Send_And_Receive(this@settings_main, json.toString())

                if (response.success)
                {
                    ServerConnected = true;
                    Toast.makeText(this@settings_main, "Sunucuya bağlanıldı", Toast.LENGTH_SHORT).show()
                }
                else
                {
                    ServerConnected = false
                    Toast.makeText(this@settings_main, response.errorMessage, Toast.LENGTH_SHORT).show()
                }

                 _Enable_Control()

                binding.btnConnectServer.isEnabled = true
            }
        }





        binding.etServerIp.doAfterTextChanged { text ->
            ServerConnected = false;
            _Enable_Control()
        }

        binding.etServerPort.doAfterTextChanged { text ->
            ServerConnected = false;
            _Enable_Control()
        }


        binding.btnConnectServer.setOnClickListener {
            _Connect_To_Server()
        }

        binding.spQrLevel.setOnItemClickListener { _, _, position, _ ->

            val selectedLevel = binding.spQrLevel.adapter.getItem(position).toString()

            val prefs = getSharedPreferences("settings", Context.MODE_PRIVATE)
            prefs.edit()
                .putString("qr_quality", selectedLevel)
                .apply()
        }


        // load from file

        // qr settings
        val levels = listOf("L", "M", "Q", "H")
        val adapter = ArrayAdapter(
            this,
            android.R.layout.simple_dropdown_item_1line,
            levels
        )
        binding.spQrLevel.setAdapter(adapter)


        val qrQuality = prefs.getString("qr_quality", "L") ?: "L"
        binding.spQrLevel.setText(qrQuality, false)

        _Connect_To_Server()
    }
    //---------------------------------------------------------------------------
    override fun onResume() {
        super.onResume()
        _Enable_Control()
    }
    //---------------------------------------------------------------------------
}


