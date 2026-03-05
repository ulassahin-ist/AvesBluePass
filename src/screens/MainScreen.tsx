// src/screens/MainScreen.tsx
// UI mirrors main_activity.kt exactly

import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  DeviceEventEmitter,
  AppState,
  Alert,
  ScrollView,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  getCardData,
  fetchFromServer,
  calcRemainSecond,
  updateInProgress,
} from '../services/CardStore';
import {
  subscribeBleStatus,
  getBleStatus,
  startBlePeripheral,
} from '../services/BlePeripheralService';
import {checkNfcEnabled} from '../utils/NfcHelper';

const GREEN = '#2E7D32';
const RED = '#C62828';
const GRAY = '#757575';
const BLUE = '#1565C0';

export default function MainScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // ── state ──────────────────────────────────────────────────────────────────
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [cardCodeVal, setCardCodeVal] = useState(0); // local reactive copy
  const [countdown, setCountdown] = useState<number | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [nfcOn, setNfcOn] = useState(false);
  const [bleOn, setBleOn] = useState(false);
  const [bleMsg, setBleMsg] = useState('');
  const [renewing, setRenewing] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    _startup();

    const cardSub = DeviceEventEmitter.addListener('CARD_UPDATED', _updateQr);
    const renewSub = DeviceEventEmitter.addListener(
      'RENEW_CHANGED',
      ({enabled}) => setRenewing(!enabled),
    );
    const bleSub = subscribeBleStatus((_status, msg) => {
      const on = _status === 'advertising' || _status === 'connected';
      setBleOn(on);
      setBleMsg(msg);
    });
    const appSub = AppState.addEventListener('change', s => {
      if (s === 'active') _refreshStatuses();
    });

    return () => {
      cardSub.remove();
      renewSub.remove();
      bleSub();
      appSub.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function _startup() {
    await getCardData();
    await _loadUserInfo();
    _refreshStatuses();
    _updateQr();
    try {
      await startBlePeripheral();
    } catch {
      /* permissions pending */
    }
  }

  async function _refreshStatuses() {
    setNfcOn(await checkNfcEnabled());
    const {status} = getBleStatus();
    setBleOn(status === 'advertising' || status === 'connected');
  }

  async function _loadUserInfo() {
    const name = (await AsyncStorage.getItem('fullName')) ?? '';
    setFullName(name);

    const dir = await RNFS.readDir(RNFS.DocumentDirectoryPath);
    const photo = dir.find(f => f.name.startsWith('photo.'));
    setPhotoUri(photo ? `file://${photo.path}` : null);
  }

  // ── QR update ──────────────────────────────────────────────────────────────
  const _updateQr = useCallback(async () => {
    const data = await getCardData();

    // Read cardCode directly from the data bytes (same as Kotlin _Remain_Second)
    const cc =
      (data[0] & 0xff) |
      ((data[1] & 0xff) << 8) |
      ((data[2] & 0xff) << 16) |
      ((data[3] & 0xff) << 24);

    setCardCodeVal(cc);

    if (cc === 0) {
      setQrPayload(null);
      setCountdown(null);
      return;
    }

    // First 102 bytes as ISO-8859-1 string for QR
    const slice = Array.from(data.slice(0, 102))
      .map(b => String.fromCharCode(b))
      .join('');
    setQrPayload(slice);
    _startCountdown();
  }, []);

  function _startCountdown() {
    if (timerRef.current) clearInterval(timerRef.current);

    const remain = calcRemainSecond();

    if (remain === 0xffffffff) {
      setCountdown(null);
      return;
    }
    if (remain <= 0) {
      setCountdown(0);
      setQrPayload(null);
      return;
    }

    setCountdown(remain);
    timerRef.current = setInterval(() => {
      const r = calcRemainSecond();
      if (r <= 0) {
        clearInterval(timerRef.current!);
        setCountdown(0);
        setQrPayload(null);
        setCardCodeVal(0);
      } else {
        setCountdown(r);
      }
    }, 1000);
  }

  // ── renew ──────────────────────────────────────────────────────────────────
  async function _onRenew() {
    if (updateInProgress || renewing) return;
    setRenewing(true);
    const ok = await fetchFromServer();
    if (!ok) Alert.alert('Hata', 'Sunucudan güncellenemedi');
    await _updateQr();
    setRenewing(false);
  }

  // ── system settings taps ───────────────────────────────────────────────────
  function _onNfcCard() {
    if (Platform.OS === 'android')
      Linking.sendIntent('android.settings.NFC_SETTINGS').catch(() => {});
  }
  function _onBleCard() {
    if (Platform.OS === 'android')
      Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {});
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24},
      ]}
      showsVerticalScrollIndicator={false}>
      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <Text style={styles.appTitle}>AVES BluePass</Text>
        <TouchableOpacity
          style={styles.settingsIconBtn}
          onPress={() => navigation.navigate('Settings')}>
          <Icon name="cog" size={28} color={GRAY} />
        </TouchableOpacity>
      </View>

      {/* ── Status row: NFC | BLE | Photo ── */}
      <View style={styles.statusRow}>
        <View style={styles.statusCol}>
          <TouchableOpacity
            style={styles.statusCard}
            onPress={_onNfcCard}
            activeOpacity={0.7}>
            <View style={styles.statusCardRow}>
              <Icon
                name="nfc"
                size={22}
                color={nfcOn ? GREEN : RED}
                style={{marginRight: 8}}
              />
              <Text style={[styles.statusLabel, {color: nfcOn ? GREEN : RED}]}>
                NFC {nfcOn ? 'ON' : 'OFF'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statusCard, {marginTop: 8}]}
            onPress={_onBleCard}
            activeOpacity={0.7}>
            <View style={styles.statusCardRow}>
              <Icon
                name="bluetooth"
                size={22}
                color={bleOn ? GREEN : RED}
                style={{marginRight: 8}}
              />
              <Text style={[styles.statusLabel, {color: bleOn ? GREEN : RED}]}>
                BLE : {bleOn ? 'ON' : 'OFF'}
              </Text>
            </View>
            {bleMsg ? (
              <Text style={styles.bleSubText} numberOfLines={2}>
                {bleMsg}
              </Text>
            ) : null}
          </TouchableOpacity>
        </View>

        <View style={styles.photoWrap}>
          {photoUri ? (
            <Image
              source={{uri: photoUri}}
              style={styles.photo}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Text style={styles.photoPlaceholderIcon}>👤</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Full name ── */}
      {fullName ? <Text style={styles.fullName}>{fullName}</Text> : null}

      {/* ── QR code ── */}
      <View style={styles.qrWrap}>
        {qrPayload ? (
          <QRCode
            value={qrPayload}
            size={270}
            color="black"
            backgroundColor="white"
            ecl="L"
          />
        ) : (
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrPlaceholderText}>
              {cardCodeVal === 0 ? 'Kart verisi bulunamadı' : 'QR süresi doldu'}
            </Text>
          </View>
        )}
      </View>

      {/* ── Card code + countdown ── */}
      {cardCodeVal !== 0 && (
        <View style={styles.codeRow}>
          <Text style={styles.cardCodeText}>{cardCodeVal}</Text>
          {countdown !== null && countdown < 0xffffffff ? (
            <Text style={styles.countdownText}>{countdown}</Text>
          ) : null}
        </View>
      )}

      {/* ── Renew button ── */}
      {cardCodeVal !== 0 && (
        <TouchableOpacity
          style={[styles.renewBtn, renewing && styles.renewBtnDisabled]}
          onPress={_onRenew}
          disabled={renewing}>
          {renewing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.renewBtnText}>Sunucudan güncelle</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F6F8FB',
  },

  content: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },

  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },

  appTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: BLUE,
    letterSpacing: 0.3,
  },

  settingsIconBtn: {
    padding: 8,
    borderRadius: 10,
    // backgroundColor: '#EEF3FF',
  },

  settingsIcon: {
    fontSize: 22,
    color: BLUE,
  },

  statusRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },

  statusCol: {
    flex: 1,
    marginRight: 10,
  },

  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,

    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 3,
  },

  statusCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  dot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    marginRight: 8,
  },

  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
  },

  bleSubText: {
    fontSize: 12,
    color: GRAY,
    marginTop: 6,
    opacity: 0.8,
  },

  photoWrap: {
    width: 100,
    height: 130,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#EDEFF3',

    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 4,
  },

  photo: {
    width: '100%',
    height: '100%',
  },

  photoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  photoPlaceholderIcon: {
    fontSize: 48,
    opacity: 0.6,
  },

  fullName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    marginTop: 12,
    marginBottom: 4,
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  qrWrap: {
    marginTop: 18,
    width: 270,
    height: 270,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,

    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 6},
    elevation: 6,
  },

  qrPlaceholder: {
    width: 270,
    height: 270,
    backgroundColor: '#F1F3F6',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  qrPlaceholderText: {
    color: GRAY,
    fontSize: 14,
    textAlign: 'center',
  },

  codeRow: {
    width: 270,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
  },

  cardCodeText: {
    color: '#A0A4AA',
    fontSize: 14,
    fontWeight: '600',
  },

  countdownText: {
    color: '#444',
    fontSize: 22,
    fontWeight: '700',
  },

  renewBtn: {
    marginTop: 22,
    backgroundColor: BLUE,
    borderRadius: 14,
    paddingHorizontal: 36,
    paddingVertical: 14,

    shadowColor: BLUE,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 4,
  },

  renewBtnDisabled: {
    opacity: 0.55,
  },

  renewBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
