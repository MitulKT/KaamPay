import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { REPORTS } from '@/components/Reports';
import { Btn, Card, H, Kpi, Loading, Row, Screen, Tile, Wrap } from '@/components/ui';
import { get } from '@/lib/api';
import { useData } from '@/lib/hooks';
import { C, STATUS_COLORS } from '@/lib/theme';

interface Dash {
  cards: Record<string, number>;
  attention: { kind: string; text: string; lot_id?: string; count?: number }[];
}


export default function SupervisorHome() {
  const { data, loading, refreshing, reload } = useData(() => get<Dash>('/dashboard/supervisor'), [], 'sup-dash');
  if (loading && !data) return <Loading />;
  const c = data?.cards || {};
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: C.muted }}>TODAY</Text>
      <Wrap style={{ marginTop: 6 }}>
        <Kpi label="Assigned" value={c.assigned_today ?? 0} color={STATUS_COLORS.ASSIGNED} />
        <Kpi label="Done – waiting check" value={c.waiting_check_total ?? 0} color={STATUS_COLORS.DONE} onPress={() => router.push('/supervisor/check')} />
        <Kpi label="Checked" value={c.checked_today ?? 0} color={STATUS_COLORS.CHECKED} />
        <Kpi label="Rejected" value={c.rejected_today ?? 0} color={C.red} />
      </Wrap>
      <Row style={{ gap: 10, marginTop: 4 }}>
        <Btn style={{ flex: 1 }} icon="add" title="New lot" onPress={() => router.push('/supervisor/lot-form')} />
        <Btn style={{ flex: 1 }} icon="person-add" title="Assign job" onPress={() => router.push('/supervisor/assign')} />
      </Row>
      <Btn icon="checkmark-done" color={STATUS_COLORS.DONE} title={`Check done jobs (${c.waiting_check_total ?? 0})`} style={{ marginTop: 10 }} onPress={() => router.push('/supervisor/check')} />

      <H>Needs attention</H>
      {!data?.attention.length ? <Card><Text>All clear ✅</Text></Card> : null}
      {data?.attention.map((a, i) => (
        <Card key={i} onPress={a.lot_id ? () => router.push(`/supervisor/lot/${a.lot_id}`) : a.kind === 'DONE_NOT_CHECKED' ? () => router.push('/supervisor/check') : undefined}>
          <Row>
            <Ionicons name="alert-circle" size={20} color={C.amber} />
            <Text style={{ flex: 1, fontWeight: '600' }}>{a.text}</Text>
          </Row>
        </Card>
      ))}

      <H>Reports</H>
      <Wrap>
        {REPORTS.filter((r) => !r.admin).map((r) => (
          <Tile key={r.key} width="48%" icon={r.icon} label={r.title} onPress={() => router.push(`/supervisor/report/${r.key}`)} />
        ))}
      </Wrap>
      <Btn title="Work types" icon="cut" outline style={{ marginTop: 16 }} onPress={() => router.push('/supervisor/work-types')} />
    </Screen>
  );
}
