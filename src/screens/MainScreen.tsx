// src/screens/MainScreen.tsx
// Mirrors main_activity.kt — QR display, countdown, NFC/BLE status cards, photo, renew

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  DeviceEventEmitter, Platform, AppState, Alert,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCardData, fetchFromServer, calcRemainSecond,
  cardCode, remainSecond, updateInProgress,
} from '../services/CardStore';
import { subscribeBleStatus, getBleStatus, startBlePeripheral } from '../services/BlePeripheralService';
import { checkNfcEnabled } from '../utils/NfcHelper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

const CARD_ACCENT = '#1e55a8';
const GREEN       = '#2E7D32';
const RED         = '#C62828';
const GRAY        = '#707070';

export default function MainScreen() {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [qrPayload,    setQrPayload]    = useState<string | null>(null);
  const [cardCodeStr,  setCardCodeStr]  = useState('');
  const [countdown,    setCountdown]    = useState<number | null>(null);
  const [photoUri,     setPhotoUri]     = useState<string | null>(null);
  const [fullName,     setFullName]     = useState('');
  const [nfcOn,        setNfcOn]        = useState(false);
  const [bleOn,        setBleOn]        = useState(false);
  const [bleMsg,       setBleMsg]       = useState('');
  const [renewing,     setRenewing]     = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    _startup();

    const cardSub = DeviceEventEmitter.addListener('CARD_UPDATED', _updateQr);
    const renewSub = DeviceEventEmitter.addListener('RENEW_CHANGED', ({ enabled }) => {
      setRenewing(!enabled);
    });
    const bleSub = subscribeBleStatus((status, msg) => {
      const label = status === 'advertising' ? 'BLE yayında' : status === 'connected' ? 'BLE yayında' : '';
      setBleMsg(msg ? `${label}${msg ? ', ' + msg : ''}` : label);
    });
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') _refreshStatuses();
    });

    return () => {
      cardSub.remove();
      renewSub.remove();
      bleSub();
      appStateSub.remove();
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ─── Startup ──────────────────────────────────────────────────────────────

  async function _startup() {
    await getCardData();
    await _loadUserInfo();
    await _refreshStatuses();
    _updateQr();
    _startBle();
  }

  async function _startBle() {
    try { await startBlePeripheral(); } catch { /* permissions may be missing */ }
  }

  async function _refreshStatuses() {
    // NFC
    const nfc = await checkNfcEnabled();
    setNfcOn(nfc);

    // BLE — react-native-ble-manager
    const { status } = getBleStatus();
    const bleEnabled  = status !== 'stopped' && status !== 'error' && status !== 'idle';
    setBleOn(bleEnabled);
  }

  async function _loadUserInfo() {
    const name = (await AsyncStorage.getItem('fullName')) ?? '';
    setFullName(name);

    const dir   = await RNFS.readDir(RNFS.DocumentDirectoryPath);
    const photo = dir.find(f => f.name.startsWith('photo.'));
    if (photo) setPhotoUri(`file://${photo.path}`);
    else        setPhotoUri(null);
  }

  // ─── QR refresh ───────────────────────────────────────────────────────────

  const _updateQr = useCallback(async () => {
    const data = await getCardData();

    if (cardCode === 0) {
      setQrPayload(null);
      setCardCodeStr('');
      setCountdown(null);
      return;
    }

    // First 102 bytes as ISO-8859-1 string for QR
    const slice = data.slice(0, 102);
    // Convert binary buffer to ISO-8859-1 safe string using char codes
    const chars = Array.from(slice).map(b => String.fromCharCode(b)).join('');
    setQrPayload(chars);
    setCardCodeStr(String(cardCode));
    _startCountdown();
  }, []);

  function _startCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);

    const remain = calcRemainSecond();

    if (remain === 0xffffffff) {
      // Permanent card — no countdown
      setCountdown(null);
      return;
    }

    if (remain <= 0) {
      setCountdown(0);
      setQrPayload(null);
      return;
    }

    setCountdown(remain);

    countdownRef.current = setInterval(() => {
      const r = calcRemainSecond();
      if (r <= 0) {
        clearInterval(countdownRef.current!);
        setCountdown(0);
        setQrPayload(null);
        setCardCodeStr('');
      } else {
        setCountdown(r);
      }
    }, 1000);
  }

  // ─── Renew button ─────────────────────────────────────────────────────────

  async function _onRenew() {
    if (updateInProgress || renewing) return;
    setRenewing(true);
    const ok = await fetchFromServer();
    if (!ok) Alert.alert('Hata', 'Sunucudan güncellenemedi');
    await _updateQr();
    setRenewing(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Logo placeholder */}
      <View style={styles.logoRow}>
        <Text style={styles.logoText}>AVES BluePass</Text>
      </View>

      {/* Full name */}
      {fullName ? <Text style={styles.fullName}>{fullName}</Text> : null}

      {/* NFC + BLE + Photo row */}
      <View style={styles.statusRow}>
        {/* Left: NFC & BLE cards */}
        <View style={styles.statusLeft}>
          {/* NFC card */}
          <View style={styles.statusCard}>
            <View style={styles.statusCardInner}>
              <Text style={[styles.statusDot, { color: nfcOn ? GREEN : RED }]}>●</Text>
              <Text style={[styles.statusLabel, { color: nfcOn ? GREEN : RED }]}>
                NFC : {nfcOn ? 'ON' : 'OFF'}
              </Text>
            </View>
          </View>

          {/* BLE card */}
          <View style={[styles.statusCard, { marginTop: 10 }]}>
            <View style={styles.statusCardInner}>
              <Text style={[styles.statusDot, { color: bleOn ? GREEN : RED }]}>●</Text>
              <Text style={[styles.statusLabel, { color: bleOn ? GREEN : RED }]}>
                BLE : {bleOn ? 'ON' : 'OFF'}
              </Text>
            </View>
            {bleMsg ? <Text style={styles.bleMsg}>{bleMsg}</Text> : null}
          </View>
        </View>

        {/* Right: Photo */}
        <View style={styles.photoContainer}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Text style={styles.photoPlaceholderText}>👤</Text>
            </View>
          )}
        </View>
      </View>

      {/* QR Code area */}
      <View style={styles.qrContainer}>
        {qrPayload ? (
          <>
            <QRCode
              value={qrPayload}
              size={280}
              color="black"
              backgroundColor="white"
              ecl="L"
            />
            <View style={styles.qrFooter}>
              <Text style={styles.cardCodeText}>{cardCodeStr}</Text>
              {countdown !== null && countdown < 0xffffffff ? (
                <Text style={styles.countdownText}>{countdown}</Text>
              ) : null}
            </View>
          </>
        ) : (
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrPlaceholderText}>
              {cardCode === 0 ? 'Kart verisi bulunamadı' : 'QR süresi doldu'}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom buttons */}
      <View style={styles.bottomRow}>
        <TouchableOpacity
          style={[styles.renewBtn, renewing && styles.renewBtnDisabled]}
          onPress={_onRenew}
          disabled={renewing}
        >
          {renewing
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.renewBtnText}>Sunucudan güncelle</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.settingsBtnText}>⚙</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { alignItems: 'center', paddingHorizontal: 8 },

  logoRow: { width: '100%', height: 60, justifyContent: 'center', alignItems: 'center' },
  logoText: { fontSize: 22, fontWeight: 'bold', color: CARD_ACCENT },

  fullName: { fontSize: 18, fontWeight: 'bold', marginTop: 4, textAlign: 'center' },

  statusRow: { flexDirection: 'row', width: '100%', marginTop: 8 },
  statusLeft: { flex: 1, paddingRight: 8 },

  statusCard: {
    backgroundColor: '#F5F5F5', borderRadius: 14, padding: 8,
    marginStart: 8, marginEnd: 4,
  },
  statusCardInner: { flexDirection: 'row', alignItems: 'center' },
  statusDot:   { fontSize: 18, marginRight: 6 },
  statusLabel: { fontSize: 17, fontWeight: 'bold' },
  bleMsg:      { fontSize: 10, color: GRAY, marginTop: 2, marginStart: 4 },

  photoContainer: {
    width: 110, height: 135,
    marginEnd: 14, marginStart: 6,
    borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#F5F5F5',
  },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  photoPlaceholderText: { fontSize: 48 },

  qrContainer: {
    marginTop: 16, width: 300, minHeight: 320,
    alignItems: 'center', justifyContent: 'center',
  },
  qrFooter: {
    flexDirection: 'row', width: '100%',
    justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, paddingHorizontal: 4,
  },
  cardCodeText:  { color: '#cccccc', fontSize: 16, fontWeight: 'bold' },
  countdownText: { color: GRAY, fontSize: 24, fontWeight: 'bold' },

  qrPlaceholder: {
    width: 280, height: 280,
    backgroundColor: '#F5F5F5', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  qrPlaceholderText: { color: GRAY, fontSize: 14, textAlign: 'center', padding: 16 },

  bottomRow: {
    flexDirection: 'row', width: '100%',
    justifyContent: 'space-between', alignItems: 'center',
    marginTop: 24, paddingHorizontal: 16,
  },
  renewBtn: {
    backgroundColor: CARD_ACCENT, borderRadius: 15,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  renewBtnDisabled: { opacity: 0.6 },
  renewBtnText:     { color: '#fff', fontSize: 14 },

  settingsBtn: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ddd',
    justifyContent: 'center', alignItems: 'center',
    elevation: 2,
  },
  settingsBtnText: { fontSize: 24, color: CARD_ACCENT },
});
