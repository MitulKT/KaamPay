import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';

import { REPORTS } from '@/components/Reports';
import { Card, Muted, Row, Screen } from '@/components/ui';
import { C } from '@/lib/theme';

const DESC: Record<string, string> = {
  'status-board': 'Pending / WIP / done / approved by lot',
  'lot-progress': '% complete per lot, behind-schedule flags',
  'worker-productivity': 'Pieces per worker, per day, rejection %',
  ageing: 'Jobs stuck in a status for too long',
  timeline: 'Everything that happened, minute by minute',
  'payout-register': 'Gross, advance cut, net, paid, balance',
  'lot-cost': 'Labour cost per lot and per piece',
  'work-type-cost': 'Spend and rate range per operation',
  'monthly-summary': 'Month-wise labour cost and top earners',
  exceptions: 'Edits, rejections, rate changes, duplicates blocked',
};

export default function AdminReports() {
  return (
    <Screen>
      {REPORTS.map((r) => (
        <Card key={r.key} onPress={() => router.push(`/admin/report/${r.key}`)}>
          <Row>
            <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={r.icon} size={22} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>{r.title}</Text>
              <Muted>{DESC[r.key]}</Muted>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
