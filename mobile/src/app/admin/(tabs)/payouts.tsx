import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';

import { Btn, Card, Empty, ErrorText, Field, Loading, Muted, Row, Screen, Sheet, StatusChip } from '@/components/ui';
import { get, post } from '@/lib/api';
import { fmtDate, inr } from '@/lib/format';
import { useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Cycle } from '@/lib/types';

export default function Payouts() {
  const { data, loading, refreshing, reload } = useData(() => get<Cycle[]>('/payouts/cycles'), []);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startNew = async () => {
    const s = await get<{ from_date: string; to_date: string }>('/payouts/suggest-period');
    setFrom(s.from_date);
    setTo(s.to_date);
    setErr(null);
    setOpen(true);
  };
  const create = async () => {
    setBusy(true);
    try {
      const c = await post<Cycle>('/payouts/cycles', { from_date: from, to_date: to });
      setOpen(false);
      router.push(`/admin/cycle/${c.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={reload} footer={<Btn icon="add" title="New payout cycle" onPress={startNew} />}>
      <Row style={{ marginBottom: 10 }}>
        <Btn small outline icon="cash" title="Advance / deduction" onPress={() => router.push('/admin/money-entry')} />
      </Row>
      {loading && !data ? <Loading /> : null}
      {data && !data.length ? <Empty icon="wallet-outline" text="No payout cycles yet" /> : null}
      {data?.map((c) => (
        <Card key={c.id} onPress={() => router.push(`/admin/cycle/${c.id}`)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 17, fontWeight: '900' }}>{c.cycle_no}</Text>
            <StatusChip status={c.status === 'DRAFT' ? 'STARTED' : c.status === 'LOCKED' ? 'CHECKED' : 'PAID'} label={c.status} />
          </Row>
          <Muted>
            {fmtDate(c.from_date)} – {fmtDate(c.to_date)} · {c.totals.workers} workers
          </Muted>
          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <Text>Net {inr(c.totals.net_payable, 0)}</Text>
            <Text style={{ color: C.green, fontWeight: '700' }}>Paid {inr(c.totals.paid_amount, 0)}</Text>
            <Text style={{ color: c.totals.balance > 0 ? C.red : C.muted, fontWeight: '700' }}>Bal {inr(c.totals.balance, 0)}</Text>
          </Row>
        </Card>
      ))}
      <Sheet visible={open} onClose={() => setOpen(false)}>
        <Text style={{ fontSize: 20, fontWeight: '900', marginBottom: 10 }}>New payout cycle</Text>
        <ErrorText error={err} />
        <Field label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
        <Field label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} />
        <Muted style={{ marginBottom: 12 }}>Picks every APPROVED, unpaid job approved in this period + open deductions, and recovers advances.</Muted>
        <Btn title="Build draft" loading={busy} onPress={create} />
      </Sheet>
    </Screen>
  );
}
