// src/services/UdpClient.ts
// Mirrors the Kotlin UdpClient — UDP JSON send/receive with error text lookup

import dgram from 'react-native-udp';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ServerResponse {
  success: boolean;
  errorMessage?: string;
  jsonAnswer?: Record<string, unknown>;
}

export async function getServerAddress(): Promise<{ip: string; port: number}> {
  const ip = (await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10';
  const port = parseInt(
    (await AsyncStorage.getItem('server_port')) ?? '9000',
    10,
  );
  return {ip, port};
}

// ── Manual UTF-8 decoder (no TextDecoder — not available in Hermes) ───────────
// react-native-udp delivers data as a Latin-1 string where charCode(i) = raw byte.
// We extract the raw bytes then decode UTF-8 sequences manually so Turkish
// characters (ş ğ ı ç ö ü İ Ğ Ş etc.) render correctly.
function decodeUdpData(data: string | Uint8Array): string {
  // 1. Get raw bytes
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      bytes[i] = data.charCodeAt(i) & 0xff;
    }
  } else {
    bytes = data;
  }

  // 2. Manual UTF-8 decode (handles 1, 2 and 3 byte sequences — enough for all Turkish chars)
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x00) {
      i++;
      continue;
    } // skip null bytes
    if (b < 0x80) {
      // 1-byte (ASCII)
      str += String.fromCharCode(b);
      i += 1;
    } else if ((b & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      // 2-byte
      const cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      str += String.fromCharCode(cp);
      i += 2;
    } else if ((b & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      // 3-byte
      const cp =
        ((b & 0x0f) << 12) |
        ((bytes[i + 1] & 0x3f) << 6) |
        (bytes[i + 2] & 0x3f);
      str += String.fromCharCode(cp);
      i += 3;
    } else if ((b & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      // 4-byte (emoji etc.)
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      // encode as surrogate pair for JS
      const sc = cp - 0x10000;
      str += String.fromCharCode(0xd800 + (sc >> 10), 0xdc00 + (sc & 0x3ff));
      i += 4;
    } else {
      i += 1; // skip invalid byte
    }
  }

  // Strip BOM if present
  if (str.charCodeAt(0) === 0xfeff) {
    str = str.slice(1);
  }
  return str.trim();
}

// ─── LOW LEVEL ────────────────────────────────────────────────────────────────

function sendAndReceiveSub(
  jsonRequest: string,
  ip: string,
  port: number,
): Promise<ServerResponse> {
  return new Promise(resolve => {
    const socket = dgram.createSocket({type: 'udp4'});

    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      resolve({success: false, errorMessage: 'Sunucuya erişilemiyor'});
    }, 4000);

    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve({success: false, errorMessage: err.message ?? 'Bilinmeyen hata'});
    });

    socket.once('message', (data: string | Uint8Array) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}

      const respStr = decodeUdpData(data);
      console.log('[UDP] response:', respStr.slice(0, 200));

      try {
        const json = JSON.parse(respStr);
        resolve({success: true, jsonAnswer: json});
      } catch {
        console.log('[UDP] JSON parse failed:', respStr.slice(0, 200));
        resolve({
          success: false,
          errorMessage: `Geçersiz sunucu cevabı: "${respStr.slice(0, 80)}"`,
        });
      }
    });

    socket.bind(0, () => {
      // Encode request as UTF-8 bytes manually (no TextEncoder in older Hermes)
      const str = jsonRequest;
      const buf: number[] = [];
      for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp < 0x80) {
          buf.push(cp);
        } else if (cp < 0x800) {
          buf.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        } else {
          buf.push(
            0xe0 | (cp >> 12),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f),
          );
        }
      }
      const encoded = new Uint8Array(buf);
      console.log('[UDP] sending to', ip, ':', port, '->', jsonRequest);
      socket.send(
        encoded,
        0,
        encoded.length,
        port,
        ip,
        (err?: Error | null) => {
          if (err) {
            clearTimeout(timer);
            try {
              socket.close();
            } catch {}
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
  overrideIp?: string,
  overridePort?: number,
): Promise<ServerResponse> {
  let ip: string;
  let port: number;
  if (overrideIp !== undefined && overridePort !== undefined) {
    ip = overrideIp;
    port = overridePort;
  } else {
    ({ip, port} = await getServerAddress());
  }

  const response = await sendAndReceiveSub(jsonRequest, ip, port);
  if (!response.success) return response;

  const json = response.jsonAnswer;
  if (!json) return {success: false, errorMessage: 'Sunucu cevap vermedi'};

  const result = String(json.result ?? '0');
  if (result === '0') return response;

  const errorPayload = JSON.stringify({
    apiname: 'getErrorText',
    errorID: result,
  });
  const errorResp = await sendAndReceiveSub(errorPayload, ip, port);

  const eMsg = errorResp.success
    ? String(
        errorResp.jsonAnswer?.eMsg ?? `Bilinmeyen sunucu hatası (${result})`,
      )
    : `Bilinmeyen sunucu hatası (${result})`;

  return {success: false, errorMessage: eMsg};
}
