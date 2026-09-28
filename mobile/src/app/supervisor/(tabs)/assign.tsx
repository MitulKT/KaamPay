import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Switch, Text, TextInput, View } from 'react-native';

import { Btn, Card, ColourChip, Empty, H, Line, Loading, Muted, Row, Screen, SearchInput, Tile, Wrap, haptic } from '@/components/ui';
import { fileUrl, get, postOrQueue } from '@/lib/api';
import { inr, pcs } from '@/lib/format';
import { notify, useData } from '@/lib/hooks';
import { C, SP } from '@/lib/theme';
import type { Lot } from '@/lib/types';

type WorkerTile = { id: string; name: string; name_local: string; photo_url?: string; worker_code?: string; open_jobs: number; pending_mobile: boolean };
const STEPS = ['Worker', 'Lot', 'Work'];

type RateRow = { work_type_id: string; code: string; name_en: string; name_hi?: string; rate: number | null };
type Avail = { code: string; qty: number; taken_by: { worker_name: string; split: boolean; pieces?: number }[] }[];

/**
 * 3 steps: worker -> lot -> work types + colours. Params let the lot grid pre-fill:
 *   ?lot=<id>&cells=<wtId>:A,<wtId>:B  (multi-select from grid)   or   ?lot=<id>&wt=<wtId>&colour=A
 */
export default function Assign() {
  const params = useLocalSearchParams<{ lot?: string; cells?: string; wt?: string; colour?: string; worker?: string }>();
  const [step, setStep] = useState(1);
  const [q, setQ] = useState('');
  const [worker, setWorker] = useState<WorkerTile | null>(null);
  const [lot, setLot] = useState<Lot | null>(null);
  const [wts, setWts] = useState<string[]>([]);
  const [colours, setColours] = useState<string[]>([]);
  const [cells, setCells] = useState<{ wt: string; colour: string }[] | null>(null);
  const [split, setSplit] = useState(false);
  const [splitPcs, setSplitPcs] = useState('');
  const [rates, setRates] = useState<RateRow[]>([]);
  const [avail, setAvail] = useState<Record<string, Avail>>({});
  const [busy, setBusy] = useState(false);

  const { data, loading, reload } = useData(async () => {
    const [workers, lots] = await Promise.all([
      get<WorkerTile[]>('/workers/tiles'),
      get<Lot[]>('/lots', { with_progress: false }),
    ]);
    return { workers, lots: lots.filter((l) => l.status !== 'CLOSED') };
  }, [], 'assign-data');

  // prefill from params
  useEffect(() => {
    if (!data) return;
    if (params.lot) {
      const l = data.lots.find((x) => x.id === params.lot);
      if (l) setLot(l);
      if (params.cells) setCells(params.cells.split(',').map((c) => ({ wt: c.split(':')[0], colour: c.split(':')[1] })));
      if (params.wt) setWts([params.wt]);
      if (params.colour) setColours([params.colour]);
    }
    if (params.worker) setWorker(data.workers.find((w) => w.id === params.worker) || null);
  }, [data, params.lot, params.cells, params.wt, params.colour, params.worker]);

  useEffect(() => {
    if (!lot) return;
    get<RateRow[]>(`/lots/${lot.id}/rates`).then(setRates).catch(() => setRates([]));
  }, [lot?.id]);

  useEffect(() => {
    if (!lot) return;
    wts.forEach((w) => {
      get<Avail>('/jobs/availability', { lot_id: lot.id, work_type_id: w })
        .then((a) => setAvail((p) => ({ ...p, [w]: a })))
        .catch(() => undefined);
    });
  }, [lot?.id, wts.join(',')]);

  const rateOf = (wt: string) => rates.find((r) => r.work_type_id === wt)?.rate ?? null;
  const takenCodes = useMemo(() => {
    const s = new Map<string, string>();
    wts.forEach((w) => (avail[w] || []).forEach((a) => a.taken_by.length && !a.taken_by[0].split && s.set(a.code, a.taken_by[0].worker_name)));
    return s;
  }, [avail, wts]);

  // what will be created: groups of (work type, colours)
  const plan = useMemo(() => {
    if (!lot) return [];
    const qty = Object.fromEntries(lot.colours.map((c) => [c.code, c.qty]));
    const groups: { wt: string; colours: string[] }[] = cells
      ? Object.entries(cells.reduce<Record<string, string[]>>((a, c) => ({ ...a, [c.wt]: [...(a[c.wt] || []), c.colour] }), {})).map(([wt, cs]) => ({ wt, colours: cs }))
      : wts.map((wt) => ({ wt, colours }));
    return groups.map((g) => {
      const p = split && splitPcs ? Number(splitPcs) : g.colours[0] === 'ALL' ? lot.total_qty : g.colours.reduce((a, c) => a + (qty[c] || 0), 0);
      const rate = rateOf(g.wt);
      return { ...g, pieces: p, rate, amount: rate != null ? p * rate : null, code: rates.find((r) => r.work_type_id === g.wt)?.code || '?' };
    });
  }, [lot, cells, wts, colours, split, splitPcs, rates]);

  const total = plan.reduce((a, p) => a + (p.amount || 0), 0);
  const missingRate = plan.some((p) => p.rate == null);
  const ready = worker && lot && plan.length && plan.every((p) => p.colours.length) && !missingRate;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const warnings: string[] = [];
    try {
      for (const g of plan) {
        const res: any = await postOrQueue(
          '/jobs/assign',
          {
            worker_id: worker!.id,
            lot_id: lot!.id,
            work_type_ids: [g.wt],
            colour_codes: g.colours,
            split_pieces: split && splitPcs ? Number(splitPcs) : undefined,
            client_ref: `as-${worker!.id}-${lot!.id}-${g.wt}-${g.colours.join('')}-${Date.now()}`,
          },
          `Assign ${worker!.name} lot ${lot!.lot_no} ${g.code}`,
        );
        if (res.warnings) warnings.push(...res.warnings);
      }
      haptic.ok();
      notify('Assigned ✅', `${worker!.name}: ${plan.length} job(s), ${inr(total)}${warnings.length ? '\n\n⚠ ' + warnings.join('\n') : ''}`);
      setWts([]);
      setColours([]);
      setCells(null);
      setSplit(false);
      setSplitPcs('');
      setStep(1);
      setWorker(null);
      reload();
      if (params.lot) router.back();
    } catch (e) {
      haptic.err();
      notify('Could not assign', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  const workers = (data?.workers || []).filter((w) => !q || `${w.name} ${w.name_local}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Screen
      footer={
        <Row>
          {step > 1 ? <Btn title="Back" outline onPress={() => setStep(step - 1)} /> : null}
          {step === 1 ? <Btn style={{ flex: 1 }} title="Next: pick lot" disabled={!worker} onPress={() => setStep(lot ? 3 : 2)} /> : null}
          {step === 2 ? <Btn style={{ flex: 1 }} title="Next: pick work" disabled={!lot} onPress={() => setStep(3)} /> : null}
          {step === 3 ? <Btn style={{ flex: 1 }} color={C.green} icon="checkmark" title={`Assign ${plan.length ? inr(total, 0) : ''}`} disabled={!ready} loading={busy} onPress={submit} /> : null}
        </Row>
      }
    >
      {/* Labelled stepper: Worker → Lot → Work. Done steps are tappable to jump back. */}
      <Row style={{ marginBottom: SP.md, alignItems: 'flex-start' }}>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const canJump = n < step;
          return (
            <View key={n} style={{ flex: 1, gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: step >= n ? C.primary : C.border }} />
              <Text
                onPress={canJump ? () => setStep(n) : undefined}
                accessibilityRole={canJump ? 'button' : 'text'}
                accessibilityState={{ selected: step === n }}
                style={{ fontSize: 12, fontWeight: step === n ? '800' : '600', color: step >= n ? C.primary : C.muted }}
              >
                {n}. {label}
              </Text>
            </View>
          );
        })}
      </Row>
      {worker && step > 1 ? <Muted>Worker: {worker.name}</Muted> : null}
      {lot && step > 2 ? <Muted>Lot {lot.lot_no} · {lot.total_qty} pcs</Muted> : null}

      {step === 1 && (
        <>
          <H style={{ marginTop: 0 }}>1. Pick worker</H>
          {data?.workers.length ? <SearchInput value={q} onChangeText={setQ} placeholder="Search worker" /> : null}
          <Wrap>
            {workers.map((w) => (
              <Tile
                key={w.id}
                width="31%"
                label={w.name}
                sub={w.name_local || w.worker_code}
                badge={w.open_jobs}
                selected={worker?.id === w.id}
                icon={w.photo_url ? undefined : 'person'}
                onPress={() => {
                  setWorker(w);
                  setStep(lot ? 3 : 2);
                }}
              />
            ))}
          </Wrap>
          {!data?.workers.length ? (
            <Empty
              icon="people-outline"
              text="No workers yet"
              action={<Btn small icon="person-add" title="Add worker" onPress={() => router.push('/supervisor/worker-form')} />}
            />
          ) : !workers.length ? (
            <Muted>No workers matching "{q}"</Muted>
          ) : null}
        </>
      )}

      {step === 2 && (
        <>
          <H style={{ marginTop: 0 }}>2. Pick lot</H>
          {!data?.lots.length ? (
            <Empty text="No open lots" action={<Btn small icon="add" title="New lot" onPress={() => router.push('/supervisor/lot-form')} />} />
          ) : null}
          <Wrap>
            {data?.lots.map((l) => (
              <Tile
                key={l.id}
                big
                width="31%"
                label={l.lot_no}
                sub={`${l.total_qty} pcs`}
                selected={lot?.id === l.id}
                onPress={() => {
                  setLot(l);
                  setWts([]);
                  setColours([]);
                  setCells(null);
                  setStep(3);
                }}
              />
            ))}
          </Wrap>
        </>
      )}

      {step === 3 && lot && (
        <>
          {cells ? (
            <Card>
              <Text style={{ fontWeight: '800' }}>{cells.length} cells selected from the lot grid</Text>
              <Btn small outline title="Clear & pick manually" style={{ marginTop: 8, alignSelf: 'flex-start' }} onPress={() => setCells(null)} />
            </Card>
          ) : (
            <>
              <H style={{ marginTop: 0 }}>3a. Work types</H>
              <Wrap>
                {rates.filter((r) => r.rate != null).map((r) => (
                  <Tile
                    key={r.work_type_id}
                    width="31%"
                    label={r.code}
                    sub={r.rate != null ? `₹${r.rate}` : 'no rate'}
                    selected={wts.includes(r.work_type_id)}
                    disabled={r.rate == null}
                    onPress={() => setWts((p) => (p.includes(r.work_type_id) ? p.filter((x) => x !== r.work_type_id) : [...p, r.work_type_id]))}
                  />
                ))}
              </Wrap>
              {rates.some((r) => r.rate == null) ? (
                <Muted style={{ marginTop: 6 }}>
                  {rates.filter((r) => r.rate == null).length} work types have no rate on this lot — set them in Lots › {lot.lot_no} › Rates.
                </Muted>
              ) : null}
              {wts.length ? (
                <>
                  <H>3b. Colours</H>
                  <Wrap>
                    {!takenCodes.size ? <ColourChip code="ALL" size={56} selected={colours[0] === 'ALL'} onPress={() => setColours(colours[0] === 'ALL' ? [] : ['ALL'])} /> : null}
                    {lot.colours.map((c) => (
                      <ColourChip
                        key={c.code}
                        code={c.code}
                        size={56}
                        sub={takenCodes.get(c.code) || `${c.qty}`}
                        taken={takenCodes.has(c.code)}
                        selected={colours.includes(c.code)}
                        onPress={() => setColours((p) => (p.includes(c.code) ? p.filter((x) => x !== c.code) : [...p.filter((x) => x !== 'ALL'), c.code]))}
                      />
                    ))}
                  </Wrap>
                  {wts.length === 1 && colours.length === 1 && colours[0] !== 'ALL' ? (
                    <Row style={{ marginTop: 10 }}>
                      <Switch value={split} onValueChange={setSplit} />
                      <Text>Split by pieces</Text>
                      {split ? (
                        <TextInput value={splitPcs} onChangeText={(v) => setSplitPcs(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="pcs" placeholderTextColor={C.placeholder} accessibilityLabel="Pieces for this split" style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 8, width: 90 }} />
                      ) : null}
                    </Row>
                  ) : null}
                </>
              ) : null}
            </>
          )}
          {plan.length && plan[0].colours.length ? (
            <Card style={{ marginTop: SP.lg }}>
              <Row style={{ marginBottom: 6 }}>
                {worker?.photo_url ? <Image source={{ uri: fileUrl(worker.photo_url) }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : null}
                <Text style={{ fontWeight: '800', fontSize: 16 }}>
                  {worker?.name} · Lot {lot.lot_no}
                </Text>
              </Row>
              {plan.map((p) => (
                <Line key={p.wt} label={`${p.code} · ${p.colours.join(',')} · ${pcs(p.pieces)} × ${p.rate ?? '?'}`} value={p.amount != null ? inr(p.amount) : 'no rate'} color={p.amount == null ? C.red : undefined} />
              ))}
              <Line label="Total" value={inr(total)} bold color={C.green} />
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
