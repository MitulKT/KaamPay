import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Text } from 'react-native';

import { StaffJobRow } from '@/components/JobCard';
import { Btn, Empty, Field, H, Loading, Pill, Row, Screen, Segmented, Sheet, Wrap, haptic } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { REJECT_REASONS } from '@/lib/constants';
import { inr, pcs } from '@/lib/format';
import { confirm, notify, useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Job } from '@/lib/types';

/** Approval queue: CHECKED jobs (or DONE too when supervisor check is off). Group by worker or lot, bulk approve. */
export default function Approve() {
  const { company } = useAuth();
  const statuses = company?.settings.supervisor_check_required ? ['CHECKED'] : ['DONE', 'CHECKED'];
  const { data, setData, loading, refreshing, reload } = useData(() => get<Job[]>('/jobs', { status: statuses, limit: 2000 }), [statuses.join()]);
  const [groupBy, setGroupBy] = useState<'worker' | 'lot'>('worker');
  const [filter, setFilter] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [reason, setReason] = useState('QUALITY');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const jobs = data || [];
  const groups = useMemo(() => {
    const g: Record<string, Job[]> = {};
    jobs.forEach((j) => {
      const k = groupBy === 'worker' ? j.worker_name : `Lot ${j.lot_no}`;
      (g[k] = g[k] || []).push(j);
    });
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [jobs, groupBy]);
  const visible = filter ? groups.filter(([k]) => k === filter) : groups;
  const visibleIds = visible.flatMap(([, js]) => js.map((j) => j.id));
  const targetIds = sel.length ? sel : visibleIds;
  const targetTotal = jobs.filter((j) => targetIds.includes(j.id)).reduce((a, j) => a + (j.amount || 0), 0);

  const approve = async () => {
    if (!(await confirm(`Approve ${targetIds.length} jobs?`, `Total ${inr(targetTotal)}`))) return;
    setBusy(true);
    try {
      const r = await post('/jobs-bulk/approve', { job_ids: targetIds });
      haptic.ok();
      setData((p) => (p || []).filter((j) => !r.ok.includes(j.id)));
      setSel([]);
      notify('Approved ✅', `${r.ok.length} jobs · ${inr(r.total_amount)}${r.failed.length ? `\n${r.failed.length} failed` : ''}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      const r = await post('/jobs-bulk/reject', { job_ids: rejecting, reason, note });
      setData((p) => (p || []).filter((j) => !r.ok.includes(j.id)));
      setRejecting(null);
      setSel([]);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={reload}
      footer={
        jobs.length ? (
          <Row>
            {sel.length ? <Btn color={C.red} outline title="✗" onPress={() => setRejecting(sel)} /> : null}
            <Btn style={{ flex: 1 }} color={C.green} loading={busy} title={`Approve ${sel.length ? 'selected' : filter ? filter : 'all'} (${targetIds.length}) · ${inr(targetTotal, 0)}`} onPress={approve} />
          </Row>
        ) : undefined
      }
    >
      <Segmented value={groupBy} onChange={(v) => { setGroupBy(v); setFilter(null); }} options={[{ value: 'worker', label: 'By worker' }, { value: 'lot', label: 'By lot' }]} />
      <Wrap style={{ marginBottom: 8 }}>
        <Pill label="All" active={!filter} onPress={() => setFilter(null)} />
        {groups.map(([k]) => (
          <Pill key={k} label={k} active={filter === k} onPress={() => setFilter(k)} />
        ))}
      </Wrap>
      {loading && !data ? <Loading /> : null}
      {data && !jobs.length ? <Empty icon="checkmark-done-circle-outline" text="Nothing waiting for approval 🎉" /> : null}
      {visible.map(([k, js]) => (
        <React.Fragment key={k}>
          <H>
            {k} · {pcs(js.reduce((a, j) => a + j.pieces, 0))} · {inr(js.reduce((a, j) => a + (j.amount || 0), 0), 0)}
          </H>
          {js.map((j) => (
            <StaffJobRow
              key={j.id}
              job={j}
              selected={sel.includes(j.id)}
              onToggle={() => setSel((p) => (p.includes(j.id) ? p.filter((x) => x !== j.id) : [...p, j.id]))}
              onPress={() => router.push(`/supervisor/job/${j.id}`)}
            />
          ))}
        </React.Fragment>
      ))}
      <Sheet visible={!!rejecting} onClose={() => setRejecting(null)}>
        <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Reject {rejecting?.length} job(s)</Text>
        <Wrap>
          {REJECT_REASONS.map((r) => (
            <Pill key={r.k} label={r.l} active={reason === r.k} onPress={() => setReason(r.k)} />
          ))}
        </Wrap>
        <Field label="Note" value={note} onChangeText={setNote} style={{ marginTop: 10 }} />
        <Btn color={C.red} title="Reject" loading={busy} onPress={reject} />
      </Sheet>
    </Screen>
  );
}
