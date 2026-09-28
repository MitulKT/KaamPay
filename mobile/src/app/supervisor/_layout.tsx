import { Redirect, Stack } from 'expo-router';
import React from 'react';

import { Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

export default function SupervisorLayout() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading full />;
  if (!user) return <Redirect href="/login" />;
  if (!user.roles.some((r) => r === 'SUPERVISOR' || r === 'ADMIN')) return <Redirect href="/role" />;
  return (
    <Stack screenOptions={{ headerTintColor: C.primary, headerTitleStyle: { fontWeight: '800' }, headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
      <Stack.Screen name="lot/[id]" options={{ title: 'Lot' }} />
      <Stack.Screen name="lot-form" options={{ title: 'Lot' }} />
      <Stack.Screen name="worker-form" options={{ title: 'Worker' }} />
      <Stack.Screen name="worker/[id]" options={{ title: 'Worker' }} />
      <Stack.Screen name="job/[id]" options={{ title: 'Job' }} />
      <Stack.Screen name="work-types" options={{ title: 'Work types' }} />
      <Stack.Screen name="report/[key]" options={{ title: 'Report' }} />
    </Stack>
  );
}
