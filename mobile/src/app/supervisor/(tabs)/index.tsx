import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';

import { REPORTS } from '@/components/Reports';
import { Btn, Card, H, Kpi, Loading, Row, Screen, Tile, Wrap } from '@/components/ui';
import { get } from '@/lib/api';
import { useData } from '@/lib/hooks';
import { C, SP, STATUS_COLORS } from '@/lib/theme';

interface Dash {
  cards: Record<string, number>;
  attention: { kind: string; text: string; lot_id?: string; count?: number }[];
}

export default function SupervisorHome() {
  const { data, loading, refreshing, reload } = useData(() => get<Dash>('/dashboard/supervisor'), [], 'sup-dash');
  if (loading && !data) return <Loading />;
  const c = data?.cards || {};
  const waiting = c.waiting_check_total ?? 0;
  const board = () => router.push('/supervisor/report/status-board');
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: C.muted }}>TODAY</Text>
      <Wrap style={{ marginTop: 6, marginBottom: SP.md }}>
        <Kpi label="Assigned" value={c.assigned_today ?? 0} color={STATUS_COLORS.ASSIGNED} onPress={board} />
        <Kpi label="Done – waiting check" value={waiting} color={STATUS_COLORS.DONE} onPress={() => router.push('/supervisor/check')} />
        <Kpi label="Checked" value={c.checked_today ?? 0} color={STATUS_COLORS.CHECKED} onPress={board} />
        <Kpi label="Rejected" value={c.rejected_today ?? 0} color={C.red} onPress={board} />
      </Wrap>
      <Row style={{ gap: 10 }}>
        <Btn style={{ flex: 1 }} icon="add" title="New lot" onPress={() => router.push('/supervisor/lot-form')} />
        <Btn style={{ flex: 1 }} icon="person-add" title="Assign job" onPress={() => router.push('/supervisor/assign')} />
      </Row>
      {/* Loud orange only when there is actually something to check */}
      <Btn
        icon="checkmark-done"
        color={waiting ? STATUS_COLORS.DONE : C.muted}
        outline={!waiting}
        title={waiting ? `Check done jobs (${waiting})` : 'Nothing waiting for check'}
        style={{ marginTop: 10 }}
        onPress={() => router.push('/supervisor/check')}
      />

      <H>Needs attention</H>
      {!data?.attention.length ? (
        <Card>
          <Row>
            <Ionicons name="checkmark-circle" size={20} color={C.green} />
            <Text style={{ color: C.text, fontWeight: '600' }}>All clear</Text>
          </Row>
        </Card>
      ) : null}
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
          // flexGrow + basis: tiles fill the row exactly, so edges line up with the buttons above
          <Tile key={r.key} width="auto" style={{ flexGrow: 1, flexBasis: '40%' }} icon={r.icon} label={r.title} onPress={() => router.push(`/supervisor/report/${r.key}`)} />
        ))}
      </Wrap>

      <H>Setup</H>
      <Card onPress={() => router.push('/supervisor/work-types')}>
        <Row>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="cut" size={18} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>Work types</Text>
            <Text style={{ fontSize: 12, color: C.muted }}>Operations you pay piece rates for</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.placeholder} />
        </Row>
      </Card>
    </Screen>
  );
}
