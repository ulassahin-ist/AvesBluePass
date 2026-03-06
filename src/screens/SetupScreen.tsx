// src/screens/SetupScreen.tsx

import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {sendAndReceive} from '../services/UdpClient';
import {
  getBluePassInfo,
  getPhoneIdHex,
  fetchFromServer,
} from '../services/CardStore';

const C = {
  bg: '#EEF2F7',
  card: '#FFFFFF',
  blue: '#1A56DB',
  green: '#059669',
  greenBg: '#ECFDF5',
  text: '#0F172A',
  textSub: '#64748B',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
};
const SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.07,
  shadowRadius: 12,
  shadowOffset: {width: 0, height: 3},
  elevation: 4,
};

type Step = 'server' | 'account' | 'activation' | 'done';

const STEP_LABELS = ['Sunucu', 'Hesap', 'Doğrulama', 'Tamamlandı'];
const STEP_KEYS: Step[] = ['server', 'account', 'activation', 'done'];

function stepIndex(s: Step) {
  return STEP_KEYS.indexOf(s);
}

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [step, setStep] = useState<Step>('server');

  // Server step
  const [serverIp, setServerIp] = useState('192.168.1.10');
  const [serverPort, setServerPort] = useState('9000');
  const [connecting, setConnecting] = useState(false);

  // Account step
  const [email, setEmail] = useState('');
  const [tcNo, setTcNo] = useState('');
  const [loading, setLoading] = useState(false);

  // Activation step
  const [activationCode, setActivationCode] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    (async () => {
      setServerIp((await AsyncStorage.getItem('server_ip')) ?? '192.168.1.10');
      setServerPort((await AsyncStorage.getItem('server_port')) ?? '9000');
    })();
  }, []);

  // Validation
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isTcValid = tcNo.length >= 8 && tcNo.length <= 12;
  const canSendActivation = isEmailValid && isTcValid;
  const isActValid = activationCode.length >= 4 && activationCode.length <= 6;
  const isPassValid = password.length >= 4 && password.length <= 8;
  const canVerify = isActValid && isPassValid;

  async function _connect() {
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
      await AsyncStorage.setItem('server_connected', '1');
      setStep('account');
    } else {
      Alert.alert('Hata', res.errorMessage ?? 'Bağlantı başarısız');
    }
  }

  async function _sendActivation() {
    setLoading(true);
    const res = await sendAndReceive(
      JSON.stringify({apiname: 'sendMailforLogin', tcNo, eMail: email}),
    );
    setLoading(false);
    if (res.success) {
      setStep('activation');
      Alert.alert(
        'Kod gönderildi',
        'Doğrulama kodu e-posta adresinize gönderildi',
      );
    } else {
      Alert.alert('Hata', res.errorMessage ?? 'Bilinmeyen hata');
    }
  }

  async function _checkActivation() {
    setLoading(true);
    const phoneID = await getPhoneIdHex();
    const res = await sendAndReceive(
      JSON.stringify({
        apiname: 'verifyEmail',
        tcNo,
        password,
        phoneID,
        activationCode,
        eMail: email,
      }),
    );
    if (!res.success) {
      setLoading(false);
      Alert.alert('Hata', res.errorMessage ?? 'Bilinmeyen hata');
      return;
    }
    await AsyncStorage.multiSet([
      ['tcNo', tcNo],
      ['e_mail', email],
      ['pword', password],
    ]);
    await fetchFromServer();
    await getBluePassInfo(tcNo);
    setLoading(false);
    setStep('done');
    setTimeout(() => {
      navigation.goBack();
    }, 2000);
  }

  const currentIndex = stepIndex(step);

  return (
    <KeyboardAvoidingView
      style={{flex: 1}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.root}
        contentContainerStyle={[
          s.content,
          {paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40},
        ]}
        keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.goBack()}>
            <Icon name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={s.title}>Kurulum</Text>
          <View style={{width: 42}} />
        </View>

        {/* Progress bar */}
        <View style={s.progressRow}>
          {STEP_LABELS.map((label, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <React.Fragment key={label}>
                <View style={s.progressStep}>
                  <View
                    style={[
                      s.progressDot,
                      done && s.progressDotDone,
                      active && s.progressDotActive,
                    ]}>
                    {done ? (
                      <Icon name="check" size={10} color="#fff" />
                    ) : (
                      <Text
                        style={[s.progressDotTxt, active && {color: '#fff'}]}>
                        {i + 1}
                      </Text>
                    )}
                  </View>
                  <Text
                    style={[
                      s.progressLabel,
                      active && s.progressLabelActive,
                      done && s.progressLabelDone,
                    ]}>
                    {label}
                  </Text>
                </View>
                {i < STEP_LABELS.length - 1 && (
                  <View
                    style={[
                      s.progressLine,
                      (done || active) &&
                        i < currentIndex &&
                        s.progressLineDone,
                    ]}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>

        <View style={{height: 28}} />

        {/* ── Step 1: Server ── */}
        {step === 'server' && (
          <>
            <Text style={s.stepTitle}>Sunucu Bağlantısı</Text>
            <Text style={s.stepSub}>
              Uygulamanın bağlanacağı sunucu bilgilerini gir
            </Text>
            <View style={{height: 16}} />
            <View style={s.card}>
              <View style={s.inputWrap}>
                <Icon
                  name="ip-network-outline"
                  size={18}
                  color={C.textMuted}
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={serverIp}
                  onChangeText={setServerIp}
                  placeholder="192.168.1.10"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={s.divider} />
              <View style={s.inputWrap}>
                <Icon
                  name="router-network"
                  size={18}
                  color={C.textMuted}
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={serverPort}
                  onChangeText={setServerPort}
                  placeholder="9000"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <TouchableOpacity
              style={[s.btn, connecting && {opacity: 0.6}]}
              onPress={_connect}
              disabled={connecting}
              activeOpacity={0.85}>
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
          </>
        )}

        {/* ── Step 2: Account info ── */}
        {step === 'account' && (
          <>
            <Text style={s.stepTitle}>Hesap Bilgileri</Text>
            <Text style={s.stepSub}>E-posta ve TC kimlik numaranı gir</Text>
            <View style={{height: 16}} />
            <View style={s.card}>
              <View style={s.inputWrap}>
                <Icon
                  name="email-outline"
                  size={18}
                  color={C.textMuted}
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="E-posta adresi"
                  placeholderTextColor={C.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={s.divider} />
              <View style={s.inputWrap}>
                <Icon
                  name="card-account-details-outline"
                  size={18}
                  color={C.textMuted}
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={tcNo}
                  onChangeText={setTcNo}
                  placeholder="TC Kimlik No"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={12}
                />
              </View>
            </View>
            <TouchableOpacity
              style={[
                s.btn,
                (!canSendActivation || loading) && {opacity: 0.45},
              ]}
              onPress={_sendActivation}
              disabled={!canSendActivation || loading}
              activeOpacity={0.85}>
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Icon
                    name="send-outline"
                    size={18}
                    color="#fff"
                    style={{marginRight: 8}}
                  />
                  <Text style={s.btnTxt}>Aktivasyon kodu gönder</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 3: Activation ── */}
        {step === 'activation' && (
          <>
            <Text style={s.stepTitle}>Doğrulama</Text>
            <Text style={s.stepSub}>E-postana gelen kodu ve şifreni gir</Text>
            <View style={{height: 16}} />
            <View style={s.card}>
              <View style={s.inputWrap}>
                <Icon
                  name="shield-key-outline"
                  size={18}
                  color={C.textMuted}
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={activationCode}
                  onChangeText={setActivationCode}
                  placeholder="Aktivasyon kodu"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>
              <View style={s.divider} />
              <View style={s.inputWrap}>
                <Icon
                  name="lock-outline"
                  size={18}
                  color={C.textMuted}
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Şifre"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry
                  maxLength={8}
                />
              </View>
            </View>
            <TouchableOpacity
              style={[s.btn, (!canVerify || loading) && {opacity: 0.45}]}
              onPress={_checkActivation}
              disabled={!canVerify || loading}
              activeOpacity={0.85}>
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Icon
                    name="check-circle-outline"
                    size={18}
                    color="#fff"
                    style={{marginRight: 8}}
                  />
                  <Text style={s.btnTxt}>Aktivasyon kodunu doğrula</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.backLink}
              onPress={() => setStep('account')}>
              <Icon name="arrow-left" size={14} color={C.textSub} />
              <Text style={s.backLinkTxt}>Bilgileri düzenle</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 4: Done ── */}
        {step === 'done' && (
          <View style={s.doneWrap}>
            <View style={s.doneIcon}>
              <Icon name="check-circle" size={64} color={C.green} />
            </View>
            <Text style={s.doneTitle}>Kurulum Tamamlandı!</Text>
            <Text style={s.doneSub}>Ana ekrana yönlendiriliyorsunuz...</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: C.bg},
  content: {paddingHorizontal: 16},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
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

  // Progress bar
  progressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
  },
  progressStep: {alignItems: 'center', gap: 6},
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressDotActive: {backgroundColor: C.blue},
  progressDotDone: {backgroundColor: C.green},
  progressDotTxt: {fontSize: 12, fontWeight: '700', color: C.textMuted},
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: C.border,
    marginTop: 13,
    marginHorizontal: 4,
  },
  progressLineDone: {backgroundColor: C.green},
  progressLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textMuted,
    textAlign: 'center',
  },
  progressLabelActive: {color: C.blue},
  progressLabelDone: {color: C.green},

  stepTitle: {fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 6},
  stepSub: {fontSize: 13, color: C.textMuted, lineHeight: 19},

  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    overflow: 'hidden',
    ...SHADOW,
    marginBottom: 16,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 54,
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
    paddingVertical: 16,
    shadowColor: C.blue,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 3},
    elevation: 5,
  },
  btnTxt: {color: '#fff', fontSize: 15, fontWeight: '700'},

  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  backLinkTxt: {fontSize: 13, color: C.textSub, fontWeight: '500'},

  doneWrap: {alignItems: 'center', paddingTop: 40, gap: 16},
  doneIcon: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: C.greenBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneTitle: {fontSize: 22, fontWeight: '800', color: C.text},
  doneSub: {fontSize: 14, color: C.textMuted},
});
