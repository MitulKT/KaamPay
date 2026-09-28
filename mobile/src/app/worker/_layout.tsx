import { Redirect, Stack } from 'expo-router';
import React from 'react';

import { Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

export default function WorkerLayout() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading full />;
  if (!user) return <Redirect href="/login" />;
  if (!user.roles.includes('WORKER')) return <Redirect href="/role" />;
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
      <Stack.Screen name="claim" options={{ title: t('newJob') }} />
    </Stack>
  );
}
