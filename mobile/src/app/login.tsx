import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, ErrorText, Row, Tile, Wrap } from '@/components/ui';
import { homeFor, useAuth } from '@/lib/auth';
import { LANGS, setLang, t } from '@/lib/i18n';
import { C, SP } from '@/lib/theme';
import type { Lang } from '@/lib/types';

export default function Login() {
  const auth = useAuth();
  const [lang, setL] = useState<Lang>('hi');
  const [step, setStep] = useState<'mobile' | 'otp' | 'company'>('mobile');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [passCode, setPassCode] = useState('');
  const otpRef = useRef<TextInput>(null);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setTimeout(() => setTimer(timer - 1), 1000);
    return () => clearTimeout(id);
  }, [timer]);

  useEffect(() => {
    if (auth.user) router.replace(homeFor(auth.role) as never);
  }, [auth.user, auth.role]);

  const chooseLang = (l: Lang) => {
    setL(l);
    setLang(l);
  };

  const send = async () => {
    setErr(null);
    setBusy(true);
    try {
      await auth.requestOtp(mobile);
      setStep('otp');
      setCode('');
      setTimer(30);
      setTimeout(() => otpRef.current?.focus(), 300);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c = code, companyId?: string) => {
    setErr(null);
    setBusy(true);
    try {
      const r = await auth.verifyOtp(mobile, c, companyId);
      if (r.choose_company) {
        setCompanies(r.choose_company);
        setPassCode(r.code || '');
        setStep('company');
      }
    } catch (e) {
      setErr((e as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.primary }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ padding: SP.xl, paddingTop: 48, alignItems: 'center' }}>
          <View style={{ width: 84, height: 84, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="shirt" size={48} color={C.primary} />
          </View>
          <Text style={{ color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 12 }}>KaamPay</Text>
          <Text style={{ color: '#C7D2FE', fontSize: 16 }}>{t('appTagline', lang)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: SP.xl }}>
          <Row style={{ justifyContent: 'center', marginBottom: SP.lg }}>
            {LANGS.map((l) => (
              <Pressable key={l.code} onPress={() => chooseLang(l.code)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: lang === l.code ? C.primary : '#fff', borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: lang === l.code ? '#fff' : C.text, fontWeight: '700' }}>{l.label}</Text>
              </Pressable>
            ))}
          </Row>
          <ErrorText error={err} />

          {step === 'mobile' && (
            <>
              <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 8 }}>{t('mobileNumber', lang)}</Text>
              <Row style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 2, borderColor: C.border, paddingHorizontal: 14 }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: C.muted }}>+91</Text>
                <TextInput
                  value={mobile}
                  onChangeText={(v) => setMobile(v.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="number-pad"
                  maxLength={10}
                  placeholder="98XXXXXXXX"
                  autoFocus
                  style={{ flex: 1, fontSize: 28, fontWeight: '700', paddingVertical: 14, letterSpacing: 2 }}
                />
              </Row>
              <Btn big title={t('sendOtp', lang)} icon="chatbubble-ellipses" disabled={mobile.length !== 10} loading={busy} onPress={send} style={{ marginTop: SP.xl }} />
              <Pressable onPress={() => router.push('/signup')} style={{ marginTop: SP.xl, alignItems: 'center' }}>
                <Text style={{ color: C.primary, fontWeight: '700' }}>{t('newCompany', lang)}</Text>
              </Pressable>
            </>
          )}

          {step === 'otp' && (
            <>
              <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 4 }}>{t('enterOtp', lang)}</Text>
              <Text style={{ color: C.muted, marginBottom: 12 }}>+91 {mobile}</Text>
              <Pressable onPress={() => otpRef.current?.focus()}>
                <Row style={{ justifyContent: 'space-between' }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <View key={i} style={{ width: 48, height: 60, borderRadius: 12, borderWidth: 2, borderColor: code.length === i ? C.primary : C.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 28, fontWeight: '800' }}>{code[i] || ''}</Text>
                    </View>
                  ))}
                </Row>
              </Pressable>
              {/* hidden input drives the boxes; autoComplete lets Android fill the SMS code */}
              <TextInput
                ref={otpRef}
                value={code}
                onChangeText={(v) => {
                  const c = v.replace(/\D/g, '').slice(0, 6);
                  setCode(c);
                  if (c.length === 6) verify(c);
                }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
              />
              <Btn big title={t('verify', lang)} disabled={code.length !== 6} loading={busy} onPress={() => verify()} style={{ marginTop: SP.xl }} />
              <Row style={{ justifyContent: 'space-between', marginTop: SP.lg }}>
                <Pressable onPress={() => setStep('mobile')}>
                  <Text style={{ color: C.primary, fontWeight: '700' }}>{t('changeNumber', lang)}</Text>
                </Pressable>
                <Pressable disabled={timer > 0} onPress={send}>
                  <Text style={{ color: timer > 0 ? C.muted : C.primary, fontWeight: '700' }}>
                    {timer > 0 ? `${t('resendIn', lang)} ${timer}s` : t('resend', lang)}
                  </Text>
                </Pressable>
              </Row>
            </>
          )}

          {step === 'company' && (
            <Wrap>
              {companies.map((c) => (
                <Tile key={c.id} big icon="business" label={c.name} width="100%" onPress={() => verify(passCode, c.id)} />
              ))}
            </Wrap>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
