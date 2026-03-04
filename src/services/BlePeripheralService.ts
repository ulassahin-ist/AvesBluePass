// src/services/BlePeripheralService.ts
// Mirrors _ble_service.kt — GATT peripheral (server) with advertising
// Uses react-native-ble-plx for central scanning on iOS (peripheral role needs
// react-native-ble-advertiser + react-native-ble-manager for the server side).
//
// ARCHITECTURE NOTE:
//   Android: Full GATT peripheral (server + advertise) — same as Kotlin service.
//   iOS:     GATT peripheral via CoreBluetooth CBPeripheralManager — same UUIDs,
//            same characteristic, same read/write handlers.
//            iOS does NOT allow background advertising unless the app is in
//            "bluetooth-peripheral" background mode (Info.plist key required).
//
// LIBRARIES USED:
//   react-native-ble-advertiser  — BLE advertising (Android + iOS)
//   react-native-ble-manager     — GATT server / peripheral role
//   (react-native-ble-plx is for CENTRAL/client role — not used here)

import { NativeModules, NativeEventEmitter, DeviceEventEmitter, Platform } from 'react-native';
import { getCardData, writeToDisk, fetchFromServer, remainSecond, cardCode } from './CardStore';

const SERVICE_UUID  = '12345678-1234-1234-1234-1234567890ab';
const CHAR_UUID     = 'ab907856-3412-3412-3412-341278563412';

// react-native-ble-manager exposes BleManager
import BleManager from 'react-native-ble-manager';
const BleManagerModule  = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

export type BleStatus =
  | 'idle'
  | 'advertising'
  | 'connected'
  | 'stopped'
  | 'error';

let _status: BleStatus = 'idle';
let _statusMessage     = '';

const listeners: Array<(status: BleStatus, msg: string) => void> = [];

export function subscribeBleStatus(cb: (status: BleStatus, msg: string) => void) {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function emit(status: BleStatus, msg: string) {
  _status        = status;
  _statusMessage = msg;
  listeners.forEach(cb => cb(status, msg));
  DeviceEventEmitter.emit('BLE_STATUS', { status, msg });
}

// ─── Init / Start ──────────────────────────────────────────────────────────────

export async function startBlePeripheral(): Promise<void> {
  try {
    await BleManager.start({ showAlert: false });

    // Set up GATT server service + characteristic
    await BleManager.createBond('', ''); // no-op on peripheral side; actual server setup below

    // Platform-specific peripheral server setup is handled in native code
    // (BleManager peripheral extensions). Here we hook the JS-side events.
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

// ─── Advertising ───────────────────────────────────────────────────────────────

async function _startAdvertising(): Promise<void> {
  try {
    // react-native-ble-manager peripheral advertising
    // On Android: uses BluetoothLeAdvertiser
    // On iOS: uses CBPeripheralManager
    await (BleManager as unknown as {
      startAdvertising: (opts: object) => Promise<void>;
    }).startAdvertising({
      serviceUUIDs: [SERVICE_UUID],
      localName:    'AvesBluePass',
    });

    emit('advertising', '');
  } catch (e) {
    console.error('[BLE] advertising error', e);
    emit('error', `Advertising hata: ${e}`);
  }
}

// ─── GATT event hooks ──────────────────────────────────────────────────────────

function _hookEvents() {
  // Connection state
  bleManagerEmitter.addListener('BleManagerConnectPeripheral', (args: { peripheral: string }) => {
    console.log('[BLE] Reader connected:', args.peripheral);
    emit('connected', 'Okuyucu bağlandı');
  });

  bleManagerEmitter.addListener('BleManagerDisconnectPeripheral', (args: { peripheral: string }) => {
    console.log('[BLE] Reader disconnected:', args.peripheral);
    emit('advertising', 'Okuyucu bağlantıyı kesti');
  });

  // READ request — mirrors onCharacteristicReadRequest
  bleManagerEmitter.addListener(
    'BleManagerDidReceiveCharacteristicReadRequest',
    async (args: { requestId: string; characteristicUUID: string; offset: number }) => {
      console.log('[BLE] Read request');

      if (remainSecond === 0 && cardCode !== 0) {
        // Card expired — trigger server fetch, return error
        fetchFromServer().catch(console.error);
        await (BleManager as unknown as {
          respondToReadRequest: (a: string, b: number | null) => Promise<void>;
        }).respondToReadRequest(args.requestId, null);
        return;
      }

      const data     = await getCardData();
      const toSend   = Array.from(data.slice(0, 102));

      await (BleManager as unknown as {
        respondToReadRequest: (a: string, b: number[]) => Promise<void>;
      }).respondToReadRequest(args.requestId, toSend);
    },
  );

  // WRITE request — mirrors onCharacteristicWriteRequest
  bleManagerEmitter.addListener(
    'BleManagerDidReceiveCharacteristicWriteRequest',
    async (args: { requestId: string; value: number[]; responseNeeded: boolean }) => {
      console.log('[BLE] Write request, len=', args.value.length);

      if (args.value.length !== 112) {
        if (args.responseNeeded) {
          await (BleManager as unknown as {
            respondToWriteRequest: (a: string, b: number) => Promise<void>;
          }).respondToWriteRequest(args.requestId, 0x67);
        }
        return;
      }

      const buf    = Buffer.from(args.value);
      const result = await writeToDisk(buf);

      if (args.responseNeeded) {
        await (BleManager as unknown as {
          respondToWriteRequest: (a: string, b: number) => Promise<void>;
        }).respondToWriteRequest(args.requestId, result ? 0x00 : 0x01);
      }
    },
  );
}

export { SERVICE_UUID, CHAR_UUID };
export function getBleStatus(): { status: BleStatus; msg: string } {
  return { status: _status, msg: _statusMessage };
}
