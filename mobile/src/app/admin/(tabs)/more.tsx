import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { Card, Row, Screen } from '@/components/ui';
import { C } from '@/lib/theme';

const ITEMS: { title: string; icon: React.ComponentProps<typeof Ionicons>['name']; href: string }[] = [
  { title: 'Lots & rates', icon: 'layers', href: '/supervisor/lots' },
  { title: 'Workers', icon: 'people', href: '/supervisor/workers' },
  { title: 'Users & roles', icon: 'key', href: '/admin/users' },
  { title: 'Work types', icon: 'cut', href: '/supervisor/work-types' },
  { title: 'Advance / deduction', icon: 'cash', href: '/admin/money-entry' },
  { title: 'Import from Excel', icon: 'cloud-upload', href: '/admin/import' },
  { title: 'Settings', icon: 'settings', href: '/admin/settings' },
  { title: 'Audit log', icon: 'document-lock', href: '/admin/audit' },
  { title: 'Supervisor view', icon: 'clipboard', href: '/supervisor' },
];

export default function More() {
  return (
    <Screen>
      {ITEMS.map((i) => (
        <Card key={i.href} onPress={() => router.push(i.href as never)} style={{ padding: 14 }}>
          <Row>
            <Ionicons name={i.icon} size={22} color={C.primary} />
            <Text style={{ flex: 1, fontSize: 16, fontWeight: '700' }}>{i.title}</Text>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
