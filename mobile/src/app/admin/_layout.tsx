import { Redirect, Stack } from 'expo-router';
import React from 'react';

import { Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

export default function AdminLayout() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading full />;
  if (!user) return <Redirect href="/login" />;
  if (!user.roles.includes('ADMIN')) return <Redirect href="/role" />;
  return (
    <Stack screenOptions={{ headerTintColor: C.primary, headerTitleStyle: { fontWeight: '800' }, headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
      <Stack.Screen name="cycle/[id]" options={{ title: 'Payout cycle' }} />
      <Stack.Screen name="money-entry" options={{ title: 'Advance / Deduction' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="users" options={{ title: 'Users & roles' }} />
      <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
      <Stack.Screen name="import" options={{ title: 'Import from Excel' }} />
      <Stack.Screen name="report/[key]" options={{ title: 'Report' }} />
    </Stack>
  );
}
