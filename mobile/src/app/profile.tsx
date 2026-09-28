import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, Linking, Text, View } from 'react-native';

import { Btn, Card, H, Line, Pill, Screen, Wrap } from '@/components/ui';
import { fileUrl, patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickAndUploadPhoto, takeAndUploadPhoto } from '@/lib/files';
import { get } from '@/lib/api';
import { notify } from '@/lib/hooks';
import { LANGS, t } from '@/lib/i18n';
import { C } from '@/lib/theme';

export default function Profile() {
  const { user, profile, company, lang, setLanguage, logout, refreshMe } = useAuth();
  if (!user) return null;

  const changePhoto = async (camera: boolean) => {
    try {
      const url = camera ? await takeAndUploadPhoto() : await pickAndUploadPhoto();
      if (url) {
        await patch('/auth/me', { photo_url: url });
        await refreshMe();
      }
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const callSupervisor = async () => {
    try {
      const people = await get<{ name: string; mobile: string }[]>('/company/contacts');
      const num = people[0]?.mobile;
      if (num) Linking.openURL(`tel:+91${num}`);
      else notify(t('callSupervisor'));
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        {user.photo_url ? (
          <Image source={{ uri: fileUrl(user.photo_url) }} style={{ width: 96, height: 96, borderRadius: 48 }} />
        ) : (
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person" size={52} color={C.primary} />
          </View>
        )}
        <Text style={{ fontSize: 24, fontWeight: '900', marginTop: 8 }}>{user.name}</Text>
        {user.name_local ? <Text style={{ fontSize: 20, color: C.muted }}>{user.name_local}</Text> : null}
        <Wrap style={{ marginTop: 10 }}>
          <Btn small outline title={t('takePhoto')} icon="camera" onPress={() => changePhoto(true)} />
          <Btn small outline title="Gallery" icon="images" onPress={() => changePhoto(false)} />
        </Wrap>
      </Card>
      <Card>
        <Line label="Company" value={company?.name || ''} />
        <Line label="Mobile" value={`+91 ${user.mobile}`} />
        {profile ? <Line label="Worker code" value={profile.worker_code} /> : null}
        {profile ? <Line label="Payment" value={profile.payment_mode + (profile.upi_id ? ` · ${profile.upi_id}` : '')} /> : null}
        <Line label="Roles" value={user.roles.map((r) => t(`role${r}`)).join(', ')} />
      </Card>
      <H>{t('language')}</H>
      <Wrap>
        {LANGS.map((l) => (
          <Pill key={l.code} label={l.label} active={lang === l.code} onPress={() => setLanguage(l.code)} />
        ))}
      </Wrap>
      <View style={{ gap: 12, marginTop: 24 }}>
        {user.roles.includes('WORKER') && user.roles.length === 1 ? (
          <Btn big title={t('callSupervisor')} icon="call" color={C.green} onPress={callSupervisor} />
        ) : null}
        {user.roles.length > 1 ? <Btn title="Switch role" icon="swap-horizontal" outline onPress={() => router.replace('/role')} /> : null}
        <Btn
          title={t('logout')}
          icon="log-out"
          outline
          color={C.red}
          onPress={async () => {
            await logout();
            router.replace('/login');
          }}
        />
      </View>
    </Screen>
  );
}
