// src/services/BlePeripheralService.ts
// Mirrors _ble_service.kt — GATT peripheral (server) with advertising

import {
  NativeModules,
  NativeEventEmitter,
  DeviceEventEmitter,
} from 'react-native';
import {
  getCardData,
  writeToDisk,
  fetchFromServer,
  remainSecond,
  cardCode,
} from './CardStore';

const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
const CHAR_UUID = 'ab907856-3412-3412-3412-341278563412';

import BleManager from 'react-native-ble-manager';
const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

export type BleStatus =
  | 'idle'
  | 'advertising'
  | 'connected'
  | 'stopped'
  | 'error';

let _status: BleStatus = 'idle';
let _statusMessage = '';

const listeners: Array<(status: BleStatus, msg: string) => void> = [];

export function subscribeBleStatus(
  cb: (status: BleStatus, msg: string) => void,
) {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function emit(status: BleStatus, msg: string) {
  _status = status;
  _statusMessage = msg;
  listeners.forEach(cb => cb(status, msg));
  DeviceEventEmitter.emit('BLE_STATUS', {status, msg});
}

export async function startBlePeripheral(): Promise<void> {
  try {
    await BleManager.start({showAlert: false});
    _hookEvents();
    await _startAdvertising();
  } catch (e) {
    console.error('[BLE] startBlePeripheral error', e);
    emit('error', `BLE başlatılamadı: ${e}`);
  }
}

export function stopBlePeripheral(): void {
  try {
    BleManager.stopScan();
    emit('stopped', '');
  } catch (e) {
    console.error('[BLE] stop error', e);
  }
}

async function _startAdvertising(): Promise<void> {
  try {
    await (BleManager as any).startAdvertising({
      serviceUUIDs: [SERVICE_UUID],
      localName: 'AvesBluePass',
    });
    emit('advertising', '');
  } catch (e) {
    console.error('[BLE] advertising error', e);
    emit('error', `Advertising hata: ${e}`);
  }
}

function _hookEvents() {
  bleManagerEmitter.addListener('BleManagerConnectPeripheral', () => {
    emit('connected', 'Okuyucu bağlandı');
  });

  bleManagerEmitter.addListener('BleManagerDisconnectPeripheral', () => {
    emit('advertising', 'Okuyucu bağlantıyı kesti');
  });

  // READ — return first 102 bytes of card data
  bleManagerEmitter.addListener(
    'BleManagerDidReceiveCharacteristicReadRequest',
    async (args: {requestId: string; offset: number}) => {
      if (remainSecond === 0 && cardCode !== 0) {
        fetchFromServer().catch(console.error);
        await (BleManager as any).respondToReadRequest(args.requestId, null);
        return;
      }

      const data = await getCardData();
      const toSend = Array.from(data.slice(0, 102)); // number[] — no Buffer needed

      await (BleManager as any).respondToReadRequest(args.requestId, toSend);
    },
  );

  // WRITE — receive 112 bytes
  bleManagerEmitter.addListener(
    'BleManagerDidReceiveCharacteristicWriteRequest',
    async (args: {
      requestId: string;
      value: number[];
      responseNeeded: boolean;
    }) => {
      if (args.value.length !== 112) {
        if (args.responseNeeded)
          await (BleManager as any).respondToWriteRequest(args.requestId, 0x67);
        return;
      }

      // Convert number[] to Uint8Array — no Buffer needed
      const data = new Uint8Array(args.value);
      const result = await writeToDisk(data);

      if (args.responseNeeded)
        await (BleManager as any).respondToWriteRequest(
          args.requestId,
          result ? 0x00 : 0x01,
        );
    },
  );
}

export {SERVICE_UUID, CHAR_UUID};
export function getBleStatus(): {status: BleStatus; msg: string} {
  return {status: _status, msg: _statusMessage};
}
