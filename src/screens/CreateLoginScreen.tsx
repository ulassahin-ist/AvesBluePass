// src/screens/CreateLoginScreen.tsx
// UI mirrors settings_create_login.kt exactly

import React, {useState} from 'react';
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
import {sendAndReceive} from '../services/UdpClient';
import {
  getBluePassInfo,
  getPhoneIdHex,
  fetchFromServer,
} from '../services/CardStore';

const ACCENT = '#1565C0';

// Two steps — mirrors the Kotlin visibility toggling:
// Step 1: email + tcNo visible, activation fields GONE
// Step 2: email + tcNo GONE, activation fields visible
type Step = 'input' | 'activation';

export default function CreateLoginScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [step, setStep] = useState<Step>('input');
  const [email, setEmail] = useState('');
  const [tcNo, setTcNo] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // ── validation (mirrors _Send_Activation_Input_Control / _Check_Activation_Input_Control) ──
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isTcValid = tcNo.length >= 8 && tcNo.length <= 12;
  const canSend = isEmailValid && isTcValid;

  const isActValid = activationCode.length >= 4 && activationCode.length <= 6;
  const isPassValid = password.length >= 4 && password.length <= 8;
  const canVerify = isActValid && isPassValid;

  // ── Step 1: send activation mail ──────────────────────────────────────────
  async function _sendActivation() {
    setLoading(true);
    const res = await sendAndReceive(
      JSON.stringify({apiname: 'sendMailforLogin', tcNo, eMail: email}),
    );
    setLoading(false);

    if (res.success) {
      // Show activation fields, hide email/tc fields (mirrors Kotlin visibility changes)
      setStep('activation');
      setActivationCode('');
      setPassword('');
      Alert.alert('Başarılı', 'Doğrulama kodu e-mail adresinize gönderildi');
    } else {
      Alert.alert('Hata', res.errorMessage ?? 'Bilinmeyen hata');
    }
  }

  // ── Step 2: verify activation code ───────────────────────────────────────
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

    // Save credentials
    await AsyncStorage.multiSet([
      ['tcNo', tcNo],
      ['e_mail', email],
      ['pword', password],
    ]);

    // Fetch card + profile (mirrors Kotlin: __GET_FROM_SERVER + _Get_BluePass_Inf)
    await fetchFromServer();
    const infoOk = await getBluePassInfo(tcNo);

    setLoading(false);

    if (infoOk) {
      Alert.alert('Başarılı', 'Kayıt işlemi başarılı bir şekilde tamamlandı');
      // Pop back to Main (mirrors FLAG_ACTIVITY_CLEAR_TOP + finish())
      navigation.goBack();
      navigation.goBack();
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{flex: 1}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          <Text style={styles.toolbarTitle}>Hesap Oluştur</Text>
          <View style={styles.toolbarSpacer} />
        </View>

        {/* ── STEP 1: email + TC ── */}
        {step === 'input' && (
          <>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="E-mail"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholderTextColor="#BDBDBD"
            />

            <TextInput
              style={styles.input}
              value={tcNo}
              onChangeText={setTcNo}
              placeholder="TC Kimlik No"
              keyboardType="number-pad"
              maxLength={12}
              placeholderTextColor="#BDBDBD"
            />

            <TouchableOpacity
              style={[styles.btn, !canSend && styles.btnDisabled]}
              onPress={_sendActivation}
              disabled={!canSend || loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Aktivasyon kodu gönder</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* ── STEP 2: activation code + password ── */}
        {step === 'activation' && (
          <>
            <TextInput
              style={styles.input}
              value={activationCode}
              onChangeText={setActivationCode}
              placeholder="Aktivasyon kodu"
              keyboardType="number-pad"
              maxLength={6}
              placeholderTextColor="#BDBDBD"
            />

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Şifre"
              secureTextEntry
              maxLength={8}
              placeholderTextColor="#BDBDBD"
            />

            <TouchableOpacity
              style={[styles.btn, !canVerify && styles.btnDisabled]}
              onPress={_checkActivation}
              disabled={!canVerify || loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Aktivasyon kodunu doğrula</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#fff'},
  content: {paddingHorizontal: 16},

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backBtn: {paddingRight: 16, paddingVertical: 4},
  backText: {fontSize: 28, color: ACCENT, lineHeight: 32},
  toolbarTitle: {fontSize: 20, fontWeight: 'bold', color: '#000'},
  toolbarSpacer: {flex: 1},

  input: {
    borderWidth: 1,
    borderColor: '#BDBDBD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
    color: '#000',
    marginBottom: 12,
  },

  btn: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {opacity: 0.45},
  btnText: {color: '#fff', fontSize: 15, fontWeight: '600'},
});
