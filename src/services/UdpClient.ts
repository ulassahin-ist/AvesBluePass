// src/services/UdpClient.ts
// Mirrors the Kotlin UdpClient — UDP JSON send/receive with error text lookup

import dgram from 'react-native-udp'; // react-native-udp package
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ServerResponse {
  success: boolean;
  errorMessage?: string;
  jsonAnswer?: Record<string, unknown>;
}

// ─── LOW LEVEL ────────────────────────────────────────────────────────────────

async function getServerAddress(): Promise<{ ip: string; port: number }> {
  const ip   = (await AsyncStorage.getItem('server_ip'))   ?? '192.168.1.10';
  const port = parseInt((await AsyncStorage.getItem('server_port')) ?? '9000', 10);
  return { ip, port };
}

function sendAndReceiveSub(jsonRequest: string): Promise<ServerResponse> {
  return new Promise(async (resolve) => {
    const { ip, port } = await getServerAddress();
    const socket = dgram.createSocket({ type: 'udp4' });

    const timer = setTimeout(() => {
      socket.close();
      resolve({ success: false, errorMessage: 'Sunucuya erişilemiyor' });
    }, 4000);

    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ success: false, errorMessage: err.message ?? 'Bilinmeyen hata' });
    });

    socket.once('message', (data: Buffer) => {
      clearTimeout(timer);
      socket.close();
      try {
        const respStr = data.toString('utf8');
        const json = JSON.parse(respStr);
        resolve({ success: true, jsonAnswer: json });
      } catch (e) {
        resolve({ success: false, errorMessage: 'Geçersiz sunucu cevabı' });
      }
    });

    socket.bind(0, () => {
      const buf = Buffer.from(jsonRequest, 'utf8');
      socket.send(buf, 0, buf.length, port, ip, (err?: Error | null) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          resolve({ success: false, errorMessage: err.message });
        }
      });
    });
  });
}

// ─── HIGH LEVEL ───────────────────────────────────────────────────────────────

export async function sendAndReceive(jsonRequest: string): Promise<ServerResponse> {
  const response = await sendAndReceiveSub(jsonRequest);
  if (!response.success) return response;

  const json = response.jsonAnswer;
  if (!json) return { success: false, errorMessage: 'Sunucu cevap vermedi' };

  const result = String(json.result ?? '0');
  if (result === '0') return response;

  // Fetch human-readable error text
  const errorPayload = JSON.stringify({ apiname: 'getErrorText', errorID: result });
  const errorResp    = await sendAndReceiveSub(errorPayload);

  const eMsg = errorResp.success
    ? String((errorResp.jsonAnswer as Record<string, unknown>)?.eMsg ?? `Bilinmeyen sunucu hatası (${result})`)
    : `Bilinmeyen sunucu hatası (${result})`;

  return { success: false, errorMessage: eMsg };
}
