// src/screens/CreateLoginScreen.tsx

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

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isTcValid = tcNo.length >= 8 && tcNo.length <= 12;
  const canSend = isEmailValid && isTcValid;
  const isActValid = activationCode.length >= 4 && activationCode.length <= 6;
  const isPassValid = password.length >= 4 && password.length <= 8;
  const canVerify = isActValid && isPassValid;

  async function _sendActivation() {
    setLoading(true);
    const res = await sendAndReceive(
      JSON.stringify({apiname: 'sendMailforLogin', tcNo, eMail: email}),
    );
    setLoading(false);
    if (res.success) {
      setStep('activation');
      setActivationCode('');
      setPassword('');
      Alert.alert(
        'Kod gönderildi',
        'Doğrulama kodu e-posta adresinize gönderildi',
      );
    } else Alert.alert('Hata', res.errorMessage ?? 'Bilinmeyen hata');
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
    const infoOk = await getBluePassInfo(tcNo);
    setLoading(false);
    if (infoOk) {
      Alert.alert('Başarılı', 'Kayıt tamamlandı');
      navigation.goBack();
      navigation.goBack();
    }
  }

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
          <Text style={s.title}>
            {step === 'input' ? 'Hesap Oluştur' : 'Doğrulama'}
          </Text>
          <View style={{width: 42}} />
        </View>

        {/* Step indicator */}
        <View style={s.stepRow}>
          <View style={[s.stepDot, s.stepDotActive]} />
          <View
            style={[s.stepLine, step === 'activation' && s.stepLineActive]}
          />
          <View style={[s.stepDot, step === 'activation' && s.stepDotActive]} />
        </View>
        <View style={s.stepLabels}>
          <Text style={[s.stepLabel, s.stepLabelActive]}>Bilgiler</Text>
          <Text
            style={[s.stepLabel, step === 'activation' && s.stepLabelActive]}>
            Doğrulama
          </Text>
        </View>

        <View style={{height: 24}} />

        {/* Step 1 */}
        {step === 'input' && (
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
        )}

        {/* Step 2 */}
        {step === 'activation' && (
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
        )}

        {/* Action button */}
        <TouchableOpacity
          style={[
            s.btn,
            ((step === 'input' ? !canSend : !canVerify) || loading) && {
              opacity: 0.45,
            },
          ]}
          onPress={step === 'input' ? _sendActivation : _checkActivation}
          disabled={(step === 'input' ? !canSend : !canVerify) || loading}
          activeOpacity={0.85}>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Icon
                name={
                  step === 'input' ? 'send-outline' : 'check-circle-outline'
                }
                size={18}
                color="#fff"
                style={{marginRight: 8}}
              />
              <Text style={s.btnTxt}>
                {step === 'input'
                  ? 'Aktivasyon kodu gönder'
                  : 'Aktivasyon kodunu doğrula'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {step === 'activation' && (
          <TouchableOpacity style={s.backLink} onPress={() => setStep('input')}>
            <Icon name="arrow-left" size={14} color={C.textSub} />
            <Text style={s.backLinkTxt}>Bilgileri düzenle</Text>
          </TouchableOpacity>
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

  stepRow: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8},
  stepDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: C.border},
  stepDotActive: {backgroundColor: C.blue},
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: C.border,
    marginHorizontal: 6,
  },
  stepLineActive: {backgroundColor: C.blue},
  stepLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 6,
  },
  stepLabel: {fontSize: 11, fontWeight: '600', color: C.textMuted},
  stepLabelActive: {color: C.blue},

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
});
