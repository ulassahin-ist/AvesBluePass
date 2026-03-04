// src/services/BlePeripheralService.ts
//
// Android: delegates entirely to the native ble_service.kt foreground service
//          via the BleServiceModule native bridge.
//          Status updates arrive as "BLE_STATUS_UPDATE" events containing the
//          same message strings that ble_service.kt broadcasts locally.
//
// react-native-ble-manager is a *central* (scanner) library and does NOT
// support peripheral/advertising mode from JS — do not call startAdvertising().

import {
  NativeModules,
  NativeEventEmitter,
  DeviceEventEmitter,
  Platform,
} from 'react-native';

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
): () => void {
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

/** Derive a BleStatus from the Turkish message strings that ble_service.kt sends. */
function parseStatusFromMsg(msg: string): BleStatus {
  if (!msg) return 'stopped';
  if (msg.includes('bağlandı') && !msg.includes('kesti')) return 'connected';
  if (msg.includes('yayında')) return 'advertising';
  if (msg.includes('hata') || msg.includes('Hata')) return 'error';
  return 'stopped';
}

let _eventSubscribed = false;

export async function startBlePeripheral(): Promise<void> {
  if (Platform.OS === 'android') {
    const {BleServiceModule} = NativeModules;

    if (!BleServiceModule) {
      console.warn(
        '[BLE] BleServiceModule not found — did you rebuild the native app?',
      );
      emit('error', 'BleServiceModule bulunamadı');
      return;
    }

    // Subscribe to status broadcasts from ble_service.kt (once only)
    if (!_eventSubscribed) {
      _eventSubscribed = true;
      const emitter = new NativeEventEmitter(BleServiceModule);
      emitter.addListener('BLE_STATUS_UPDATE', (msg: string) => {
        const status = parseStatusFromMsg(msg);
        emit(status, msg);
      });
    }

    // Start the native foreground service — it creates the GATT server and
    // begins advertising automatically once Bluetooth is confirmed on.
    BleServiceModule.startService();
    emit('advertising', '');
  } else {
    // iOS: CBPeripheralManager is handled by react-native-ble-manager
    // peripheral APIs or a dedicated peripheral library.
    // For now, report as unsupported from JS side.
    console.log(
      '[BLE] iOS peripheral mode: ensure CBPeripheralManager is configured natively.',
    );
    emit('idle', '');
  }
}

export function stopBlePeripheral(): void {
  if (Platform.OS === 'android') {
    const {BleServiceModule} = NativeModules;
    BleServiceModule?.stopService();
  }
  emit('stopped', '');
}

export function getBleStatus(): {status: BleStatus; msg: string} {
  return {status: _status, msg: _statusMessage};
}

// Re-export UUIDs for any consumers that reference them
export const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
export const CHAR_UUID = 'ab907856-3412-3412-3412-341278563412';
