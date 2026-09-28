import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';

import { HeaderRight } from '@/components/HeaderRight';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { C } from '@/lib/theme';

export default function WorkerTabs() {
  const { company, lang } = useAuth();
  return (
    <Tabs
      key={lang}
      screenOptions={{
        headerTitle: company?.name || 'KaamPay',
        headerRight: () => <HeaderRight />,
        tabBarActiveTintColor: C.primary,
        tabBarStyle: { height: 72, paddingBottom: 10, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 15, fontWeight: '800' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabJobs'), tabBarIcon: ({ color }) => <Ionicons name="hammer" size={28} color={color} /> }} />
      <Tabs.Screen name="money" options={{ title: t('tabMoney'), tabBarIcon: ({ color }) => <Ionicons name="wallet" size={28} color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: t('tabHistory'), tabBarIcon: ({ color }) => <Ionicons name="receipt" size={28} color={color} /> }} />
    </Tabs>
  );
}
