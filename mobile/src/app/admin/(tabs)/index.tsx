import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { Btn, Card, H, Kpi, Loading, Row, Screen, Wrap } from '@/components/ui';
import { get } from '@/lib/api';
import { inr } from '@/lib/format';
import { useData } from '@/lib/hooks';
import { C, STATUS_COLORS } from '@/lib/theme';

interface Dash {
  kpis: {
    pending_approval: { count: number; amount: number };
    waiting_supervisor_check: { count: number; amount: number };
    approved_unpaid: { count: number; amount: number };
    paid_this_month: number;
    open_advances: number;
    active_lots: number;
    active_workers: number;
  };
  alerts: { kind: string; text: string }[];
}

const ALERT_LINKS: Record<string, string> = {
  APPROVAL_LATE: '/admin/approve',
  DUPLICATES: '/admin/report/exceptions',
  NO_RATES: '/supervisor/lots',
  PENDING_MOBILE: '/supervisor/workers',
  NEGATIVE_BALANCE: '/admin/report/payout-register',
};

export default function AdminHome() {
  const { data, loading, refreshing, reload } = useData(() => get<Dash>('/dashboard/admin'), [], 'admin-dash');
  if (loading && !data) return <Loading />;
  const k = data?.kpis;
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Wrap>
        <Kpi label="Pending approval" value={inr(k?.pending_approval.amount, 0)} sub={`${k?.pending_approval.count ?? 0} jobs`} color={STATUS_COLORS.CHECKED} onPress={() => router.push('/admin/approve')} />
        <Kpi label="Approved, unpaid" value={inr(k?.approved_unpaid.amount, 0)} sub={`${k?.approved_unpaid.count ?? 0} jobs`} color={STATUS_COLORS.APPROVED} onPress={() => router.push('/admin/payouts')} />
        <Kpi label="Paid this month" value={inr(k?.paid_this_month, 0)} color={STATUS_COLORS.PAID} />
        <Kpi label="Open advances" value={inr(k?.open_advances, 0)} color={C.red} />
        <Kpi label="Waiting supervisor" value={k?.waiting_supervisor_check.count ?? 0} sub={inr(k?.waiting_supervisor_check.amount, 0)} color={STATUS_COLORS.DONE} />
        <Kpi label="Active lots / workers" value={`${k?.active_lots ?? 0} / ${k?.active_workers ?? 0}`} />
      </Wrap>
      <H>Alerts</H>
      {!data?.alerts.length ? (
        <Card>
          <Text>All clear ✅</Text>
        </Card>
      ) : null}
      {data?.alerts.map((a) => (
        <Card key={a.kind} onPress={ALERT_LINKS[a.kind] ? () => router.push(ALERT_LINKS[a.kind] as never) : undefined}>
          <Row>
            <Ionicons name="warning" size={20} color={C.amber} />
            <Text style={{ flex: 1, fontWeight: '600' }}>{a.text}</Text>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Row>
        </Card>
      ))}
      <H>Shortcuts</H>
      <Wrap>
        <Btn icon="layers" outline title="Lots" onPress={() => router.push('/supervisor/lots')} />
        <Btn icon="people" outline title="Workers" onPress={() => router.push('/supervisor/workers')} />
        <Btn icon="add-circle" outline title="Assign" onPress={() => router.push('/supervisor/assign')} />
        <Btn icon="cash" outline title="Give advance" onPress={() => router.push('/admin/money-entry')} />
        <Btn icon="cloud-upload" outline title="Import Excel" onPress={() => router.push('/admin/import')} />
      </Wrap>
    </Screen>
  );
}
