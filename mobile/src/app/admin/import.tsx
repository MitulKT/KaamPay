import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Btn, Card, ErrorText, Field, H, Kpi, Line, Muted, Pill, Row, Screen, Wrap } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { pickExcelAndPreview } from '@/lib/files';
import { inr } from '@/lib/format';
import { confirm, notify, useData } from '@/lib/hooks';
import { C } from '@/lib/theme';

type Policy = 'KEEP_FIRST' | 'KEEP_ALL' | 'SKIP_ALL';

/** Excel import wizard: upload -> validation report -> choices -> import -> tick totals -> undo if needed. */
export default function ImportScreen() {
  const [prev, setPrev] = useState<any>(null);
  const [policy, setPolicy] = useState<Policy>('KEEP_FIRST');
  const [choices, setChoices] = useState<Record<string, number[]>>({});
  const [cutoff, setCutoff] = useState('');
  const [payAs, setPayAs] = useState<'ADVANCE' | 'PAYMENT'>('ADVANCE');
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: history, reload } = useData(() => get<any[]>('/import'), []);

  const pick = async () => {
    setErr(null);
    setBusy(true);
    try {
      const p = await pickExcelAndPreview();
      if (p) {
        setPrev(p);
        setResult(null);
        const months = Object.keys(p.summary.amount_by_month);
        setCutoff(months.length > 1 ? months[months.length - 2] : '');
        setNames(Object.fromEntries(Object.entries(p.name_matches).map(([k, v]: [string, any]) => [k, v.proposed_worker])));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!(await confirm('Import now?', 'You can undo this import later.'))) return;
    setBusy(true);
    try {
      const r = await post(`/import/${prev.session_id}/commit`, {
        settled_before_month: cutoff || null,
        duplicate_policy: policy,
        duplicate_choices: choices,
        name_matches: names,
        payment_rows_as: payAs,
      });
      setResult(r);
      setPrev(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const s = prev?.summary;
  return (
    <Screen footer={prev ? <Btn color={C.green} title="Import" loading={busy} onPress={commit} /> : <Btn icon="cloud-upload" title="Choose .xlsx file" loading={busy} onPress={pick} />}>
      <ErrorText error={err} />
      {!prev && !result ? (
        <Card>
          <Text style={{ fontWeight: '800' }}>Works with your existing Google-Form workbook</Text>
          <Muted>Sheets: Workers, Lots, Work Types, Rate Card (colour-wise qty + rate table), Submissions, Payment Details. Bilingual headers like “कारीगर का नाम (Name of Worker)” are fine.</Muted>
        </Card>
      ) : null}

      {result ? (
        <>
          <H>Imported ✅</H>
          <Card>
            {Object.entries(result.counts).map(([k, v]) => (
              <Line key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </Card>
          <H>Tick against your Excel</H>
          <Card>
            {Object.entries(result.amount_by_month).map(([m, v]) => (
              <Line key={m} label={m} value={inr(v as number)} />
            ))}
          </Card>
          <Muted>Workers were created without mobile numbers — add numbers in Workers so they can log in.</Muted>
        </>
      ) : null}

      {s ? (
        <>
          <Wrap>
            <Kpi label="Workers" value={s.workers} />
            <Kpi label="Lots" value={s.lots} />
            <Kpi label="Work types" value={s.work_types} />
            <Kpi label="Rates" value={s.rates} />
            <Kpi label="Job lines" value={s.job_lines} />
            <Kpi label="Duplicate lines" value={s.duplicate_lines} color={C.red} sub={`${s.duplicate_groups} groups · ${s.cross_worker_duplicates} across workers`} />
            <Kpi label="Missing rate" value={s.lines_missing_rate} color={C.amber} />
            <Kpi label="Missing colour qty" value={s.lines_missing_qty} color={C.amber} />
          </Wrap>
          <H>Amount by month (from sheet, before removing duplicates)</H>
          <Card>
            {Object.entries(s.amount_by_month).map(([m, v]) => (
              <Line key={m} label={m} value={inr(v as number)} />
            ))}
          </Card>

          <H>Already settled?</H>
          <Muted>Months before this are imported as PAID (opening settlement), so balances start at zero.</Muted>
          <Wrap style={{ marginVertical: 8 }}>
            <Pill label="None" active={!cutoff} onPress={() => setCutoff('')} />
            {Object.keys(s.amount_by_month).map((m) => (
              <Pill key={m} label={`before ${m}`} active={cutoff === m} onPress={() => setCutoff(m)} />
            ))}
          </Wrap>

          <H>Duplicates ({prev.duplicates.length} groups)</H>
          <Wrap style={{ marginBottom: 8 }}>
            {(['KEEP_FIRST', 'KEEP_ALL', 'SKIP_ALL'] as Policy[]).map((p) => (
              <Pill key={p} label={p.replace('_', ' ').toLowerCase()} active={policy === p} onPress={() => setPolicy(p)} />
            ))}
          </Wrap>
          {prev.duplicates.slice(0, 40).map((g: any, gi: number) => (
            <Card key={gi} style={{ padding: 10, borderLeftWidth: 4, borderLeftColor: g.same_worker ? C.amber : C.red }}>
              <Text style={{ fontWeight: '800' }}>
                Lot {g.lot} · {g.work_type} · colour {g.colour} {g.same_worker ? '(same worker twice)' : '(different workers!)'}
              </Text>
              {g.lines.map((l: any) => {
                const kept = choices[gi] ? choices[gi].includes(l.index) : undefined;
                return (
                  <Row key={l.index} style={{ justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ flex: 1, fontSize: 12 }}>
                      row {l.row}: {l.worker} · {l.colours.join(',')} · {inr(l.amount, 0)}
                    </Text>
                    <Pill
                      label={kept === undefined ? 'auto' : kept ? 'keep' : 'drop'}
                      active={!!kept}
                      onPress={() =>
                        setChoices((p) => {
                          const cur = p[gi] ?? [];
                          return { ...p, [gi]: cur.includes(l.index) ? cur.filter((x) => x !== l.index) : [...cur, l.index] };
                        })
                      }
                    />
                  </Row>
                );
              })}
            </Card>
          ))}

          {prev.payments.length ? (
            <>
              <H>Payment sheet rows ({prev.payments.length})</H>
              <Wrap style={{ marginBottom: 8 }}>
                <Pill label="Import as advances" active={payAs === 'ADVANCE'} onPress={() => setPayAs('ADVANCE')} />
                <Pill label="Import as payments" active={payAs === 'PAYMENT'} onPress={() => setPayAs('PAYMENT')} />
              </Wrap>
              {Object.entries(prev.name_matches).map(([name, m]: [string, any]) => (
                <Field
                  key={name}
                  label={`“${name}” → worker (${m.score ? Math.round(m.score * 100) + '% match' : 'no match'})`}
                  value={names[name] || ''}
                  onChangeText={(v) => setNames((p) => ({ ...p, [name]: v.toUpperCase() || null }))}
                  placeholder="leave empty to skip"
                />
              ))}
            </>
          ) : null}
          {prev.warnings.length ? (
            <>
              <H>Warnings</H>
              {prev.warnings.slice(0, 20).map((w: string, i: number) => (
                <Muted key={i}>• {w}</Muted>
              ))}
            </>
          ) : null}
          <View style={{ height: 20 }} />
        </>
      ) : null}

      <H>Past imports</H>
      {(history || []).map((h) => (
        <Card key={h.id} style={{ padding: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }}>{h.file_name}</Text>
              <Muted>
                {h.status} · {h.counts ? `${h.counts.jobs ?? 0} jobs` : ''}
              </Muted>
            </View>
            {h.status === 'IMPORTED' ? (
              <Btn
                small
                outline
                color={C.red}
                title="Undo"
                onPress={async () => {
                  if (!(await confirm('Undo this import?', 'Everything it created will be removed.'))) return;
                  try {
                    await del(`/import/${h.id}`);
                    reload();
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              />
            ) : null}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
