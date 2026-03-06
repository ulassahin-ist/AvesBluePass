// src/screens/MainScreen.tsx

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
import {useFocusEffect} from '@react-navigation/native';
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

const C = {
  bg: '#EEF2F7',
  card: '#FFFFFF',
  blue: '#1A56DB',
  green: '#059669',
  greenBg: '#ECFDF5',
  greenBorder: '#A7F3D0',
  red: '#DC2626',
  redBg: '#FEF2F2',
  redBorder: '#FECACA',
  text: '#0F172A',
  textSub: '#64748B',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
};

const SHADOW_SM = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: {width: 0, height: 2},
  elevation: 3,
};
const SHADOW_MD = {
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: {width: 0, height: 4},
  elevation: 5,
};

export default function MainScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [cardCodeVal, setCardCodeVal] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [nfcOn, setNfcOn] = useState(false);
  const [bleOn, setBleOn] = useState(false);
  const [bleMsg, setBleMsg] = useState('');
  const [renewing, setRenewing] = useState(false);
  const [qrLevel, setQrLevel] = useState<'L' | 'M' | 'Q' | 'H'>('L');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    _startup();
    const cardSub = DeviceEventEmitter.addListener('CARD_UPDATED', _updateQr);
    const renewSub = DeviceEventEmitter.addListener(
      'RENEW_CHANGED',
      ({enabled}) => setRenewing(!enabled),
    );
    const bleSub = subscribeBleStatus((_st, msg) => {
      setBleOn(_st === 'advertising' || _st === 'connected');
      setBleMsg(msg);
    });
    const appSub = AppState.addEventListener('change', st => {
      if (st === 'active') _refreshStatuses();
    });
    return () => {
      cardSub.remove();
      renewSub.remove();
      bleSub();
      appSub.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      _loadUserInfo();
    }, []),
  );

  async function _startup() {
    await getCardData();
    _refreshStatuses();
    _updateQr();
    try {
      await startBlePeripheral();
    } catch {}
  }

  async function _refreshStatuses() {
    setNfcOn(await checkNfcEnabled());
    const {status} = getBleStatus();
    setBleOn(status === 'advertising' || status === 'connected');
  }

  async function _loadUserInfo() {
    setFullName((await AsyncStorage.getItem('fullName')) ?? '');
    // Load QR quality setting
    const lvl = (await AsyncStorage.getItem('qr_quality')) ?? 'L';
    setQrLevel(lvl as 'L' | 'M' | 'Q' | 'H');
    try {
      const dir = await RNFS.readDir(RNFS.DocumentDirectoryPath);
      const photo = dir.find(f => f.name.startsWith('photo.'));
      setPhotoUri(
        photo ? `file://${photo.path}?t=${photo.mtime ?? Date.now()}` : null,
      );
    } catch {
      setPhotoUri(null);
    }
  }

  const _updateQr = useCallback(async () => {
    const data = await getCardData();
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
    setQrPayload(
      Array.from(data.slice(0, 102))
        .map(b => String.fromCharCode(b))
        .join(''),
    );
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

  async function _onRenew() {
    if (updateInProgress || renewing) return;
    setRenewing(true);
    if (!(await fetchFromServer()))
      Alert.alert('Hata', 'Sunucudan güncellenemedi');
    await _updateQr();
    setRenewing(false);
  }

  function fmt(sec: number) {
    if (sec >= 3600)
      return `${Math.floor(sec / 3600)}s ${Math.floor((sec % 3600) / 60)}d`;
    if (sec >= 60)
      return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    return `${sec}s`;
  }

  const urgent =
    typeof countdown === 'number' && countdown < 30 && countdown > 0;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[
        s.content,
        {paddingTop: insets.top + 14, paddingBottom: insets.bottom + 32},
      ]}
      showsVerticalScrollIndicator={false}>
      {/* ── Top bar: logo image + settings cog ── */}
      <View style={s.topBar}>
        <Image
          source={require('../assets/logo.png')}
          style={s.logo}
          resizeMode="contain"
        />

        <TouchableOpacity
          style={s.cogBtn}
          onPress={() => navigation.navigate('Settings')}>
          <Icon name="cog-outline" size={22} color={C.textSub} />
        </TouchableOpacity>
      </View>

      {/* ── NFC + BLE — full-width cards side by side ── */}
      <View style={s.statusRow}>
        <TouchableOpacity
          style={[
            s.statusCard,
            {
              backgroundColor: nfcOn ? C.greenBg : C.redBg,
              borderColor: nfcOn ? C.greenBorder : C.redBorder,
            },
          ]}
          onPress={() =>
            Platform.OS === 'android' &&
            Linking.sendIntent('android.settings.NFC_SETTINGS').catch(() => {})
          }
          activeOpacity={0.75}>
          <Icon
            name="nfc"
            style={s.statusCardIcon}
            size={30}
            color={nfcOn ? C.green : C.red}
          />
          <Text style={[s.statusCardLabel, {color: nfcOn ? C.green : C.red}]}>
            NFC
          </Text>
          <View
            style={[s.statusBadge, {backgroundColor: nfcOn ? C.green : C.red}]}>
            <Text style={s.statusBadgeTxt}>{nfcOn ? 'ON' : 'OFF'}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            s.statusCard,
            {
              backgroundColor: bleOn ? C.greenBg : C.redBg,
              borderColor: bleOn ? C.greenBorder : C.redBorder,
            },
          ]}
          onPress={() =>
            Platform.OS === 'android' &&
            Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(
              () => {},
            )
          }
          activeOpacity={0.75}>
          <Icon
            name="bluetooth"
            style={s.statusCardIcon}
            size={30}
            color={bleOn ? C.green : C.red}
          />
          <Text style={[s.statusCardLabel, {color: bleOn ? C.green : C.red}]}>
            Bluetooth
          </Text>
          <View
            style={[s.statusBadge, {backgroundColor: bleOn ? C.green : C.red}]}>
            <Text style={s.statusBadgeTxt}>{bleOn ? 'ON' : 'OFF'}</Text>
          </View>
          {bleMsg ? (
            <Text style={s.statusCardSub} numberOfLines={1}>
              {bleMsg}
            </Text>
          ) : null}
        </TouchableOpacity>
      </View>

      {/* ── Profile card ── */}
      <View style={[s.card, s.profileCard]}>
        <View style={s.avatarWrap}>
          {photoUri ? (
            <Image
              source={{uri: photoUri}}
              style={s.avatar}
              resizeMode="cover"
            />
          ) : (
            <View style={s.avatarFallback}>
              <Icon name="account" size={36} color={C.textMuted} />
            </View>
          )}
        </View>
        <View style={{flex: 1}}>
          <Text style={s.fullName} numberOfLines={2}>
            {fullName || 'Hesap girilmedi'}
          </Text>
          {cardCodeVal !== 0 && (
            <Text style={s.cardId}>Kart #{cardCodeVal}</Text>
          )}
        </View>
      </View>

      {/* ── QR card ── */}
      <View style={[s.card, s.qrCard]}>
        {qrPayload ? (
          <>
            <View style={s.qrFrame}>
              <QRCode
                value={qrPayload}
                size={232}
                color={C.text}
                backgroundColor="#fff"
                ecl={qrLevel}
              />
            </View>
            {countdown !== null && countdown < 0xffffffff && (
              <View style={[s.timerBadge, urgent && s.timerBadgeUrgent]}>
                <Icon
                  name={urgent ? 'timer-alert-outline' : 'timer-outline'}
                  size={14}
                  color={urgent ? C.red : C.textSub}
                />
                <Text style={[s.timerTxt, urgent && s.timerTxtUrgent]}>
                  {fmt(countdown)}
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={s.qrEmpty}>
            <Icon name="qrcode-remove" size={64} color={C.border} />
            <Text style={s.qrEmptyTxt}>
              {cardCodeVal === 0 ? 'Kart verisi bulunamadı' : 'QR süresi doldu'}
            </Text>
          </View>
        )}
      </View>

      {/* ── Renew button ── */}
      {cardCodeVal !== 0 && (
        <TouchableOpacity
          style={[s.renewBtn, renewing && {opacity: 0.6}]}
          onPress={_onRenew}
          disabled={renewing}
          activeOpacity={0.85}>
          {renewing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Icon
                name="refresh"
                size={18}
                color="#fff"
                style={{marginRight: 7}}
              />
              <Text style={s.renewTxt}>Sunucudan güncelle</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: C.bg},
  content: {alignItems: 'center', paddingHorizontal: 16},

  topBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    alignSelf: 'stretch',
  },
  logo: {height: 42, width: 160},
  cogBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: C.card,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW_SM,
  },

  // NFC / BLE cards
  statusRow: {width: '100%', flexDirection: 'row', gap: 12, marginBottom: 14},
  statusCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    borderRadius: 18,
    borderWidth: 1.5,
    gap: 8,
    minHeight: 80,
    ...SHADOW_SM,
  },
  statusCardIcon: {position: 'absolute', fontSize: 80, opacity: 0.1},
  statusCardLabel: {fontSize: 15, fontWeight: '700'},
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    opacity: 0.8,
    position: 'absolute',
    bottom: 8,
    right: 8,
  },

  statusBadgeTxt: {color: '#fff', fontSize: 11, fontWeight: '800'},
  statusCardSub: {
    fontSize: 10,
    color: C.textMuted,
    marginTop: 2,
    paddingHorizontal: 8,
    textAlign: 'center',
  },

  card: {
    width: '100%',
    backgroundColor: C.card,
    borderRadius: 20,
    marginBottom: 14,
    ...SHADOW_MD,
  },
  profileCard: {flexDirection: 'row', alignItems: 'center', padding: 16},
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.bg,
    marginRight: 14,
  },
  avatar: {width: '100%', height: '100%'},
  avatarFallback: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  fullName: {fontSize: 16, fontWeight: '700', color: C.text, lineHeight: 22},
  cardId: {fontSize: 12, color: C.textMuted, marginTop: 4, fontWeight: '500'},

  qrCard: {paddingVertical: 24, paddingHorizontal: 20, alignItems: 'center'},
  qrFrame: {
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: C.bg,
    borderRadius: 20,
  },
  timerBadgeUrgent: {backgroundColor: C.redBg},
  timerTxt: {fontSize: 15, fontWeight: '700', color: C.textSub},
  timerTxtUrgent: {color: C.red},
  qrEmpty: {alignItems: 'center', paddingVertical: 32, gap: 10},
  qrEmptyTxt: {fontSize: 14, color: C.textMuted, textAlign: 'center'},

  renewBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.blue,
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: C.blue,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 6,
  },
  renewTxt: {color: '#fff', fontSize: 15, fontWeight: '700'},
});
