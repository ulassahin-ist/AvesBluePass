// src/utils/NfcHelper.ts
// NFC is read-only status on both platforms.
// iOS: NFC reading (CoreNFC) — no HCE support, no background emulation.
// Android: full NFC + HCE via the native hce_nfc_service (unchanged from original).
//
// This helper only checks whether NFC is enabled on the device so the UI
// status card can show ON/OFF — the actual HCE APDU service stays native (Kotlin).

import {Platform, NativeModules} from 'react-native';

export async function checkNfcEnabled(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // Use our native NfcStatusModule (see NfcStatusModule.kt)
      const {NfcStatusModule} = NativeModules;
      if (
        NfcStatusModule &&
        typeof NfcStatusModule.isNfcEnabled === 'function'
      ) {
        return await NfcStatusModule.isNfcEnabled();
      }
      return false;
    } else {
      return false;
    }
  } catch {
    return false;
  }
}
