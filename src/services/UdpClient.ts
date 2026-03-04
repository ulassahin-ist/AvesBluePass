// src/services/UdpClient.ts
// Mirrors the Kotlin UdpClient — UDP JSON send/receive with error text lookup

import dgram from 'react-native-udp';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ServerResponse {
  success: boolean;
  errorMessage?: string;
  jsonAnswer?: Record<string, unknown>;
}

// ─── LOW LEVEL ────────────────────────────────────────────────────────────────

async function getServerAddress(): Promise<{ip: string; port: number}> {
  const ip = (await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10';
  const port = parseInt(
    (await AsyncStorage.getItem('server_port')) ?? '9000',
    10,
  );
  return {ip, port};
}

function sendAndReceiveSub(jsonRequest: string): Promise<ServerResponse> {
  return new Promise(async resolve => {
    const {ip, port} = await getServerAddress();
    const socket = dgram.createSocket({type: 'udp4'});

    const timer = setTimeout(() => {
      socket.close();
      resolve({success: false, errorMessage: 'Sunucuya erişilemiyor'});
    }, 4000);

    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      socket.close();
      resolve({success: false, errorMessage: err.message ?? 'Bilinmeyen hata'});
    });

    // data arrives as Uint8Array from react-native-udp
    socket.once('message', (data: Uint8Array) => {
      clearTimeout(timer);
      socket.close();
      try {
        const respStr = new TextDecoder('utf-8').decode(data);
        const json = JSON.parse(respStr);
        resolve({success: true, jsonAnswer: json});
      } catch {
        resolve({success: false, errorMessage: 'Geçersiz sunucu cevabı'});
      }
    });

    socket.bind(0, () => {
      // Encode string to Uint8Array — no Buffer needed
      const encoded = new TextEncoder().encode(jsonRequest);
      socket.send(
        encoded,
        0,
        encoded.length,
        port,
        ip,
        (err?: Error | null) => {
          if (err) {
            clearTimeout(timer);
            socket.close();
            resolve({success: false, errorMessage: err.message});
          }
        },
      );
    });
  });
}

// ─── HIGH LEVEL ───────────────────────────────────────────────────────────────

export async function sendAndReceive(
  jsonRequest: string,
): Promise<ServerResponse> {
  const response = await sendAndReceiveSub(jsonRequest);
  if (!response.success) return response;

  const json = response.jsonAnswer;
  if (!json) return {success: false, errorMessage: 'Sunucu cevap vermedi'};

  const result = String(json.result ?? '0');
  if (result === '0') return response;

  // Fetch human-readable error text
  const errorPayload = JSON.stringify({
    apiname: 'getErrorText',
    errorID: result,
  });
  const errorResp = await sendAndReceiveSub(errorPayload);

  const eMsg = errorResp.success
    ? String(
        errorResp.jsonAnswer?.eMsg ?? `Bilinmeyen sunucu hatası (${result})`,
      )
    : `Bilinmeyen sunucu hatası (${result})`;

  return {success: false, errorMessage: eMsg};
}
