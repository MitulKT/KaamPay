import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import type { ColorValue } from 'react-native';

import { HeaderRight } from '@/components/HeaderRight';
import { C } from '@/lib/theme';

export default function AdminTabs() {
  const icon = (name: React.ComponentProps<typeof Ionicons>['name']) =>
    function TabIcon({ color }: { color: ColorValue }) {
      return <Ionicons name={name} size={24} color={color as string} />;
    };
  return (
    <Tabs screenOptions={{ headerRight: () => <HeaderRight />, tabBarActiveTintColor: C.primary, tabBarLabelStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('speedometer') }} />
      <Tabs.Screen name="approve" options={{ title: 'Approve', tabBarIcon: icon('checkmark-circle') }} />
      <Tabs.Screen name="payouts" options={{ title: 'Payouts', tabBarIcon: icon('wallet') }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: icon('bar-chart') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
