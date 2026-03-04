# AVES BluePass — React Native

Cross-platform port of the original Android app.  
**Android**: Full feature parity (NFC HCE + BLE peripheral + QR + settings).  
**iOS**: BLE peripheral + QR + settings. NFC HCE is not available on iOS (Apple restriction).

---

## Architecture overview

```
AvesBluePass/
├── App.tsx                          # Entry point
├── src/
│   ├── navigation/AppNavigator.tsx  # Stack navigator (Main → Settings → CreateLogin)
│   ├── screens/
│   │   ├── MainScreen.tsx           # QR, countdown, NFC/BLE status, photo, renew
│   │   ├── SettingsScreen.tsx       # Server config, account management, QR quality
│   │   └── CreateLoginScreen.tsx    # Email/TC + activation code flow
│   ├── services/
│   │   ├── CardStore.ts             # carddata.bin I/O, remain-second calc, server fetch
│   │   ├── UdpClient.ts             # UDP JSON send/receive (mirrors Kotlin UdpClient)
│   │   └── BlePeripheralService.ts  # GATT peripheral/advertise (mirrors _ble_service.kt)
│   └── utils/
│       └── NfcHelper.ts             # NFC enabled check (cross-platform)
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml      # Merge into generated RN manifest
│       └── java/com/avesbluepass/
│           ├── _hce_nfc_service.kt  # ← COPY FROM ORIGINAL (unchanged)
│           ├── _ble_service.kt      # ← COPY FROM ORIGINAL (unchanged)
│           ├── ble_state_receiver.kt# ← COPY FROM ORIGINAL (unchanged)
│           └── utils.kt             # ← COPY FROM ORIGINAL (unchanged)
└── ios/
    └── InfoPlist_additions.plist    # Merge into generated Info.plist
```

---

## 1. Create the React Native project

```bash
npx @react-native-community/cli init AvesBluePass --template react-native-template-typescript
cd AvesBluePass
```

Then replace / add the files from this repo.

---

## 2. Install dependencies

```bash
npm install

# Core navigation
npm install @react-navigation/native @react-navigation/native-stack
npm install react-native-screens react-native-safe-area-context

# BLE peripheral (GATT server + advertising)
npm install react-native-ble-manager

# QR code
npm install react-native-qrcode-svg react-native-svg

# Storage
npm install @react-native-async-storage/async-storage

# File system (carddata.bin, photo)
npm install react-native-fs

# Permissions helper
npm install react-native-permissions

# Device ID (phone ID generation)
npm install react-native-device-info

# UDP client
npm install react-native-udp
```

### iOS pods

```bash
cd ios && pod install && cd ..
```

---

## 3. Android native files

Copy the following files from the original Android project **unchanged** into:
`android/app/src/main/java/com/avesbluepass/`

| Original file              | Copy as                    |
|---------------------------|----------------------------|
| `_hce_nfc_service.kt`     | `hce_nfc_service.kt`       |
| `_ble_service.kt`         | `ble_service.kt`           |
| `ble_state_receiver.kt`   | `ble_state_receiver.kt`    |
| `utils.kt`                | `utils.kt`                 |

Also copy `app/src/main/res/xml/apduservice.xml` to `android/app/src/main/res/xml/apduservice.xml`.

Update the package declaration in each copied file from `com.aves.hce` to `com.avesbluepass`.

Merge the permissions and service declarations from `android/app/src/main/AndroidManifest.xml`
(in this repo) into the auto-generated React Native manifest.

---

## 4. Android BLE peripheral setup (react-native-ble-manager)

react-native-ble-manager supports peripheral (server) mode via its `createBond`/peripheral APIs.
Add to `android/app/build.gradle`:

```gradle
android {
    ...
    defaultConfig {
        ...
        // Required for BLE advertiser
        minSdkVersion 26
    }
}
```

In `MainApplication.kt` (auto-generated), the BleManager package is auto-linked in RN 0.76+.

---

## 5. iOS BLE peripheral setup

### Info.plist
Merge all keys from `ios/InfoPlist_additions.plist` into your `ios/AvesBluePass/Info.plist`.

The critical keys are:
```xml
<key>UIBackgroundModes</key>
<array>
    <string>bluetooth-peripheral</string>
    <string>bluetooth-central</string>
</array>
```

Without these, iOS stops BLE advertising ~10 seconds after the app backgrounds.

### Xcode capability
In Xcode → Target → Signing & Capabilities → add **Background Modes** →
check **Uses Bluetooth LE accessories** and **Acts as a Bluetooth LE accessory**.

### iOS BLE peripheral limitations
- iOS allows GATT peripheral role (CBPeripheralManager) ✅
- iOS allows advertising in background when `bluetooth-peripheral` mode is set ✅
- iOS may throttle advertising in extreme low-power states ⚠️
- Apple NFC HCE (card emulation) is NOT available ❌

---

## 6. Permissions (runtime)

The app uses `react-native-permissions`. On first launch, it will request:

**Android:**
- `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE` (API 31+)
- `ACCESS_FINE_LOCATION` (API < 31)

**iOS:**
- Bluetooth (NSBluetoothAlwaysUsageDescription from Info.plist)
- Local Network (for UDP to server)

---

## 7. UDP client note

The original app uses UDP (`DatagramSocket` in Kotlin).  
The React Native port uses `react-native-udp` which wraps native UDP sockets.

```bash
npm install react-native-udp
```

iOS requires `NSLocalNetworkUsageDescription` in Info.plist (already included in `InfoPlist_additions.plist`).

---

## 8. carddata.bin compatibility

The binary layout is **identical** to the original:

```
offset  len   description
─────────────────────────────────────
  0      96   main card data (QR payload bytes 0-101)
 96       6   encoded timestamp
102       4   validitySecond (LE uint32)
106       6   raw timestamp (year-2000, month, day, h, m, s)
112       8   phoneID
─────────────────────────────────────
total   120 bytes
```

The phone ID is generated with the same deterministic fold algorithm (`acc * 31 + char.code`),
so a card written by the Android app is readable by the RN app on the same device if the file
is transferred (e.g., via the server write path).

---

## 9. NFC on iOS

iOS **does not support HCE** (card emulation). The NFC status card on the main screen will
show hardware availability (iPhone 7+ has NFC hardware). The actual card emulation on iOS
is simply not possible — the QR code and BLE paths are the alternatives.

The Android HCE service (`_hce_nfc_service.kt`) is kept **100% native** and is unchanged.

---

## 10. Build

```bash
# Android
npx react-native run-android

# iOS
npx react-native run-ios
```

For a release APK:
```bash
cd android && ./gradlew assembleRelease
```

---

## Feature comparison

| Feature                   | Android (RN) | iOS (RN) |
|--------------------------|:------------:|:--------:|
| QR code display          | ✅           | ✅       |
| Countdown timer          | ✅           | ✅       |
| Server fetch (UDP)       | ✅           | ✅       |
| Photo + full name        | ✅           | ✅       |
| Settings / account       | ✅           | ✅       |
| BLE GATT peripheral      | ✅           | ✅*      |
| BLE background advertise | ✅           | ✅*      |
| NFC HCE (card emulation) | ✅           | ❌       |

*iOS BLE peripheral works but Apple may throttle in background under battery pressure.
