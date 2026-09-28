import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Text } from 'react-native';

import { StaffJobRow } from '@/components/JobCard';
import { Btn, Card, Kpi, Loading, Muted, Row, Screen, Segmented, Wrap } from '@/components/ui';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, inr } from '@/lib/format';
import { useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Job, User } from '@/lib/types';

type Detail = User & { open_jobs: number; done_jobs: number; rejections: number };

export default function WorkerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useNavigation();
  const { user: me } = useAuth();
  const isAdmin = !!me?.roles.includes('ADMIN');
  const [tab, setTab] = useState<'open' | 'done' | 'ledger'>('open');
  const { data: w } = useData(() => get<Detail>(`/users/${id}`), [id]);
  const { data: jobs } = useData(
    () => get<Job[]>('/jobs', { worker_id: id, status: tab === 'open' ? ['ASSIGNED', 'STARTED'] : ['DONE', 'CHECKED', 'APPROVED', 'PAID'], limit: 100 }),
    [id, tab],
  );
  const { data: ledger } = useData(() => (tab === 'ledger' ? get(`/workers/${id}/ledger`) : Promise.resolve(null)), [id, tab]);
  useEffect(() => {
    if (w) nav.setOptions({ title: w.name });
  }, [w?.name]);
  if (!w) return <Loading />;
  const s = w.summary;
  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 22, fontWeight: '900' }}>
          {w.name} <Text style={{ color: C.muted }}>{w.name_local}</Text>
        </Text>
        <Muted>
          {w.profile?.worker_code} · {w.pending_mobile ? 'no mobile yet' : `+91 ${w.mobile}`} · {w.profile?.payment_mode}
        </Muted>
        <Row style={{ marginTop: 10 }}>
          <Btn small outline icon="create" title="Edit" onPress={() => router.push(`/supervisor/worker-form?id=${id}`)} />
          {!w.pending_mobile ? <Btn small outline icon="call" title="Call" onPress={() => Linking.openURL(`tel:+91${w.mobile}`)} /> : null}
          <Btn small icon="add" title="Assign" onPress={() => router.push(`/supervisor/assign?worker=${id}`)} />
        </Row>
      </Card>
      <Wrap>
        <Kpi label="Open jobs" value={w.open_jobs} />
        <Kpi label="Rejections" value={w.rejections} color={C.red} />
        <Kpi label="This month" value={inr(s?.earned_this_month, 0)} color={C.green} />
        <Kpi label="Waiting approval" value={inr(s?.pending_approval, 0)} />
        {isAdmin ? <Kpi label="Receivable" value={inr(s?.receivable, 0)} color={(s?.receivable || 0) < 0 ? C.red : C.green} /> : null}
        {isAdmin ? <Kpi label="Open advance" value={inr(s?.advance_open, 0)} color={C.red} /> : null}
      </Wrap>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'done', label: 'Done' },
          { value: 'ledger', label: 'Ledger' },
        ]}
      />
      {tab !== 'ledger' ? (
        (jobs || []).map((j) => <StaffJobRow key={j.id} job={j} onPress={() => router.push(`/supervisor/job/${j.id}`)} />)
      ) : (
        <Card>
          {(ledger?.rows || []).slice(-60).reverse().map((r: any, i: number) => (
            <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: C.border }}>
              <Text style={{ flex: 1, fontSize: 12 }}>
                {fmtDate(r.date)} · {r.text}
              </Text>
              <Text style={{ width: 80, textAlign: 'right', color: r.credit ? C.green : C.red, fontWeight: '700' }}>{r.credit ? `+${inr(r.credit, 0)}` : `-${inr(r.debit, 0)}`}</Text>
              <Text style={{ width: 80, textAlign: 'right', fontWeight: '800' }}>{inr(r.balance, 0)}</Text>
            </Row>
          ))}
          <Text style={{ fontWeight: '900', marginTop: 8 }}>Closing balance: {inr(ledger?.closing_balance)}</Text>
        </Card>
      )}
    </Screen>
  );
}
