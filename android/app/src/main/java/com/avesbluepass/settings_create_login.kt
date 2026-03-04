package com.aves.hce

import android.os.Bundle
import android.view.View
import android.content.Intent
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import androidx.core.widget.addTextChangedListener
import com.aves.hce.databinding.SettingsCreateLoginBinding

class settings_create_login : AppCompatActivity() {

    private lateinit var binding: SettingsCreateLoginBinding

    private fun _Send_Activation_Input_Control()
    {
        val email = binding.eEmail.text.toString().trim()
        val tcNo = binding.eTcNo.text.toString().trim()

        val isEmailValid = android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()
        val isTcValid = tcNo.length in 8..12

        binding.bSendActivation.isEnabled = isEmailValid && isTcValid
    }

    private fun _Check_Activation_Input_Control()
    {
        val eActivationCode = binding.eActivationCode.text.toString().trim()
        val ePassword = binding.ePassword.text.toString().trim()

        val isActivationValid = eActivationCode.length in 4..6
        val isPasswordValid = ePassword.length in 4..8

        binding.bCheckActivationCode.isEnabled = isActivationValid && isPasswordValid
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        binding = SettingsCreateLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toolbar.setNavigationOnClickListener { finish() }


        val prefs = getSharedPreferences("settings", MODE_PRIVATE)

        // Kayıtlı verileri yükle
        binding.eEmail.setText(prefs.getString("e_mail", ""))
        binding.ePassword.setText(prefs.getString("pword", ""))

        binding.eEmail.setText("")
        binding.eTcNo.setText("")
        binding.bSendActivation.isEnabled = false


        // onclick ------------------------------------------------------------
        binding.bSendActivation.setOnClickListener {
            lifecycleScope.launch {
                binding.bSendActivation.isEnabled = false

                val tcNo  = binding.eTcNo.text.toString()
                val eMail = binding.eEmail.text.toString()

                val json = JSONObject()
                json.put("apiname", "sendMailforLogin")
                json.put("tcNo", tcNo)
                json.put("eMail", eMail)

                val response = UdpClient.__Send_And_Receive(this@settings_create_login, json.toString())

                if (response.success)
                {
                    binding.bSendActivation.isEnabled = false;

                    binding.eEmail.visibility = View.GONE
                    binding.eTcNo.visibility = View.GONE
                    binding.bSendActivation.visibility = View.GONE

                    binding.eActivationCode.visibility = View.VISIBLE
                    binding.ePassword.visibility = View.VISIBLE
                    binding.bCheckActivationCode.visibility = View.VISIBLE

                    binding.eActivationCode.setText("")
                    binding.ePassword.setText("")
                    binding.bCheckActivationCode.isEnabled = false

                    Toast.makeText(this@settings_create_login, "Doğrulama kodu e-mail adresinize gönderildi", Toast.LENGTH_SHORT).show()
                }
                else
                {
                    Toast.makeText(this@settings_create_login, response.errorMessage, Toast.LENGTH_SHORT).show()
                }

                binding.bSendActivation.isEnabled = true
            }
        }
        // onclick ------------------------------------------------------------
        binding.eEmail.addTextChangedListener  {

            _Send_Activation_Input_Control()
        }
        // onclick ------------------------------------------------------------
        binding.eTcNo.addTextChangedListener  {

            _Send_Activation_Input_Control()
        }
        // onclick ------------------------------------------------------------
        binding.eActivationCode.addTextChangedListener  {

            _Check_Activation_Input_Control()
        }
        // onclick ------------------------------------------------------------
        binding.ePassword.addTextChangedListener  {

            _Check_Activation_Input_Control()
        }
        // onclick ------------------------------------------------------------
        binding.bCheckActivationCode.setOnClickListener {
            lifecycleScope.launch {
                binding.bCheckActivationCode.isEnabled = false

                val tcNo     = binding.eTcNo.text.toString()
                val eMail    = binding.eEmail.text.toString()
                val password = binding.ePassword.text.toString()
                val activationCode = binding.eActivationCode.text.toString()
                val phoneID = Util._Get_Phone_ID_HexStr(this@settings_create_login)

                val json = JSONObject()
                json.put("apiname", "verifyEmail")
                json.put("tcNo", tcNo)
                json.put("password", password)
                json.put("phoneID", phoneID)
                json.put("activationCode", activationCode)
                json.put("eMail", eMail)

                val response = UdpClient.__Send_And_Receive(this@settings_create_login, json.toString())

                if (response.success)
                {
                    prefs.edit()
                        .putString("tcNo", tcNo)
                        .putString("e_mail", eMail)
                        .putString("pword", password)
                    .apply()



                    // kart bilgisini al
                    Util.__GET_FROM_SERVER(this@settings_create_login, lifecycleScope)


                    lifecycleScope.launch {
                        val success = Util._Get_BluePass_Inf(this@settings_create_login, tcNo)

                        if(success)
                        {
                            Toast.makeText(
                                this@settings_create_login,
                                "Kayıt işlemi başarılı bir şekilde tamamlandı",
                                Toast.LENGTH_SHORT
                            ).show()

                            val intent = Intent(this@settings_create_login, main_activity::class.java)
                            intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP
                            startActivity(intent)
                            finish()
                        }
                    }
                }
                else
                {
                    Toast.makeText(this@settings_create_login, response.errorMessage, Toast.LENGTH_SHORT).show()
                }

                binding.bCheckActivationCode.isEnabled = true
            }
        }
        //---------------------------------------------------------------------------

        binding.toolbar.setNavigationOnClickListener { onBackPressedDispatcher.onBackPressed() }
    }
}

