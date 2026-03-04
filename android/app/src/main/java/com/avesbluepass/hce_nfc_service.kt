package com.aves.hce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel


class _hce_nfc_service : HostApduService()
{
    /* ---- RAM BUFFER (ATOMIC WRITE İÇİN) ---- */
    private var TempBuffer = ByteArray(112)

    //---------------------------------------------------------------------------
    companion object
    {
        private val AID           = byteArrayOf( 0xA9.toByte(), 0x47.toByte(), 0x16.toByte(), 0x84.toByte(), 0x77.toByte(), 0x22.toByte(), 0x49.toByte() )
        private val SELECT_PREFIX = byteArrayOf( 0x00.toByte(), 0xA4.toByte(), 0x04.toByte(), 0x00.toByte() )
    }
    //---------------------------------------------------------------------------
    private val serviceScope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO
    )
    //---------------------------------------------------------------------------
    override fun onDestroy()
    {
        serviceScope.cancel()   // leak önlemek için
        super.onDestroy()
    }
    //---------------------------------------------------------------------------
    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray
    {
        var writeResult: Byte

        if (commandApdu.size < 4) return byteArrayOf( 0x6F.toByte(), 0x00.toByte() );



        /* -------- SELECT AID -------- */
        if (commandApdu.size >= 5 && commandApdu.take(4).toByteArray().contentEquals(SELECT_PREFIX) )
        { Log.d("AVES_HCE", "APDU SELECT AID")
            val aidLen = commandApdu[4].toInt() and 0xFF
            if (commandApdu.size < 5 + aidLen) byteArrayOf( 0x6A.toByte(), 0x82.toByte() );

            val aid = commandApdu.copyOfRange(5, 5 + aidLen)
            return if (aid.contentEquals(AID))
            {
                return byteArrayOf( 0x90.toByte(), 0x00.toByte() )
            }
            else
            {
                return byteArrayOf( 0x6A.toByte(), 0x82.toByte() )
            }
        }



        val cla = commandApdu[0].toInt() and 0xFF
        val ins = commandApdu[1].toInt() and 0xFF



        /* -------- READ BINARY -------- */
        if (cla == 0x00 && ins == 0xB0 && commandApdu.size >= 5)
        {  Log.d("CARD_STATE", "NFC read")

            var offset = ((commandApdu[2].toInt() and 0xFF) shl 8) or (commandApdu[3].toInt() and 0xFF)

            var len = commandApdu[4].toInt() and 0xFF
            if (len == 0) len = 96

            if (offset + len > TempBuffer.size) return byteArrayOf( 0x6B.toByte(), 0x00.toByte() );

            // en başta oku
            if (offset == 0) TempBuffer = Util._Get_Card_Data(this)

            if ((Util.RemainSecond == 0u) && (Util.CardCode != 0) ) // ilk kurulumda kesmesin
            {
                Log.d("CARD_STATE", "Expire validity second")
                Util.__GET_FROM_SERVER(this@_hce_nfc_service, serviceScope)
                return byteArrayOf( 0x6B.toByte(), 0x00.toByte() );
            }

            val resp = ByteArray(len + 2)
            System.arraycopy(TempBuffer, offset, resp, 0, len)
            resp[len] = 0x90.toByte()
            resp[len + 1] = 0x00.toByte()

            return resp
        }





        /* -------- WRITE BINARY -------- */
        if (cla == 0x00 && ins == 0xD6)
        {   Log.d("CARD_STATE", "NFC write")

            if (commandApdu.size < 6) return byteArrayOf( 0x67.toByte(), 0x00.toByte() );

            val offset = ((commandApdu[2].toInt() and 0xFF) shl 8) or  (commandApdu[3].toInt() and 0xFF)
            val len = commandApdu[4].toInt() and 0xFF

            if (commandApdu.size < 6 + len) return byteArrayOf( 0x6A.toByte(), 0x80.toByte() );
            if (offset + len > 112) return byteArrayOf( 0x6B.toByte(), 0x00.toByte() );

            val bitPars = commandApdu[5].toInt() and 0xFF
            //val readFromFile = (bitPars and 0x01) != 0  gerek kalmadı
            val writeToDisk  = (bitPars and 0x02) != 0

            System.arraycopy(commandApdu, 6, TempBuffer, offset, len)

            if ( writeToDisk )
            {
                writeResult = Util._Write_To_Disk(this, TempBuffer)
                if (writeResult.toInt() == 1) Log.d("CARD_STATE", "NFC write success")
                                         else Log.d("CARD_STATE", "NFC write error")
            }
            else writeResult = 0

            return byteArrayOf( writeResult, 0x90.toByte(), 0x00.toByte() )
        }

        return byteArrayOf( 0x6D.toByte(), 0x00.toByte() );
    }
    //---------------------------------------------------------------------------
    override fun onDeactivated(reason: Int)
    {

    }
}
