import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Btn, Card, ErrorText, Line, Loading, Muted, Pill, Progress, Row, Screen, Segmented, Sheet, Wrap } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr } from '@/lib/format';
import { confirm, notify, useData } from '@/lib/hooks';
import { C, STATUS_COLORS } from '@/lib/theme';
import type { Lot } from '@/lib/types';

type Tab = 'grid' | 'rates' | 'summary';
type RateRow = { work_type_id: string; code: string; name_en: string; name_hi?: string; rate: number | null; is_locked: boolean };
type GridJob = { job_id: string; job_no: string; status: string; worker_name: string; initials: string; pieces: number; split_pieces?: number | null };
type Grid = { lot: Lot; colours: { code: string; qty: number }[]; rows: { work_type_id: string; code: string; rate: number | null; cells: { colour: string; jobs: GridJob[] }[] }[] };

export default function LotDetail() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const nav = useNavigation();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('ADMIN');
  const [tab, setTab] = useState<Tab>(initialTab || 'grid');
  const { data: lot, reload: reloadLot } = useData(() => get<Lot>(`/lots/${id}`), [id]);
  useEffect(() => {
    if (lot) nav.setOptions({ title: `Lot ${lot.lot_no}` });
  }, [lot?.lot_no]);

  if (!lot) return <Loading />;
  const setStatus = async (status: string) => {
    let reason = '';
    if (lot.status === 'CLOSED') reason = 'Reopened from app';
    if (!(await confirm(`${status === 'CLOSED' ? 'Close' : 'Reopen'} lot ${lot.lot_no}?`, ''))) return;
    try {
      await post(`/lots/${id}/status`, undefined, { status, reason });
      reloadLot();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <Screen padded={false} scroll={false}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontSize: 13, color: C.muted }}>
              {lot.item_name || '—'} · {lot.total_qty} pcs · {lot.status.replace('_', ' ')}
            </Text>
            <Text style={{ fontWeight: '700' }}>{lot.colours.map((c) => `${c.code}:${c.qty}`).join('  ')}</Text>
          </View>
          <Row>
            <Pressable onPress={() => router.push(`/supervisor/lot-form?id=${id}`)} hitSlop={8}>
              <Ionicons name="create-outline" size={24} color={C.primary} />
            </Pressable>
            <Pressable onPress={() => setStatus(lot.status === 'CLOSED' ? 'IN_PRODUCTION' : 'CLOSED')} hitSlop={8}>
              <Ionicons name={lot.status === 'CLOSED' ? 'lock-open-outline' : 'lock-closed-outline'} size={24} color={C.primary} />
            </Pressable>
          </Row>
        </Row>
        <View style={{ marginVertical: 8 }}>
          <Progress pct={lot.progress?.percent_done || 0} />
          <Muted>{lot.progress?.percent_done || 0}% done</Muted>
        </View>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'grid', label: 'Work grid' },
            { value: 'rates', label: 'Rates' },
            { value: 'summary', label: 'Cost' },
          ]}
        />
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'grid' ? <GridTab lotId={id} /> : tab === 'rates' ? <RatesTab lotId={id} isAdmin={isAdmin} /> : <SummaryTab lotId={id} />}
      </View>
    </Screen>
  );
}

function GridTab({ lotId }: { lotId: string }) {
  const { data, reload } = useData(() => get<Grid>(`/lots/${lotId}/grid`), [lotId]);
  const [sel, setSel] = useState<string[]>([]); // "wt:colour"
  const [job, setJob] = useState<GridJob | null>(null);
  if (!data) return <Loading />;
  const rows = data.rows.filter((r) => r.rate != null || r.cells.some((c) => c.jobs.length));
  const CELL = 48;

  const tapCell = (wt: string, colour: string, jobs: GridJob[], rate: number | null) => {
    if (jobs.length) return setJob(jobs[0]);
    if (rate == null) return notify('Set a rate for this work type first (Rates tab)');
    const k = `${wt}:${colour}`;
    if (sel.length) setSel((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
    else router.push(`/supervisor/assign?lot=${lotId}&wt=${wt}&colour=${colour}`);
  };
  const longCell = (wt: string, colour: string, jobs: GridJob[], rate: number | null) => {
    if (jobs.length || rate == null) return;
    const k = `${wt}:${colour}`;
    setSel((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  };

  return (
    <View style={{ flex: 1 }}>
      <Wrap style={{ paddingHorizontal: 16, marginBottom: 6 }}>
        {['NONE', 'ASSIGNED', 'STARTED', 'DONE', 'CHECKED', 'APPROVED'].map((s) => (
          <Row key={s} gap={4}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: STATUS_COLORS[s] }} />
            <Text style={{ fontSize: 11 }}>{s === 'NONE' ? 'free' : s.toLowerCase()}</Text>
          </Row>
        ))}
      </Wrap>
      <Muted style={{ paddingHorizontal: 16, marginBottom: 6 }}>Tap a grey cell to assign · long-press to select many</Muted>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
        <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 16 }}>
          <View>
            <Row gap={2}>
              <Text style={{ width: 110 }} />
              {data.colours.map((c) => (
                <View key={c.code} style={{ width: CELL, alignItems: 'center' }}>
                  <Text style={{ fontWeight: '900' }}>{c.code}</Text>
                  <Text style={{ fontSize: 10, color: C.muted }}>{c.qty}</Text>
                </View>
              ))}
            </Row>
            {rows.map((r) => (
              <Row key={r.work_type_id} gap={2} style={{ marginTop: 2 }}>
                <View style={{ width: 110 }}>
                  <Text style={{ fontWeight: '800', fontSize: 12 }} numberOfLines={1}>
                    {r.code}
                  </Text>
                  <Text style={{ fontSize: 10, color: r.rate == null ? C.red : C.muted }}>{r.rate == null ? 'no rate' : `₹${r.rate}`}</Text>
                </View>
                {r.cells.map((c) => {
                  const k = `${r.work_type_id}:${c.colour}`;
                  const j = c.jobs[0];
                  const isSel = sel.includes(k);
                  return (
                    <Pressable
                      key={c.colour}
                      onPress={() => tapCell(r.work_type_id, c.colour, c.jobs, r.rate)}
                      onLongPress={() => longCell(r.work_type_id, c.colour, c.jobs, r.rate)}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 6,
                        backgroundColor: j ? STATUS_COLORS[j.status] : r.rate == null ? '#F1F5F9' : STATUS_COLORS.NONE,
                        borderWidth: isSel ? 3 : 0,
                        borderColor: C.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{j ? j.initials : isSel ? '✓' : ''}</Text>
                      {c.jobs.length > 1 ? <Text style={{ color: '#fff', fontSize: 9 }}>+{c.jobs.length - 1} split</Text> : null}
                    </Pressable>
                  );
                })}
              </Row>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
      {sel.length ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: '#fff', flexDirection: 'row', gap: 10 }}>
          <Btn outline title="Clear" onPress={() => setSel([])} />
          <Btn style={{ flex: 1 }} title={`Assign ${sel.length} cells to…`} onPress={() => { router.push(`/supervisor/assign?lot=${lotId}&cells=${sel.join(',')}`); setSel([]); }} />
        </View>
      ) : null}
      <Sheet visible={!!job} onClose={() => setJob(null)}>
        {job ? (
          <>
            <Text style={{ fontSize: 20, fontWeight: '900' }}>
              {job.job_no} · {job.worker_name}
            </Text>
            <Muted>
              {job.status} · {job.pieces} pcs
            </Muted>
            <Btn title="Open job" icon="open-outline" style={{ marginTop: 16 }} onPress={() => { setJob(null); router.push(`/supervisor/job/${job.job_id}`); }} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

function RatesTab({ lotId, isAdmin }: { lotId: string; isAdmin: boolean }) {
  const { data, setData, reload } = useData(() => get<RateRow[]>(`/lots/${lotId}/rates`), [lotId]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const { data: lots } = useData(() => get<Lot[]>('/lots', { with_progress: false }), []);
  if (!data) return <Loading />;
  const locked = data.some((r) => r.is_locked);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const rates = Object.entries(edits).map(([work_type_id, rate]) => ({ work_type_id, rate: rate === '' ? null : Number(rate) }));
      setData(await put<RateRow[]>(`/lots/${lotId}/rates`, { rates, reason }));
      setEdits({});
      notify('Rates saved ✅');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        Object.keys(edits).length ? (
          <View style={{ gap: 8 }}>
            <TextInput value={reason} onChangeText={setReason} placeholder="Reason (needed if jobs already use a rate)" style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10 }} />
            <Btn title={`Save ${Object.keys(edits).length} rate(s)`} loading={busy} onPress={save} />
          </View>
        ) : undefined
      }
    >
      <ErrorText error={err} />
      <Row style={{ marginBottom: 10 }}>
        <Btn small outline icon="copy" title="Copy from lot…" onPress={() => setCopyOpen(true)} />
        {isAdmin ? (
          <Btn
            small
            outline
            icon={locked ? 'lock-open' : 'lock-closed'}
            title={locked ? 'Unlock rates' : 'Lock rates'}
            onPress={async () => {
              await post(`/lots/${lotId}/rates/lock`, undefined, { locked: !locked });
              reload();
            }}
          />
        ) : null}
      </Row>
      {data.map((r) => {
        const v = edits[r.work_type_id] ?? (r.rate == null ? '' : String(r.rate));
        return (
          <Row key={r.work_type_id} style={{ backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: r.rate == null && !edits[r.work_type_id] ? '#FCA5A5' : C.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800' }}>{r.code}</Text>
              {r.name_hi ? <Muted>{r.name_hi}</Muted> : null}
            </View>
            {r.is_locked ? <Ionicons name="lock-closed" size={16} color={C.muted} /> : null}
            <Text style={{ fontWeight: '700', color: C.muted }}>₹</Text>
            <TextInput
              value={v}
              editable={!r.is_locked || isAdmin}
              onChangeText={(t) => setEdits((p) => ({ ...p, [r.work_type_id]: t.replace(/[^\d.]/g, '') }))}
              keyboardType="decimal-pad"
              placeholder="—"
              style={{ width: 80, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 8, fontSize: 16, textAlign: 'right' }}
            />
          </Row>
        );
      })}
      <Sheet visible={copyOpen} onClose={() => setCopyOpen(false)}>
        <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 10 }}>Copy missing rates from</Text>
        <Wrap>
          {(lots || [])
            .filter((l) => l.id !== lotId)
            .slice(0, 30)
            .map((l) => (
              <Pill
                key={l.id}
                label={`Lot ${l.lot_no}`}
                onPress={async () => {
                  const r = await post(`/lots/${lotId}/rates/copy`, { from_lot_id: l.id });
                  setCopyOpen(false);
                  notify(`${r.copied} rates copied`);
                  reload();
                }}
              />
            ))}
        </Wrap>
      </Sheet>
    </Screen>
  );
}

function SummaryTab({ lotId }: { lotId: string }) {
  const { data } = useData(() => get(`/lots/${lotId}/summary`), [lotId]);
  if (!data) return <Loading />;
  return (
    <Screen>
      <Card>
        <Line label="Estimated labour (rates × qty)" value={inr(data.estimated_total)} />
        <Line label="Approved so far" value={inr(data.approved_total)} color={C.green} />
        <Line label="Waiting approval" value={inr(data.pending_total)} color="#F97316" />
        <Line label="Labour cost / piece" value={inr(data.estimated_cost_per_piece)} bold />
      </Card>
      {data.rows.map((r: any) => (
        <Card key={r.work_type_id} style={{ padding: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '800' }}>{r.code}</Text>
            <Text style={{ fontWeight: '800' }}>{inr(r.estimated_cost, 0)}</Text>
          </Row>
          <Muted>
            ₹{r.rate ?? '—'}/pc · {r.pieces_done} pcs done ({r.percent_done}%) · approved {inr(r.approved_cost, 0)}
          </Muted>
          <Progress pct={r.percent_done} />
        </Card>
      ))}
    </Screen>
  );
}
