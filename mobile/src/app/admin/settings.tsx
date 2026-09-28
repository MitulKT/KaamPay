import React, { useEffect, useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';

import { Btn, Card, ErrorText, Field, H, Loading, Muted, Pill, Row, Screen, Wrap } from '@/components/ui';
import { get, patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notify } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Company, CompanySettings } from '@/lib/types';

const TOGGLES: { k: keyof CompanySettings; l: string; d: string }[] = [
  { k: 'supervisor_check_required', l: 'Supervisor check before approval', d: 'Off = Done goes straight to admin' },
  { k: 'photo_required_on_done', l: 'Photo required when marking Done', d: 'Worker must take a photo' },
  { k: 'allow_worker_self_claim', l: 'Workers can add their own jobs', d: 'Like the old Google Form, but duplicate-proof' },
  { k: 'show_amount_to_worker', l: 'Show ₹ amounts to workers', d: 'Off = workers see pieces only' },
  { k: 'use_started_step', l: 'Use “Started” step', d: 'Adds a Start button before Done' },
];

export default function Settings() {
  const { refreshMe } = useAuth();
  const [c, setC] = useState<Company | null>(null);
  const [s, setS] = useState<CompanySettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<Company>('/company').then((x) => {
      setC(x);
      setS(x.settings);
    });
  }, []);
  if (!c || !s) return <Loading />;
  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) => setS((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await patch('/company', { name: c.name, gstin: c.gstin, address: c.address, settings: s });
      await refreshMe();
      notify('Settings saved ✅');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (k: keyof CompanySettings, label: string) => (
    <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <TextInput value={String(s[k])} onChangeText={(v) => set(k, Number(v.replace(/\D/g, '')) as never)} keyboardType="number-pad" style={{ width: 90, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 8, textAlign: 'right' }} />
    </Row>
  );

  return (
    <Screen footer={<Btn title="Save settings" loading={busy} onPress={save} />}>
      <ErrorText error={err} />
      <Field label="Company name" value={c.name} onChangeText={(v) => setC({ ...c, name: v })} />
      <Field label="GSTIN" value={c.gstin || ''} onChangeText={(v) => setC({ ...c, gstin: v.toUpperCase() })} />
      <Field label="Address" value={c.address || ''} onChangeText={(v) => setC({ ...c, address: v })} multiline />
      <H>Workflow</H>
      {TOGGLES.map((t) => (
        <Card key={t.k} style={{ padding: 12 }}>
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }}>{t.l}</Text>
              <Muted>{t.d}</Muted>
            </View>
            <Switch value={!!s[t.k]} onValueChange={(v) => set(t.k, v as never)} />
          </Row>
        </Card>
      ))}
      <H>Payouts</H>
      <Wrap style={{ marginBottom: 10 }}>
        <Pill label="Weekly" active={s.payout_cycle === 'WEEKLY'} onPress={() => set('payout_cycle', 'WEEKLY')} />
        <Pill label="Monthly" active={s.payout_cycle === 'MONTHLY'} onPress={() => set('payout_cycle', 'MONTHLY')} />
      </Wrap>
      {s.payout_cycle === 'WEEKLY' ? (
        <Wrap style={{ marginBottom: 10 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
            <Pill key={d} label={d} active={s.week_start_day === i} onPress={() => set('week_start_day', i)} />
          ))}
        </Wrap>
      ) : null}
      {num('max_advance_recovery_percent', 'Max advance recovery per cycle (% of earnings)')}
      {num('advance_alert_above', 'Alert when an advance is above (₹)')}
      {num('jobs_per_day_warning', 'Warn when a worker gets more jobs per day than')}
      <Wrap>
        <Pill label="Exact paise" active={s.rounding === 'NONE'} onPress={() => set('rounding', 'NONE')} />
        <Pill label="Round to ₹1" active={s.rounding === 'NEAREST_1'} onPress={() => set('rounding', 'NEAREST_1')} />
      </Wrap>
    </Screen>
  );
}
