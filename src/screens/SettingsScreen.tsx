// src/screens/SettingsScreen.tsx
// UI mirrors settings_main.kt exactly

import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {sendAndReceive} from '../services/UdpClient';
import {
  getBluePassInfo,
  deleteUserAccount,
  getPhoneIdHex,
} from '../services/CardStore';
import RNFS from 'react-native-fs';

const ACCENT = '#1565C0';
const DANGER = '#C62828';
const QR_LEVELS = ['L', 'M', 'Q', 'H'] as const;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [serverIp, setServerIp] = useState('192.168.1.10');
  const [serverPort, setServerPort] = useState('9000');
  const [serverConnected, setServerConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tcNo, setTcNo] = useState('');
  const [qrLevel, setQrLevel] = useState<(typeof QR_LEVELS)[number]>('L');

  // ── load saved prefs only — no auto-connect ───────────────────────────────
  useEffect(() => {
    (async () => {
      setServerIp((await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10');
      setServerPort((await AsyncStorage.getItem('server_port')) ?? '9000');
      setTcNo((await AsyncStorage.getItem('tcNo')) ?? '');
      setQrLevel(
        ((await AsyncStorage.getItem('qr_quality')) ??
          'L') as (typeof QR_LEVELS)[number],
      );
    })();
  }, []);

  // ── IP / port change resets connection (mirrors doAfterTextChanged) ────────
  const onIpChange = (v: string) => {
    setServerIp(v);
    setServerConnected(false);
  };
  const onPortChange = (v: string) => {
    setServerPort(v);
    setServerConnected(false);
  };

  // ── connect ───────────────────────────────────────────────────────────────
  const _connectToServer = useCallback(async () => {
    const port = parseInt(serverPort, 10) || 9000;
    await AsyncStorage.setItem('server_ip', serverIp);
    await AsyncStorage.setItem('server_port', String(port));

    setConnecting(true);
    const res = await sendAndReceive(JSON.stringify({apiname: 'test'}));
    setConnecting(false);

    if (res.success) {
      setServerConnected(true);
      Alert.alert('Başarılı', 'Sunucuya bağlanıldı');
    } else {
      setServerConnected(false);
      Alert.alert('Hata', res.errorMessage ?? 'Bağlantı başarısız');
    }
  }, [serverIp, serverPort]);

  // ── update user info ──────────────────────────────────────────────────────
  async function _updateUserInfo() {
    const ok = await getBluePassInfo(tcNo);
    if (ok) Alert.alert('Başarılı', 'Kişisel bilgileriniz güncellendi');
    else Alert.alert('Hata', 'Güncelleme başarısız');
  }

  // ── delete account ────────────────────────────────────────────────────────
  function _confirmDelete() {
    Alert.alert(
      'Dikkat',
      'Hesabınız silinecek. İşleme devam etmek istiyor musunuz?',
      [
        {text: 'Hayır', style: 'cancel'},
        {
          text: 'Evet',
          style: 'destructive',
          onPress: async () => {
            const phoneID = await getPhoneIdHex();
            const ok = await deleteUserAccount(tcNo, phoneID);
            if (ok) {
              await AsyncStorage.multiRemove([
                'tcNo',
                'e_mail',
                'pword',
                'fullName',
                'qr_quality',
              ]);
              const cardFile = `${RNFS.DocumentDirectoryPath}/carddata.bin`;
              if (await RNFS.exists(cardFile)) await RNFS.unlink(cardFile);
              const dir = await RNFS.readDir(RNFS.DocumentDirectoryPath);
              for (const f of dir) {
                if (f.name.startsWith('photo.')) await RNFS.unlink(f.path);
              }
              Alert.alert('Başarılı', 'Hesabınız silindi');
              navigation.goBack();
            } else {
              Alert.alert('Hata', 'Hesap silinemedi');
            }
          },
        },
      ],
    );
  }

  // ── QR level ──────────────────────────────────────────────────────────────
  async function _selectQrLevel(level: (typeof QR_LEVELS)[number]) {
    setQrLevel(level);
    await AsyncStorage.setItem('qr_quality', level);
  }

  // ── visibility logic (mirrors _Enable_Control) ────────────────────────────
  const showConnectBtn = !serverConnected;
  const showCreateLogin = serverConnected && !tcNo;
  const showUpdateDelete = serverConnected && !!tcNo;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32},
      ]}
      keyboardShouldPersistTaps="handled">
      {/* ── Toolbar ── */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.toolbarTitle}>Ayarlar</Text>
        <View style={styles.toolbarSpacer} />
      </View>

      {/* ── Server IP ── */}
      <Text style={styles.fieldLabel}>Sunucu IP</Text>
      <TextInput
        style={styles.input}
        value={serverIp}
        onChangeText={onIpChange}
        placeholder="192.168.1.10"
        keyboardType="decimal-pad"
        autoCapitalize="none"
      />

      {/* ── Server Port ── */}
      <Text style={styles.fieldLabel}>Sunucu Port</Text>
      <TextInput
        style={styles.input}
        value={serverPort}
        onChangeText={onPortChange}
        placeholder="9000"
        keyboardType="number-pad"
      />

      {/* ── Connect button — hidden when connected ── */}
      {showConnectBtn && (
        <TouchableOpacity
          style={[
            styles.btn,
            styles.btnPrimary,
            connecting && styles.btnDisabled,
          ]}
          onPress={_connectToServer}
          disabled={connecting}>
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Sunucuya bağlan</Text>
          )}
        </TouchableOpacity>
      )}

      {/* ── Create login — shown when connected + no account ── */}
      {showCreateLogin && (
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, {marginTop: 24}]}
          onPress={() => navigation.navigate('CreateLogin')}>
          <Text style={styles.btnText}>Hesap oluştur / giriş yap</Text>
        </TouchableOpacity>
      )}

      {/* ── Update + Delete — shown when connected + has account ── */}
      {showUpdateDelete && (
        <>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, {marginTop: 24}]}
            onPress={_updateUserInfo}>
            <Text style={styles.btnText}>Kişisel bilgilerimi güncelle</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnDanger, {marginTop: 12}]}
            onPress={_confirmDelete}>
            <Text style={styles.btnText}>Hesabımı sil</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── QR quality selector ── */}
      <Text style={[styles.fieldLabel, {marginTop: 32}]}>QR Kalitesi</Text>
      <View style={styles.qrRow}>
        {QR_LEVELS.map(level => (
          <TouchableOpacity
            key={level}
            style={[styles.qrBtn, qrLevel === level && styles.qrBtnActive]}
            onPress={() => _selectQrLevel(level)}>
            <Text
              style={[
                styles.qrBtnText,
                qrLevel === level && styles.qrBtnTextActive,
              ]}>
              {level}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#fff'},
  content: {paddingHorizontal: 16},

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {paddingRight: 16, paddingVertical: 4},
  backText: {fontSize: 28, color: ACCENT, lineHeight: 32},
  toolbarTitle: {fontSize: 20, fontWeight: 'bold', color: '#000'},
  toolbarSpacer: {flex: 1},

  fieldLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
    marginTop: 14,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  input: {
    borderWidth: 1,
    borderColor: '#BDBDBD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
    color: '#000',
  },

  btn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  btnPrimary: {backgroundColor: ACCENT},
  btnDanger: {backgroundColor: DANGER},
  btnDisabled: {opacity: 0.5},
  btnText: {color: '#fff', fontSize: 15, fontWeight: '600'},

  qrRow: {flexDirection: 'row', gap: 10, marginTop: 8},
  qrBtn: {
    width: 54,
    height: 44,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#BDBDBD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrBtnActive: {backgroundColor: ACCENT, borderColor: ACCENT},
  qrBtnText: {fontSize: 16, color: '#555', fontWeight: '500'},
  qrBtnTextActive: {color: '#fff', fontWeight: 'bold'},
});
