import { Redirect, router } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, Tile } from '@/components/ui';
import { homeFor, useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { C, SP } from '@/lib/theme';
import type { Role } from '@/lib/types';

const ICONS = { WORKER: 'hammer', SUPERVISOR: 'clipboard', ADMIN: 'shield-checkmark' } as const;

export default function RolePicker() {
  const { user, setRole, logout } = useAuth();
  if (!user) return <Redirect href="/login" />;
  const pick = async (r: Role) => {
    await setRole(r);
    router.replace(homeFor(r) as never);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: SP.xl }}>
      <Text style={{ fontSize: 26, fontWeight: '900', marginTop: 40 }}>
        {t('namaste')}, {user.name}
      </Text>
      <Text style={{ fontSize: 18, color: C.muted, marginBottom: SP.xl }}>{t('chooseRole')}</Text>
      <View style={{ gap: SP.md }}>
        {user.roles.map((r) => (
          <Tile key={r} big width="100%" icon={ICONS[r]} label={t(`role${r}`)} onPress={() => pick(r)} />
        ))}
      </View>
      <Btn title={t('logout')} outline color={C.muted} style={{ marginTop: 40 }} onPress={logout} />
    </SafeAreaView>
  );
}
