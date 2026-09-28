import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Btn, Card, Field, Line, Loading, Muted, Pill, Row, Screen, Sheet, StatusChip, Wrap } from '@/components/ui';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { downloadExport, shareSlip } from '@/lib/files';
import { fmtDate, inr, pcs } from '@/lib/format';
import { confirm, notify, useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Cycle, CycleLine, Job } from '@/lib/types';

export default function CycleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useNavigation();
  const { data: c, setData, reload } = useData(() => get<Cycle>(`/payouts/cycles/${id}`), [id]);
  const [line, setLine] = useState<CycleLine | null>(null);
  const [lineJobs, setLineJobs] = useState<Job[]>([]);
  const [recovery, setRecovery] = useState('');
  const [payAmt, setPayAmt] = useState('');
  const [mode, setMode] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (c) nav.setOptions({ title: `${c.cycle_no} · ${c.status}` });
  }, [c?.cycle_no, c?.status]);
  if (!c) return <Loading />;
  const draft = c.status === 'DRAFT';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openLine = async (l: CycleLine) => {
    setLine(l);
    setRecovery(String(l.advance_recovery));
    setPayAmt(String(l.balance));
    setMode((l.payment_mode as 'CASH') || 'CASH');
    setLineJobs(await get<Job[]>(`/payouts/cycles/${id}/lines/${l.worker_id}/jobs`));
  };

  const pay = (confirmDup = false): Promise<void> =>
    run(async () => {
      try {
        await post('/payments', { worker_id: line!.worker_id, amount: Number(payAmt), mode, reference_no: ref, payout_cycle_id: id, confirm_duplicate: confirmDup });
        setLine(null);
        setRef('');
        reload();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && !confirmDup && (await confirm('Possible duplicate', e.message))) return pay(true);
        throw e;
      }
    });

  return (
    <Screen
      footer={
        draft ? (
          <Row>
            <Btn outline color={C.red} title="Delete" onPress={() => run(async () => { if (await confirm('Delete this draft?', '')) { await del(`/payouts/cycles/${id}`); router.back(); } })} />
            <Btn outline icon="refresh" title="Refresh" onPress={() => run(async () => setData(await post(`/payouts/cycles/${id}/refresh`)))} />
            <Btn style={{ flex: 1 }} icon="lock-closed" title="Lock cycle" loading={busy} onPress={() => run(async () => { if (await confirm('Lock this cycle?', 'Jobs get frozen into it and advance recovery is applied.')) setData(await post(`/payouts/cycles/${id}/lock`)); })} />
          </Row>
        ) : c.totals.balance > 0 ? (
          <Btn color={C.green} title={`Pay all ${inr(c.totals.balance, 0)} (each worker's mode)`} loading={busy} onPress={() => run(async () => { if (await confirm(`Pay ${inr(c.totals.balance)} to ${c.lines.filter((l) => l.balance > 0).length} workers?`, 'Each worker is paid by their saved mode (Cash / UPI / Bank). Use the worker card to pay one person differently.')) { await post(`/payouts/cycles/${id}/pay-all`, { mode: 'AUTO' }); reload(); } })} />
        ) : undefined
      }
    >
      <Card>
        <Muted>
          {fmtDate(c.from_date)} – {fmtDate(c.to_date)} · {c.totals.workers} workers
        </Muted>
        <Line label="Gross earnings" value={inr(c.totals.gross)} />
        <Line label="Advance recovery" value={`- ${inr(c.totals.advance_recovery)}`} color={C.red} />
        <Line label="Deductions" value={`- ${inr(c.totals.deductions)}`} color={C.red} />
        <Line label="Net payable" value={inr(c.totals.net_payable)} bold />
        <Line label="Paid" value={inr(c.totals.paid_amount)} color={C.green} />
        <Line label="Balance" value={inr(c.totals.balance)} bold color={c.totals.balance > 0 ? C.red : C.green} />
        <Row style={{ marginTop: 10 }}>
          <Btn small outline icon="document" title="Excel" onPress={() => run(() => downloadExport(`/payouts/cycles/${id}/export.xlsx`, `${c.cycle_no}.xlsx`))} />
          <Btn small outline icon="card" title="Bank/UPI CSV" onPress={() => run(() => downloadExport(`/payouts/cycles/${id}/bank.csv`, `${c.cycle_no}-bank.csv`))} />
        </Row>
      </Card>
      {c.lines.map((l) => (
        <Card key={l.worker_id} style={{ opacity: l.excluded ? 0.45 : 1, padding: 12 }} onPress={() => openLine(l)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>
              {l.worker_name} <Text style={{ color: C.muted, fontWeight: '500' }}>{l.worker_code}</Text>
            </Text>
            {l.excluded ? <StatusChip status="CANCELLED" label="excluded" /> : l.balance <= 0 && !draft ? <StatusChip status="PAID" label="paid" /> : null}
          </Row>
          <Muted>
            {l.jobs_count} jobs · gross {inr(l.gross, 0)} · adv −{inr(l.advance_recovery, 0)} · ded −{inr(l.deductions, 0)} · {l.payment_mode}
          </Muted>
          <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ fontWeight: '900', fontSize: 17 }}>Net {inr(l.net_payable, 0)}</Text>
            {!draft ? <Text style={{ fontWeight: '800', color: l.balance > 0 ? C.red : C.green }}>{l.balance > 0 ? `Due ${inr(l.balance, 0)}` : `Paid ${inr(l.paid_amount, 0)}`}</Text> : null}
          </Row>
        </Card>
      ))}

      <Sheet visible={!!line} onClose={() => setLine(null)}>
        {line ? (
          <View>
            <Text style={{ fontSize: 20, fontWeight: '900' }}>{line.worker_name}</Text>
            <Muted>
              {lineJobs.length} jobs · {pcs(lineJobs.reduce((a, j) => a + j.pieces, 0))}
            </Muted>
            <View style={{ maxHeight: 180, marginVertical: 8 }}>
              {lineJobs.slice(0, 12).map((j) => (
                <Row key={j.id} style={{ justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12 }}>
                    Lot {j.lot_no} {j.work_type_code} {j.colour_codes.join(',')} {j.pieces}×{j.rate_snapshot}
                  </Text>
                  <Row>
                    <Text style={{ fontSize: 12, fontWeight: '700' }}>{inr(j.amount, 0)}</Text>
                    {draft ? (
                      <Text
                        style={{ color: C.red, fontSize: 12 }}
                        onPress={() => run(async () => { setData(await patch(`/payouts/cycles/${id}/lines/${line.worker_id}`, { exclude_job_ids: [j.id] })); setLine(null); })}
                      >
                        {' '}exclude
                      </Text>
                    ) : null}
                  </Row>
                </Row>
              ))}
            </View>
            {draft ? (
              <>
                <Field label="Advance recovery (₹)" value={recovery} onChangeText={setRecovery} keyboardType="decimal-pad" />
                <Row style={{ marginBottom: 12 }}>
                  <Switch value={line.excluded} onValueChange={(v) => run(async () => { setData(await patch(`/payouts/cycles/${id}/lines/${line.worker_id}`, { excluded: v })); setLine(null); })} />
                  <Text>Exclude this worker (moves to next cycle)</Text>
                </Row>
                <Btn title="Save recovery" loading={busy} onPress={() => run(async () => { setData(await patch(`/payouts/cycles/${id}/lines/${line.worker_id}`, { advance_recovery: Number(recovery) })); setLine(null); })} />
              </>
            ) : (
              <>
                {line.balance > 0 ? (
                  <>
                    <Field label="Amount (₹)" value={payAmt} onChangeText={setPayAmt} keyboardType="decimal-pad" />
                    <Wrap style={{ marginBottom: 10 }}>
                      {(['CASH', 'UPI', 'BANK'] as const).map((m) => (
                        <Pill key={m} label={m} active={mode === m} onPress={() => setMode(m)} />
                      ))}
                    </Wrap>
                    <Field label="Reference / UTR (optional)" value={ref} onChangeText={setRef} />
                    <Btn color={C.green} title={`Record payment ${inr(Number(payAmt) || 0)}`} loading={busy} onPress={() => pay()} />
                  </>
                ) : (
                  <Text style={{ color: C.green, fontWeight: '800', marginVertical: 8 }}>Fully paid ✅</Text>
                )}
                <Btn outline icon="share-social" title="Share slip" style={{ marginTop: 10 }} onPress={() => run(() => shareSlip(id, line.worker_id))} />
              </>
            )}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
