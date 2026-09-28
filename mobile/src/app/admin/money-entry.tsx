import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { Btn, Card, ErrorText, Field, Line, Muted, Pill, Screen, Segmented, Wrap } from '@/components/ui';
import { get, post } from '@/lib/api';
import { inr } from '@/lib/format';
import { notify } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { WorkerSummary } from '@/lib/types';

/** Give an advance or record a deduction. Shows the worker's current receivable first. */
export default function MoneyEntry() {
  const [kind, setKind] = useState<'advance' | 'deduction'>('advance');
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([]);
  const [worker, setWorker] = useState<string | null>(null);
  const [sum, setSum] = useState<WorkerSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [reason, setReason] = useState<'DAMAGE' | 'REWORK' | 'OTHER'>('OTHER');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get('/workers/tiles').then(setWorkers);
  }, []);
  useEffect(() => {
    setSum(null);
    if (worker) get<WorkerSummary>(`/workers/${worker}/summary`).then(setSum);
  }, [worker]);

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (kind === 'advance') await post('/advances', { worker_id: worker, amount: Number(amount), mode, reason: note });
      else await post('/deductions', { worker_id: worker, amount: Number(amount), reason, note });
      notify('Saved ✅');
      router.back();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = workers.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen footer={<Btn title={`Save ${kind}`} disabled={!worker || !Number(amount)} loading={busy} color={kind === 'advance' ? C.primary : C.red} onPress={save} />}>
      <Segmented value={kind} onChange={setKind} options={[{ value: 'advance', label: 'Give advance' }, { value: 'deduction', label: 'Deduction' }]} />
      <ErrorText error={err} />
      <Field label="Find worker" value={q} onChangeText={setQ} />
      <Wrap style={{ marginBottom: 12 }}>
        {list.slice(0, 40).map((w) => (
          <Pill key={w.id} label={w.name} active={worker === w.id} onPress={() => setWorker(w.id)} />
        ))}
      </Wrap>
      {sum ? (
        <Card>
          <Line label="Receivable now" value={inr(sum.receivable)} bold color={sum.receivable < 0 ? C.red : C.green} />
          <Line label="Waiting approval" value={inr(sum.pending_approval)} />
          <Line label="Open advance" value={inr(sum.advance_open)} color={C.red} />
          {Number(amount) && kind === 'advance' ? <Line label="After this advance" value={inr(sum.receivable - Number(amount))} bold /> : null}
        </Card>
      ) : null}
      <Field label="Amount (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" />
      {kind === 'advance' ? (
        <Wrap style={{ marginBottom: 12 }}>
          {(['CASH', 'UPI', 'BANK'] as const).map((m) => (
            <Pill key={m} label={m} active={mode === m} onPress={() => setMode(m)} />
          ))}
        </Wrap>
      ) : (
        <Wrap style={{ marginBottom: 12 }}>
          {(['DAMAGE', 'REWORK', 'OTHER'] as const).map((r) => (
            <Pill key={r} label={r} active={reason === r} onPress={() => setReason(r)} />
          ))}
        </Wrap>
      )}
      <Field label={kind === 'advance' ? 'Reason (optional)' : 'Note'} value={note} onChangeText={setNote} />
      <Muted>{kind === 'advance' ? 'Advances are recovered automatically in payout cycles (capped by the % in Settings).' : 'Deductions are taken in the next payout cycle.'}</Muted>
      <Text> </Text>
    </Screen>
  );
}
