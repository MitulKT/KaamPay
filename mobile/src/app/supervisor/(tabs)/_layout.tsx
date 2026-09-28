import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';

import { HeaderRight } from '@/components/HeaderRight';
import { C } from '@/lib/theme';

export default function SupervisorTabs() {
  const icon = (name: React.ComponentProps<typeof Ionicons>['name']) =>
    function TabIcon({ color }: { color: import('react-native').ColorValue }) {
      return <Ionicons name={name} size={24} color={color as string} />;
    };
  return (
    <Tabs screenOptions={{ headerRight: () => <HeaderRight />, tabBarActiveTintColor: C.primary, tabBarLabelStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('grid') }} />
      <Tabs.Screen name="lots" options={{ title: 'Lots', tabBarIcon: icon('layers') }} />
      <Tabs.Screen name="assign" options={{ title: 'Assign', tabBarIcon: icon('add-circle') }} />
      <Tabs.Screen name="check" options={{ title: 'Check', tabBarIcon: icon('checkmark-done') }} />
      <Tabs.Screen name="workers" options={{ title: 'Workers', tabBarIcon: icon('people') }} />
    </Tabs>
  );
}
