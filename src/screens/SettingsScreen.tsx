// src/screens/SettingsScreen.tsx

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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {sendAndReceive} from '../services/UdpClient';
import {
  getBluePassInfo,
  deleteUserAccount,
  getPhoneIdHex,
} from '../services/CardStore';
import RNFS from 'react-native-fs';

const C = {
  bg: '#EEF2F7',
  card: '#FFFFFF',
  blue: '#1A56DB',
  red: '#DC2626',
  text: '#0F172A',
  textSub: '#64748B',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  green: '#059669',
  greenBg: '#ECFDF5',
};
const SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.07,
  shadowRadius: 12,
  shadowOffset: {width: 0, height: 3},
  elevation: 4,
};

const QR_LEVELS = ['L', 'M', 'Q', 'H'] as const;
type QrLevel = (typeof QR_LEVELS)[number];

const QR_HINTS: Record<QrLevel, string> = {
  L: 'Düşük hata düzeltme — daha küçük, daha kolay okunur QR',
  M: 'Orta hata düzeltme',
  Q: 'Yüksek hata düzeltme',
  H: 'En yüksek hata düzeltme — daha büyük QR',
};

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [serverIp, setServerIp] = useState('192.168.1.10');
  const [serverPort, setServerPort] = useState('9000');
  const [serverConnected, setServerConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tcNo, setTcNo] = useState('');
  const [qrLevel, setQrLevel] = useState<QrLevel>('L');

  useEffect(() => {
    (async () => {
      setServerIp((await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10');
      setServerPort((await AsyncStorage.getItem('server_port')) ?? '9000');
      setTcNo((await AsyncStorage.getItem('tcNo')) ?? '');
      setQrLevel(
        ((await AsyncStorage.getItem('qr_quality')) ?? 'L') as QrLevel,
      );
    })();
  }, []);

  const onIpChange = (v: string) => {
    setServerIp(v);
    setServerConnected(false);
  };
  const onPortChange = (v: string) => {
    setServerPort(v);
    setServerConnected(false);
  };

  const _connect = useCallback(async () => {
    const ip = serverIp.trim();
    const port = parseInt(serverPort, 10) || 9000;
    if (!ip) {
      Alert.alert('Hata', 'IP adresi boş olamaz');
      return;
    }
    await AsyncStorage.multiSet([
      ['server_ip', ip],
      ['server_port', String(port)],
    ]);
    setConnecting(true);
    const res = await sendAndReceive(
      JSON.stringify({apiname: 'test'}),
      ip,
      port,
    );
    setConnecting(false);
    if (res.success) {
      setServerConnected(true);
      Alert.alert('Başarılı', 'Sunucuya bağlanıldı');
    } else {
      setServerConnected(false);
      Alert.alert('Hata', res.errorMessage ?? 'Bağlantı başarısız');
    }
  }, [serverIp, serverPort]);

  async function _selectQrLevel(lvl: QrLevel) {
    setQrLevel(lvl);
    await AsyncStorage.setItem('qr_quality', lvl);
  }

  async function _updateUserInfo() {
    const ok = await getBluePassInfo(tcNo);
    Alert.alert(
      ok ? 'Başarılı' : 'Hata',
      ok ? 'Bilgiler güncellendi' : 'Güncelleme başarısız',
    );
  }

  function _confirmDelete() {
    Alert.alert(
      'Hesabı Sil',
      'Bu işlem geri alınamaz. Devam etmek istiyor musunuz?',
      [
        {text: 'Vazgeç', style: 'cancel'},
        {
          text: 'Sil',
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
              const cf = `${RNFS.DocumentDirectoryPath}/carddata.bin`;
              if (await RNFS.exists(cf)) await RNFS.unlink(cf);
              const dir = await RNFS.readDir(RNFS.DocumentDirectoryPath);
              for (const f of dir)
                if (f.name.startsWith('photo.')) await RNFS.unlink(f.path);
              Alert.alert('Başarılı', 'Hesabınız silindi');
              navigation.goBack();
            } else Alert.alert('Hata', 'Hesap silinemedi');
          },
        },
      ],
    );
  }

  const showConnect = !serverConnected;
  const showCreateLogin = serverConnected && !tcNo;
  const showUpdateDelete = serverConnected && !!tcNo;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[
        s.content,
        {paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40},
      ]}
      keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={s.title}>Ayarlar</Text>
        <View style={{width: 42}} />
      </View>

      {/* ── Server section ── */}
      <Text style={s.sectionLabel}>SUNUCU BAĞLANTISI</Text>
      <View style={s.card}>
        {serverConnected && (
          <View style={s.connectedBanner}>
            <Icon name="check-circle" size={15} color={C.green} />
            <Text style={s.connectedTxt}>Sunucuya bağlı</Text>
          </View>
        )}
        <View style={s.inputRow}>
          <Icon
            name="ip-network-outline"
            size={18}
            color={C.textMuted}
            style={s.inputIcon}
          />
          <TextInput
            style={s.input}
            value={serverIp}
            onChangeText={onIpChange}
            placeholder="192.168.1.10"
            placeholderTextColor={C.textMuted}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={s.divider} />
        <View style={s.inputRow}>
          <Icon
            name="router-network-outline"
            size={18}
            color={C.textMuted}
            style={s.inputIcon}
          />
          <TextInput
            style={s.input}
            value={serverPort}
            onChangeText={onPortChange}
            placeholder="9000"
            placeholderTextColor={C.textMuted}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {showConnect && (
        <TouchableOpacity
          style={[s.btn, connecting && {opacity: 0.6}]}
          onPress={_connect}
          disabled={connecting}>
          {connecting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Icon
                name="lan-connect"
                size={18}
                color="#fff"
                style={{marginRight: 8}}
              />
              <Text style={s.btnTxt}>Sunucuya bağlan</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* ── Account section ── */}
      {(showCreateLogin || showUpdateDelete) && (
        <>
          <Text style={[s.sectionLabel, {marginTop: 20}]}>HESAP</Text>
          {showCreateLogin && (
            <TouchableOpacity
              style={s.btn}
              onPress={() => navigation.navigate('CreateLogin')}>
              <Icon
                name="account-plus-outline"
                size={18}
                color="#fff"
                style={{marginRight: 8}}
              />
              <Text style={s.btnTxt}>Hesap oluştur / giriş yap</Text>
            </TouchableOpacity>
          )}
          {showUpdateDelete && (
            <>
              <TouchableOpacity style={s.btn} onPress={_updateUserInfo}>
                <Icon
                  name="account-sync-outline"
                  size={18}
                  color="#fff"
                  style={{marginRight: 8}}
                />
                <Text style={s.btnTxt}>Kişisel bilgileri güncelle</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, s.btnDanger, {marginTop: 10}]}
                onPress={_confirmDelete}>
                <Icon
                  name="account-remove-outline"
                  size={18}
                  color="#fff"
                  style={{marginRight: 8}}
                />
                <Text style={s.btnTxt}>Hesabı sil</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {/* ── QR Quality ── */}
      <Text style={[s.sectionLabel, {marginTop: 20}]}>QR KALİTESİ</Text>
      <View style={s.card}>
        <View style={s.qrRow}>
          {QR_LEVELS.map(lvl => (
            <TouchableOpacity
              key={lvl}
              style={[s.qrBtn, qrLevel === lvl && s.qrBtnActive]}
              onPress={() => _selectQrLevel(lvl)}>
              <Text style={[s.qrBtnTxt, qrLevel === lvl && s.qrBtnTxtActive]}>
                {lvl}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.qrHint}>{QR_HINTS[qrLevel]}</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: C.bg},
  content: {paddingHorizontal: 16},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: C.card,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },
  title: {fontSize: 18, fontWeight: '800', color: C.text},

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },

  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    overflow: 'hidden',
    ...SHADOW,
    marginBottom: 4,
  },

  connectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    backgroundColor: C.greenBg,
    borderBottomWidth: 1,
    borderBottomColor: '#D1FAE5',
  },
  connectedTxt: {fontSize: 13, fontWeight: '600', color: C.green},

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {marginRight: 10},
  input: {flex: 1, fontSize: 15, color: C.text},
  divider: {height: 1, backgroundColor: C.border, marginHorizontal: 14},

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.blue,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 10,
    shadowColor: C.blue,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 3},
    elevation: 5,
  },
  btnDanger: {backgroundColor: C.red, shadowColor: C.red},
  btnTxt: {color: '#fff', fontSize: 15, fontWeight: '700'},

  qrRow: {flexDirection: 'row', padding: 14, gap: 10},
  qrBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrBtnActive: {backgroundColor: C.blue, borderColor: C.blue},
  qrBtnTxt: {fontSize: 16, fontWeight: '600', color: C.textSub},
  qrBtnTxtActive: {color: '#fff'},
  qrHint: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center',
    paddingBottom: 14,
    paddingHorizontal: 14,
  },
});
