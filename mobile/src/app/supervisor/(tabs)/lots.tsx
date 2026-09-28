import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { Btn, Card, Empty, Loading, Muted, Pill, Progress, Row, Screen, StatusChip, Wrap } from '@/components/ui';
import { get } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Lot } from '@/lib/types';

const FILTERS = [
  { v: '', l: 'All' },
  { v: 'OPEN', l: 'Open' },
  { v: 'IN_PRODUCTION', l: 'In production' },
  { v: 'CLOSED', l: 'Closed' },
];

export default function Lots() {
  const [status, setStatus] = useState('IN_PRODUCTION');
  const [q, setQ] = useState('');
  const { data, loading, refreshing, reload } = useData(() => get<Lot[]>('/lots', { status, q }), [status, q], `lots-${status}`);
  return (
    <Screen refreshing={refreshing} onRefresh={reload} footer={<Btn icon="add" title="New lot" onPress={() => router.push('/supervisor/lot-form')} />}>
      <TextInput value={q} onChangeText={setQ} placeholder="Search lot no" style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border, fontSize: 16, marginBottom: 10 }} />
      <Wrap style={{ marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <Pill key={f.v} label={f.l} active={status === f.v} onPress={() => setStatus(f.v)} />
        ))}
      </Wrap>
      {loading && !data ? <Loading /> : null}
      {data && !data.length ? <Empty text="No lots" /> : null}
      {data?.map((l) => {
        const pct = l.progress?.percent_done ?? 0;
        return (
          <Card key={l.id} onPress={() => router.push(`/supervisor/lot/${l.id}`)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 28, fontWeight: '900' }}>{l.lot_no}</Text>
              <StatusChip status={l.status === 'CLOSED' ? 'PAID' : l.status === 'OPEN' ? 'ASSIGNED' : 'STARTED'} label={l.status.replace('_', ' ')} />
            </Row>
            <Muted>
              {l.item_name || '—'} · {l.total_qty} pcs · {l.colours.length} colours
              {l.target_date ? ` · due ${fmtDate(l.target_date)}` : ''}
            </Muted>
            <Row style={{ marginTop: 8 }}>
              <Progress pct={pct} />
            </Row>
            <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
              <Muted>{pct}% done</Muted>
              {l.missing_rates ? <Text style={{ color: C.red, fontSize: 12, fontWeight: '700' }}>{l.missing_rates} rates missing</Text> : null}
            </Row>
          </Card>
        );
      })}
    </Screen>
  );
}
