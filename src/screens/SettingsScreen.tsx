// src/screens/SettingsScreen.tsx
// Mirrors settings_main.kt — server connection, account controls, QR quality

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { sendAndReceive } from '../services/UdpClient';
import {
  getBluePassInfo, deleteUserAccount, getPhoneIdHex,
} from '../services/CardStore';
import RNFS from 'react-native-fs';

const ACCENT = '#1e55a8';
const QR_LEVELS = ['L', 'M', 'Q', 'H'] as const;

export default function SettingsScreen() {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [serverIp,       setServerIp]       = useState('192.168.1.10');
  const [serverPort,     setServerPort]      = useState('9000');
  const [serverConnected, setServerConnected] = useState(false);
  const [connecting,     setConnecting]      = useState(false);
  const [tcNo,           setTcNo]            = useState('');
  const [qrLevel,        setQrLevel]         = useState<typeof QR_LEVELS[number]>('L');

  // ─── Load saved prefs ─────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setServerIp((await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10');
      setServerPort((await AsyncStorage.getItem('server_port')) ?? '9000');
      setTcNo((await AsyncStorage.getItem('tcNo')) ?? '');
      setQrLevel(((await AsyncStorage.getItem('qr_quality')) ?? 'L') as typeof QR_LEVELS[number]);
    })();
  }, []);

  // Whenever IP/port changes, drop connection
  const onIpChange = (v: string) => { setServerIp(v); setServerConnected(false); };
  const onPortChange = (v: string) => { setServerPort(v); setServerConnected(false); };

  // ─── Connect to server ────────────────────────────────────────────────────

  const connectToServer = useCallback(async () => {
    const port = parseInt(serverPort, 10) || 9000;
    await AsyncStorage.setItem('server_ip', serverIp);
    await AsyncStorage.setItem('server_port', String(port));

    setConnecting(true);
    const res = await sendAndReceive(JSON.stringify({ apiname: 'test' }));
    setConnecting(false);

    if (res.success) {
      setServerConnected(true);
      Alert.alert('Başarılı', 'Sunucuya bağlanıldı');
    } else {
      setServerConnected(false);
      Alert.alert('Hata', res.errorMessage ?? 'Bağlantı başarısız');
    }
  }, [serverIp, serverPort]);

  // ─── QR quality ───────────────────────────────────────────────────────────

  async function selectQrLevel(level: typeof QR_LEVELS[number]) {
    setQrLevel(level);
    await AsyncStorage.setItem('qr_quality', level);
  }

  // ─── Update user info ─────────────────────────────────────────────────────

  async function updateUserInfo() {
    const ok = await getBluePassInfo(tcNo);
    if (ok) Alert.alert('Başarılı', 'Kişisel bilgileriniz güncellendi');
    else     Alert.alert('Hata', 'Güncelleme başarısız');
  }

  // ─── Delete account ───────────────────────────────────────────────────────

  function confirmDeleteAccount() {
    Alert.alert(
      'Dikkat',
      'Hesabınız silinecek. İşleme devam etmek istiyor musunuz?',
      [
        { text: 'Hayır', style: 'cancel' },
        {
          text: 'Evet',
          style: 'destructive',
          onPress: async () => {
            const phoneID = await getPhoneIdHex();
            const ok = await deleteUserAccount(tcNo, phoneID);
            if (ok) {
              // Clear all local data
              await AsyncStorage.multiRemove([
                'tcNo', 'e_mail', 'pword', 'fullName',
              ]);
              // Remove card file and photos
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

  // ─── Render ───────────────────────────────────────────────────────────────

  const isLoggedIn = tcNo.length > 0 && serverConnected;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Back + title */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Geri</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Ayarlar</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Server section */}
      <Text style={styles.sectionTitle}>Sunucu bilgileri</Text>

      <TextInput
        style={styles.input}
        value={serverIp}
        onChangeText={onIpChange}
        placeholder="Sunucu IP"
        keyboardType="decimal-pad"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        value={serverPort}
        onChangeText={onPortChange}
        placeholder="Sunucu port"
        keyboardType="number-pad"
      />

      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, connecting && styles.btnDisabled]}
        onPress={connectToServer}
        disabled={connecting}
      >
        {connecting
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Sunucuya bağlan</Text>
        }
      </TouchableOpacity>

      {/* Account section — only show when connected */}
      {serverConnected && (
        <>
          {!tcNo ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { marginTop: 48 }]}
              onPress={() => navigation.navigate('CreateLogin')}
            >
              <Text style={styles.btnText}>Hesap oluştur</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, { marginTop: 24 }]}
                onPress={updateUserInfo}
              >
                <Text style={styles.btnText}>Kişisel bilgilerimi güncelle</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnDanger, { marginTop: 16 }]}
                onPress={confirmDeleteAccount}
              >
                <Text style={styles.btnText}>Hesabımı sil</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {/* QR quality */}
      <Text style={[styles.sectionTitle, { marginTop: 32 }]}>QR Kalitesi</Text>
      <View style={styles.qrLevelRow}>
        {QR_LEVELS.map(level => (
          <TouchableOpacity
            key={level}
            style={[styles.qrLevelBtn, qrLevel === level && styles.qrLevelBtnActive]}
            onPress={() => selectQrLevel(level)}
          >
            <Text style={[styles.qrLevelText, qrLevel === level && styles.qrLevelTextActive]}>
              {level}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  backBtn:  { padding: 8 },
  backText: { fontSize: 18, color: ACCENT },
  title:    { fontSize: 20, fontWeight: 'bold', color: '#000' },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 10, marginTop: 8 },

  input: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    padding: 12, marginBottom: 10, fontSize: 16, backgroundColor: '#fafafa',
  },

  btn: {
    borderRadius: 10, paddingVertical: 14, paddingHorizontal: 20,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  btnPrimary:  { backgroundColor: ACCENT },
  btnDanger:   { backgroundColor: '#C62828' },
  btnDisabled: { opacity: 0.6 },
  btnText:     { color: '#fff', fontSize: 15 },

  qrLevelRow: { flexDirection: 'row', gap: 10 },
  qrLevelBtn: {
    width: 56, height: 44,
    borderRadius: 8, borderWidth: 1.5, borderColor: '#ccc',
    justifyContent: 'center', alignItems: 'center',
  },
  qrLevelBtnActive:  { borderColor: ACCENT, backgroundColor: ACCENT },
  qrLevelText:       { fontSize: 16, color: '#555' },
  qrLevelTextActive: { color: '#fff', fontWeight: 'bold' },
});
