// src/screens/CreateLoginScreen.tsx
// Mirrors settings_create_login.kt — email/TC → activation code → verify → save

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { sendAndReceive } from '../services/UdpClient';
import { getBluePassInfo, getPhoneIdHex, fetchFromServer } from '../services/CardStore';

const ACCENT = '#1e55a8';

type Step = 'input' | 'activation';

export default function CreateLoginScreen() {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation();

  const [step,            setStep]           = useState<Step>('input');
  const [email,           setEmail]          = useState('');
  const [tcNo,            setTcNo]           = useState('');
  const [activationCode,  setActivationCode] = useState('');
  const [password,        setPassword]       = useState('');
  const [loading,         setLoading]        = useState(false);

  // ─── Validation ───────────────────────────────────────────────────────────

  const isEmailValid    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isTcValid       = tcNo.length >= 8 && tcNo.length <= 12;
  const canSendMail     = isEmailValid && isTcValid;
  const isActValid      = activationCode.length >= 4 && activationCode.length <= 6;
  const isPassValid     = password.length >= 4 && password.length <= 8;
  const canVerify       = isActValid && isPassValid;

  // ─── Step 1: Send activation mail ─────────────────────────────────────────

  async function sendActivationMail() {
    setLoading(true);
    const res = await sendAndReceive(
      JSON.stringify({ apiname: 'sendMailforLogin', tcNo, eMail: email }),
    );
    setLoading(false);

    if (res.success) {
      setStep('activation');
      Alert.alert('Başarılı', 'Doğrulama kodu e-mail adresinize gönderildi');
    } else {
      Alert.alert('Hata', res.errorMessage);
    }
  }

  // ─── Step 2: Verify activation code ───────────────────────────────────────

  async function verifyEmail() {
    setLoading(true);
    const phoneID = await getPhoneIdHex();

    const res = await sendAndReceive(JSON.stringify({
      apiname:        'verifyEmail',
      tcNo,
      password,
      phoneID,
      activationCode,
      eMail:          email,
    }));

    if (!res.success) {
      setLoading(false);
      Alert.alert('Hata', res.errorMessage);
      return;
    }

    // Save credentials
    await AsyncStorage.multiSet([
      ['tcNo',   tcNo],
      ['e_mail', email],
      ['pword',  password],
    ]);

    // Fetch card + profile in parallel
    await Promise.all([
      fetchFromServer(),
      getBluePassInfo(tcNo),
    ]);

    setLoading(false);
    Alert.alert('Başarılı', 'Kayıt işlemi başarıyla tamamlandı');
    navigation.goBack();
    navigation.goBack(); // back to Main
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>‹ Geri</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Hesap Oluştur</Text>
          <View style={{ width: 60 }} />
        </View>

        {step === 'input' ? (
          <>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="E-mail"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <TextInput
              style={styles.input}
              value={tcNo}
              onChangeText={setTcNo}
              placeholder="TC no"
              keyboardType="number-pad"
              maxLength={12}
            />
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, !canSendMail && styles.btnDisabled]}
              onPress={sendActivationMail}
              disabled={!canSendMail || loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>Mail adresime kod gönder</Text>
              }
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              {email} adresine gönderilen kodu girin.
            </Text>
            <TextInput
              style={styles.input}
              value={activationCode}
              onChangeText={setActivationCode}
              placeholder="Doğrulama kodu"
              keyboardType="number-pad"
              maxLength={6}
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Kullanmak istediğiniz şifre"
              secureTextEntry
              maxLength={8}
            />
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, !canVerify && styles.btnDisabled]}
              onPress={verifyEmail}
              disabled={!canVerify || loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>Mail adresimi doğrula</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 24,
  },
  backBtn:  { padding: 8 },
  backText: { fontSize: 18, color: ACCENT },
  title:    { fontSize: 20, fontWeight: 'bold' },

  hint: { color: '#555', marginBottom: 16, lineHeight: 20 },

  input: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    padding: 12, marginBottom: 12, fontSize: 16, backgroundColor: '#fafafa',
  },

  btn: {
    borderRadius: 10, paddingVertical: 14, alignItems: 'center',
    marginTop: 8,
  },
  btnPrimary:  { backgroundColor: ACCENT },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#fff', fontSize: 15 },
});
