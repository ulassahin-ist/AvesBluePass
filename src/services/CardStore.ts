// src/services/CardStore.ts
// Mirrors Kotlin Util object — card file I/O, remain-second calc, phone ID
// NOTE: No Buffer (Node.js only). Uses Uint8Array + base64 throughout.

import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import {DeviceEventEmitter} from 'react-native';
import {sendAndReceive} from './UdpClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

/*
  carddata.bin layout (120 bytes)
  offset  len   description
  ───────────────────────────────────────────────────
    0      96   main card data (QR payload)
   96       6   encoded timestamp
  102       4   validitySecond (LE uint32)
  106       6   raw timestamp (year-2000,m,d,h,min,s)
  112       8   phoneID
  ───────────────────────────────────────────────────
*/

const CARD_FILE = `${RNFS.DocumentDirectoryPath}/carddata.bin`;
const CARD_SIZE = 120;
const DATA_SIZE = 112;

// ─── Shared mutable state ──────────────────────────────────────────────────────
export let apduData: Uint8Array = new Uint8Array(CARD_SIZE);
export let cardReadFromDisk: boolean = false;
export let validitySecond: number = 1;
export let cardCode: number = 0;
export let remainSecond: number = 0;
export let updateInProgress: boolean = false;

// ─── Uint8Array ↔ base64 helpers (no Buffer needed) ──────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

// ─── Phone ID ─────────────────────────────────────────────────────────────────

export async function getPhoneIdBytes(): Promise<Uint8Array> {
  const androidId = await DeviceInfo.getUniqueId();

  // Same fold algorithm as Kotlin: acc * 31 + char.code, kept as 64-bit
  let value = BigInt(0);
  for (const ch of androidId) {
    value = value * BigInt(31) + BigInt(ch.charCodeAt(0));
    value = BigInt.asUintN(64, value);
  }

  const buf = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    buf[7 - i] = Number(value & BigInt(0xff));
    value >>= BigInt(8);
  }
  return buf;
}

export async function getPhoneIdHex(): Promise<string> {
  const b = await getPhoneIdBytes();
  return Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
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
      remainSecond = 0xffffffff;
      return remainSecond;
    }

    const year = (apduData[106] & 0xff) + 2000;
    const month = (apduData[107] & 0xff) - 1; // JS months 0-based
    const day = apduData[108] & 0xff;
    const hour = apduData[109] & 0xff;
    const minute = apduData[110] & 0xff;
    const second = apduData[111] & 0xff;

    const cardEpoch = Math.floor(
      new Date(year, month, day, hour, minute, second).getTime() / 1000,
    );
    const nowEpoch = Math.floor(Date.now() / 1000);
    const remain = validitySecond - (nowEpoch - cardEpoch);

    remainSecond = remain <= 0 ? 0 : remain;
    return remainSecond;
  } catch {
    remainSecond = 0;
    return 0;
  }
}

// ─── Read card from disk ───────────────────────────────────────────────────────

export async function getCardData(): Promise<Uint8Array> {
  if (cardReadFromDisk) {
    calcRemainSecond();
    return apduData;
  }

  const phoneId = await getPhoneIdBytes();
  cardReadFromDisk = true;

  const exists = await RNFS.exists(CARD_FILE);
  if (exists) {
    const b64 = await RNFS.readFile(CARD_FILE, 'base64');
    const data = base64ToUint8Array(b64);

    apduData = new Uint8Array(CARD_SIZE);
    apduData.set(data.slice(0, Math.min(data.length, CARD_SIZE)));
    calcRemainSecond();

    if (data.length === CARD_SIZE) {
      const filePhoneId = data.slice(112, 120);
      // Compare phone IDs
      const match = filePhoneId.every((v, i) => v === phoneId[i]);
      if (match) return apduData;
      console.log('[CardStore] Phone ID mismatch — resetting');
    }
  }

  // Default blank card with phoneId
  apduData = new Uint8Array(CARD_SIZE);
  apduData.set(phoneId, 112);
  await RNFS.writeFile(CARD_FILE, uint8ArrayToBase64(apduData), 'base64');
  calcRemainSecond();
  return apduData;
}

// ─── Write 112 bytes to disk ───────────────────────────────────────────────────

export async function writeToDisk(data: Uint8Array): Promise<boolean> {
  try {
    if (data.length !== DATA_SIZE) return false;
    const exists = await RNFS.exists(CARD_FILE);
    if (!exists) return false;

    const b64 = await RNFS.readFile(CARD_FILE, 'base64');
    const existing = base64ToUint8Array(b64);
    if (existing.length !== CARD_SIZE) return false;

    // Overwrite first 112 bytes, keep phoneId (112-120)
    existing.set(data.slice(0, DATA_SIZE), 0);
    await RNFS.writeFile(CARD_FILE, uint8ArrayToBase64(existing), 'base64');

    // Refresh in-memory
    apduData.set(data.slice(0, DATA_SIZE), 0);
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
  DeviceEventEmitter.emit('RENEW_CHANGED', {enabled: false});

  try {
    const username = (await AsyncStorage.getItem('e_mail')) ?? '';
    const password = (await AsyncStorage.getItem('pword')) ?? '';
    const phoneID = await getPhoneIdHex();

    const req = JSON.stringify({
      apiname: 'getCardData',
      username,
      password,
      phoneID,
    });
    const res = await sendAndReceive(req);

    if (!res.success || !res.jsonAnswer) return false;

    const b64 = res.jsonAnswer.cardData as string;
    if (!b64) return false;

    const newData = base64ToUint8Array(b64);
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
    DeviceEventEmitter.emit('RENEW_CHANGED', {enabled: true});
  }
}

// ─── User profile helpers ──────────────────────────────────────────────────────

export async function getBluePassInfo(tcNo: string): Promise<boolean> {
  try {
    const req = JSON.stringify({apiname: 'getBluePassInf', tcNo});
    const res = await sendAndReceive(req);

    if (
      res.success &&
      res.jsonAnswer &&
      (res.jsonAnswer.result as number) === 0
    ) {
      const fullName = String(res.jsonAnswer.fullName ?? '');
      const hasPicture = Boolean(res.jsonAnswer.hasPicture);

      await AsyncStorage.setItem('fullName', fullName);
      if (hasPicture) await _downloadPhoto(tcNo);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function _downloadPhoto(tcNo: string): Promise<void> {
  try {
    const serverIp =
      (await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10';

    // Remove old photos
    const files = await RNFS.readDir(RNFS.DocumentDirectoryPath);
    for (const f of files) {
      if (f.name.startsWith('photo.')) await RNFS.unlink(f.path);
    }

    await RNFS.downloadFile({
      fromUrl: `http://${serverIp}:8080/photo?tcNo=${tcNo}`,
      toFile: `${RNFS.DocumentDirectoryPath}/photo.jpg`,
      connectionTimeout: 4000,
      readTimeout: 4000,
    }).promise;
  } catch (e) {
    console.error('[CardStore] downloadPhoto', e);
  }
}

export async function deleteUserAccount(
  tcNo: string,
  phoneID: string,
): Promise<boolean> {
  try {
    const req = JSON.stringify({apiname: 'deleteAccount', tcNo, phoneID});
    const res = await sendAndReceive(req);
    return res.success && (res.jsonAnswer?.result as number) === 0;
  } catch {
    return false;
  }
}
