import React, { useState } from 'react';
import { Text } from 'react-native';

import { StaffJobRow } from '@/components/JobCard';
import { Btn, Empty, Field, H, Loading, Row, Screen, Sheet, Tile, Wrap, haptic } from '@/components/ui';
import { get, post, postOrQueue } from '@/lib/api';
import { REJECT_REASONS } from '@/lib/constants';
import { inr } from '@/lib/format';
import { notify, useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Job } from '@/lib/types';


/** Verification queue: oldest DONE first, grouped by lot. ✓ = checked, ✗ = reject with reason. */
export default function Check() {
  const { data, setData, loading, refreshing, reload } = useData(() => get<Job[]>('/jobs', { status: ['DONE'], date_field: 'done_at', limit: 500 }), [], 'check-queue');
  const [sel, setSel] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<Job[] | null>(null);
  const [reason, setReason] = useState<string>('QUALITY');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const jobs = [...(data || [])].sort((a, b) => (a.done_at || '').localeCompare(b.done_at || ''));
  const byLot = jobs.reduce<Record<string, Job[]>>((a, j) => ({ ...a, [j.lot_no]: [...(a[j.lot_no] || []), j] }), {});
  const drop = (ids: string[]) => setData((p) => (p || []).filter((j) => !ids.includes(j.id)));

  const check = async (ids: string[]) => {
    setBusy(true);
    try {
      const r: any = await postOrQueue('/jobs-bulk/check', { job_ids: ids }, `Check ${ids.length} job(s)`, ids);
      haptic.ok();
      drop(ids);
      setSel([]);
      if (r.failed?.length) notify('Some jobs failed', r.failed.map((f: any) => f.error).join('\n'));
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
      const ids = rejecting.map((j) => j.id);
      await post('/jobs-bulk/reject', { job_ids: ids, reason, note });
      haptic.ok();
      drop(ids);
      setSel([]);
      setRejecting(null);
      setNote('');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={reload}
      footer={
        jobs.length ? (
          sel.length ? (
            <Row>
              <Btn style={{ flex: 1 }} color={C.red} title={`✗ Reject (${sel.length})`} onPress={() => setRejecting(jobs.filter((j) => sel.includes(j.id)))} />
              <Btn style={{ flex: 1 }} color={C.green} title={`✓ Checked (${sel.length})`} loading={busy} onPress={() => check(sel)} />
            </Row>
          ) : (
            <Btn color={C.green} title={`✓ Mark all ${jobs.length} checked`} loading={busy} onPress={() => check(jobs.map((j) => j.id))} />
          )
        ) : undefined
      }
    >
      {loading && !data ? <Loading /> : null}
      {data && !jobs.length ? <Empty icon="checkmark-done-circle-outline" text="Nothing waiting for check" /> : null}
      {Object.entries(byLot).map(([lot, js]) => (
        <React.Fragment key={lot}>
          <H>
            Lot {lot} · {js.length} jobs · {inr(js.reduce((a, j) => a + (j.amount || 0), 0), 0)}
          </H>
          {js.map((j) => (
            <StaffJobRow
              key={j.id}
              job={j}
              selected={sel.includes(j.id)}
              onToggle={() => toggle(j.id)}
              right={
                <Row>
                  <Btn small style={{ flex: 1 }} color={C.red} outline title="✗ Reject" onPress={() => setRejecting([j])} />
                  <Btn small style={{ flex: 1 }} color={C.green} title="✓ Checked" onPress={() => check([j.id])} />
                </Row>
              }
            />
          ))}
        </React.Fragment>
      ))}

      <Sheet visible={!!rejecting} onClose={() => setRejecting(null)}>
        <Text style={{ fontSize: 20, fontWeight: '900', marginBottom: 10 }}>Reject {rejecting?.length} job(s) — why?</Text>
        <Wrap>
          {REJECT_REASONS.map((r) => (
            <Tile key={r.k} width="31%" icon={r.icon} label={r.l} selected={reason === r.k} onPress={() => setReason(r.k)} />
          ))}
        </Wrap>
        <Field label="Note (optional)" value={note} onChangeText={setNote} style={{ marginTop: 10 }} />
        <Btn color={C.red} title="Send back to worker" loading={busy} onPress={reject} />
      </Sheet>
    </Screen>
  );
}
