// src/utils/NfcHelper.ts
// NFC is read-only status on both platforms.
// iOS: NFC reading (CoreNFC) — no HCE support, no background emulation.
// Android: full NFC + HCE via the native _hce_nfc_service (unchanged from original).
//
// This helper only checks whether NFC is enabled on the device so the UI
// status card can show ON/OFF — the actual HCE APDU service stays native (Kotlin).

import { Platform, NativeModules } from 'react-native';

export async function checkNfcEnabled(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // react-native-nfc-manager or a simple native check
      // Using NativeModules fallback — install react-native-nfc-manager for full support
      const NfcManager = NativeModules.NfcManager;
      if (NfcManager && typeof NfcManager.isEnabled === 'function') {
        return await NfcManager.isEnabled();
      }
      return false;
    } else {
      // iOS: NFCReaderSession.readingAvailable (hardware availability, not a toggle)
      // There's no "NFC settings" on iOS — the chip is always on if supported.
      // We return true if the device supports NFC (iPhone 7+).
      const NfcManager = NativeModules.NfcManager;
      if (NfcManager && typeof NfcManager.isSupported === 'function') {
        return await NfcManager.isSupported();
      }
      return false;
    }
  } catch {
    return false;
  }
}
