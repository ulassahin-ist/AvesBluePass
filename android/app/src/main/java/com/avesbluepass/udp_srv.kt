package com.aves.hce

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException



data class ServerResponse(
    val success: Boolean,
    val errorMessage: String? = null,
    val jsonAnswer: JSONObject? = null
)

object UdpClient
{
    // ---------------- LOW LEVEL ----------------


    suspend fun __Send_And_Receive_Sub(context: Context, jsonRequest: String): ServerResponse = withContext(Dispatchers.IO)
    {
        try
        {
            DatagramSocket().use { socket ->

                val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
                  val serverIp = prefs.getString("server_ip", "192.168.1.10") ?: "192.168.1.10"
                  val serverPort = prefs.getInt("server_port", 9000)
                  //val portInt = portText.toIntOrNull() ?: 9000

                socket.soTimeout = 4000

                val data = jsonRequest.toByteArray(Charsets.UTF_8)
                val packet = DatagramPacket(data, data.size, InetAddress.getByName(serverIp), serverPort)

                socket.send(packet)

                val buffer = ByteArray(256000)
                val responsePacket = DatagramPacket(buffer, buffer.size)




                socket.receive(responsePacket)
                val raw = responsePacket.data.copyOf(responsePacket.length)

                println(raw.joinToString(" ") { "%02X".format(it) })




                val respStr = String(responsePacket.data,0, responsePacket.length, Charsets.UTF_8)
                val json = JSONObject(respStr)

                ServerResponse(success = true, jsonAnswer = json)
            }

        } catch (e: SocketTimeoutException) {
            ServerResponse(false, "Sunucuya erişilemiyor")
        } catch (e: Exception) {
            ServerResponse(false, e.localizedMessage ?: "Bilinmeyen hata")
        }
    }


    // ---------------- HIGH LEVEL ----------------
    suspend fun __Send_And_Receive(context: Context, jsonRequest: String): ServerResponse
    {
        val response = __Send_And_Receive_Sub(context, jsonRequest)

        if (!response.success) return response

        val json = response.jsonAnswer
            ?: return ServerResponse(false, "Sunucu cecap vermedi")

        val result = json.optString("result", "")

        if (result == "0") return response

        // get error text
        val errorJson = JSONObject().apply {
            put("apiname", "getErrorText")
            put("errorID", result)
        }

        val errorRequest = errorJson.toString()

        val errorResponse = __Send_And_Receive_Sub(context, errorRequest)

        val eMsg =
            if (errorResponse.success)
                errorResponse.jsonAnswer
                    ?.optString("eMsg", "Bilinmeyen sunucu hatası ($result)")
            else
                "Bilinmeyen sunucu hatası ($result)"

        return ServerResponse(false, eMsg)
    }
}
