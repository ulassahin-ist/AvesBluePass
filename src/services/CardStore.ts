// src/services/CardStore.ts
// Mirrors Kotlin Util object — card file I/O, remain-second calc, phone ID

import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import { DeviceEventEmitter } from 'react-native';
import { sendAndReceive } from './UdpClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

/*
  carddata.bin layout (120 bytes)
  offset  len   description
  ───────────────────────────────────────────────────
    0      96   main card data (QR payload)
   96       6   encoded timestamp (year-2000,m,d,h,min,s)
  102       4   validitySecond (LE uint32)
  106       6   raw timestamp (year-2000,m,d,h,min,s)
  112       8   phoneID
  ───────────────────────────────────────────────────
*/

const CARD_FILE = `${RNFS.DocumentDirectoryPath}/carddata.bin`;
const CARD_SIZE = 120;
const DATA_SIZE = 112;

// ─── Shared mutable state (mirrors Kotlin @Volatile vars) ─────────────────────
export let apduData        = Buffer.alloc(CARD_SIZE, 0);
export let cardReadFromDisk = false;
export let validitySecond   = 1;
export let cardCode         = 0;
export let remainSecond     = 0;
export let updateInProgress = false;

// ─── Phone ID ─────────────────────────────────────────────────────────────────

export async function getPhoneIdBytes(): Promise<Buffer> {
  const androidId = await DeviceInfo.getUniqueId();
  // Deterministic fold: same algorithm as Kotlin (acc * 31 + char.code)
  let value = BigInt(0);
  for (const ch of androidId) {
    value = value * BigInt(31) + BigInt(ch.charCodeAt(0));
    value = BigInt.asUintN(64, value); // keep 64-bit
  }
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    buf[7 - i] = Number(value & BigInt(0xff));
    value >>= BigInt(8);
  }
  return buf;
}

export async function getPhoneIdHex(): Promise<string> {
  const b = await getPhoneIdBytes();
  return b.toString('hex').toUpperCase();
}

// ─── Remain-second calculation ─────────────────────────────────────────────────

export function calcRemainSecond(): number {
  try {
    cardCode =
      (apduData[0] & 0xff) |
      ((apduData[1] & 0xff) << 8) |
      ((apduData[2] & 0xff) << 16) |
      ((apduData[3] & 0xff) << 24);

    validitySecond =
      (apduData[102] & 0xff) |
      ((apduData[103] & 0xff) << 8) |
      ((apduData[104] & 0xff) << 16) |
      ((apduData[105] & 0xff) << 24);

    if (validitySecond === 0) {
      remainSecond = 0xffffffff; // permanent card
      return remainSecond;
    }

    const year   = (apduData[106] & 0xff) + 2000;
    const month  = (apduData[107] & 0xff) - 1; // JS months are 0-based
    const day    =  apduData[108] & 0xff;
    const hour   =  apduData[109] & 0xff;
    const minute =  apduData[110] & 0xff;
    const second =  apduData[111] & 0xff;

    const cardEpoch = Math.floor(new Date(year, month, day, hour, minute, second).getTime() / 1000);
    const nowEpoch  = Math.floor(Date.now() / 1000);
    const remain    = validitySecond - (nowEpoch - cardEpoch);

    remainSecond = remain <= 0 ? 0 : remain;
    return remainSecond;
  } catch {
    remainSecond = 0;
    return 0;
  }
}

// ─── Read card from disk ───────────────────────────────────────────────────────

export async function getCardData(): Promise<Buffer> {
  if (cardReadFromDisk) {
    calcRemainSecond();
    return apduData;
  }

  const phoneId = await getPhoneIdBytes();
  cardReadFromDisk = true;

  const exists = await RNFS.exists(CARD_FILE);
  if (exists) {
    const b64  = await RNFS.readFile(CARD_FILE, 'base64');
    const data = Buffer.from(b64, 'base64');

    apduData = Buffer.alloc(CARD_SIZE, 0);
    data.copy(apduData, 0, 0, Math.min(data.length, CARD_SIZE));
    calcRemainSecond();

    if (data.length === CARD_SIZE) {
      const filePhoneId = data.slice(112, 120);
      if (filePhoneId.equals(phoneId)) {
        return apduData;
      }
      console.log('[CardStore] Phone ID mismatch — resetting');
    }
  }

  // Default blank card
  apduData = Buffer.alloc(CARD_SIZE, 0);
  phoneId.copy(apduData, 112, 0, 8);
  await RNFS.writeFile(CARD_FILE, apduData.toString('base64'), 'base64');
  calcRemainSecond();
  return apduData;
}

// ─── Write 112 bytes to disk ───────────────────────────────────────────────────

export async function writeToDisk(data: Buffer): Promise<boolean> {
  try {
    if (data.length !== DATA_SIZE) return false;
    const exists = await RNFS.exists(CARD_FILE);
    if (!exists) return false;

    // Read existing file, overwrite first 112 bytes, preserve phoneId (112-120)
    const b64      = await RNFS.readFile(CARD_FILE, 'base64');
    const existing = Buffer.from(b64, 'base64');
    if (existing.length !== CARD_SIZE) return false;

    data.copy(existing, 0, 0, DATA_SIZE);
    await RNFS.writeFile(CARD_FILE, existing.toString('base64'), 'base64');

    // Refresh in-memory
    data.copy(apduData, 0, 0, DATA_SIZE);
    calcRemainSecond();

    DeviceEventEmitter.emit('CARD_UPDATED');
    return true;
  } catch (e) {
    console.error('[CardStore] writeToDisk', e);
    return false;
  }
}

// ─── Fetch new card data from server ──────────────────────────────────────────

export async function fetchFromServer(): Promise<boolean> {
  if (updateInProgress) return false;
  updateInProgress = true;
  DeviceEventEmitter.emit('RENEW_CHANGED', { enabled: false });

  try {
    const username = (await AsyncStorage.getItem('e_mail'))  ?? '';
    const password = (await AsyncStorage.getItem('pword'))   ?? '';
    const phoneID  = await getPhoneIdHex();

    const req = JSON.stringify({ apiname: 'getCardData', username, password, phoneID });
    const res = await sendAndReceive(req);

    if (!res.success || !res.jsonAnswer) {
      return false;
    }

    const b64     = res.jsonAnswer.cardData as string;
    if (!b64) return false;

    const newData = Buffer.from(b64, 'base64');
    if (newData.length === DATA_SIZE) {
      await writeToDisk(newData);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[CardStore] fetchFromServer', e);
    return false;
  } finally {
    updateInProgress = false;
    DeviceEventEmitter.emit('RENEW_CHANGED', { enabled: true });
  }
}

// ─── User profile helpers ──────────────────────────────────────────────────────

export async function getBluePassInfo(tcNo: string): Promise<boolean> {
  try {
    const req = JSON.stringify({ apiname: 'getBluePassInf', tcNo });
    const res = await sendAndReceive(req);

    if (res.success && res.jsonAnswer && (res.jsonAnswer.result as number) === 0) {
      const fullName   = String(res.jsonAnswer.fullName ?? '');
      const hasPicture = Boolean(res.jsonAnswer.hasPicture);

      await AsyncStorage.setItem('fullName', fullName);

      if (hasPicture) {
        await downloadPhoto(tcNo);
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function downloadPhoto(tcNo: string): Promise<void> {
  try {
    const serverIp  = (await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10';
    const photoPath = `${RNFS.DocumentDirectoryPath}/photo.jpg`;

    // Remove old photos
    const files = await RNFS.readDir(RNFS.DocumentDirectoryPath);
    for (const f of files) {
      if (f.name.startsWith('photo.')) await RNFS.unlink(f.path);
    }

    await RNFS.downloadFile({
      fromUrl: `http://${serverIp}:8080/photo?tcNo=${tcNo}`,
      toFile:  photoPath,
      connectionTimeout: 4000,
      readTimeout:       4000,
    }).promise;
  } catch (e) {
    console.error('[CardStore] downloadPhoto', e);
  }
}

export async function deleteUserAccount(tcNo: string, phoneID: string): Promise<boolean> {
  try {
    const req = JSON.stringify({ apiname: 'deleteAccount', tcNo, phoneID });
    const res = await sendAndReceive(req);
    return res.success && (res.jsonAnswer?.result as number) === 0;
  } catch {
    return false;
  }
}
