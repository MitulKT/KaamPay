import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';

import { Btn, Card, ErrorText, Field, H, Loading, Muted, Pill, Row, Screen, Wrap } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import { notify } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Lot } from '@/lib/types';

type ColourRow = { code: string; name: string; qty: string };
const nextLetter = (rows: ColourRow[]) => String.fromCharCode(65 + rows.length);

/** Create / edit a lot with its colour-wise piece count. */
export default function LotForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const nav = useNavigation();
  const [loading, setLoading] = useState(!!id);
  const [lotNo, setLotNo] = useState('');
  const [item, setItem] = useState('');
  const [styleId, setStyleId] = useState<string | null>(null);
  const [styles, setStyles] = useState<{ id: string; name: string; style_code: string }[]>([]);
  const [target, setTarget] = useState('');
  const [rows, setRows] = useState<ColourRow[]>([{ code: 'A', name: '', qty: '' }]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    nav.setOptions({ title: id ? 'Edit lot' : 'New lot' });
    get('/styles').then(setStyles).catch(() => undefined);
    if (!id) return;
    get<Lot>(`/lots/${id}`).then((l) => {
      setLotNo(l.lot_no);
      setItem(l.item_name || '');
      setTarget(l.target_date ? l.target_date.slice(0, 10) : '');
      setRows(l.colours.map((c) => ({ code: c.code, name: c.name || '', qty: String(c.qty) })));
      setLoading(false);
    });
  }, [id]);

  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const setRow = (i: number, k: keyof ColourRow, v: string) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: k === 'code' ? v.toUpperCase() : v } : r)));

  const save = async () => {
    setErr(null);
    setBusy(true);
    const colours = rows.filter((r) => r.code && r.qty !== '').map((r) => ({ code: r.code, name: r.name, qty: Number(r.qty) }));
    try {
      if (id) {
        const res = await patch(`/lots/${id}`, { item_name: item, colours, target_date: target || undefined, reason });
        if (res.recalculated_jobs?.length) notify('Open jobs recalculated', `${res.recalculated_jobs.length} job amounts updated`);
        router.back();
      } else {
        const l = await post<Lot>('/lots', { lot_no: lotNo, item_name: item, style_id: styleId, colours, target_date: target || undefined, start_date: new Date().toISOString().slice(0, 10) });
        router.replace(`/supervisor/lot/${l.id}?tab=rates`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  return (
    <Screen footer={<Btn title={id ? 'Save changes' : 'Create lot → set rates'} loading={busy} disabled={!lotNo || !rows.length} onPress={save} />}>
      <ErrorText error={err} />
      <Field label="Lot number" value={lotNo} onChangeText={setLotNo} editable={!id} keyboardType="default" placeholder="e.g. 157" />
      <Field label="Item / style name" value={item} onChangeText={setItem} placeholder="e.g. Cargo trouser" />
      <Field label="Target date (YYYY-MM-DD)" value={target} onChangeText={setTarget} placeholder="2026-10-15" />
      {!id && styles.length ? (
        <>
          <Muted>Copy default rates from style</Muted>
          <Wrap style={{ marginVertical: 8 }}>
            {styles.map((s) => (
              <Pill key={s.id} label={s.name} active={styleId === s.id} onPress={() => setStyleId(styleId === s.id ? null : s.id)} />
            ))}
          </Wrap>
        </>
      ) : null}
      <H>Colours & quantity</H>
      <Card>
        <Row style={{ marginBottom: 6 }}>
          <Text style={{ width: 50, fontWeight: '800', color: C.muted }}>Code</Text>
          <Text style={{ flex: 1, fontWeight: '800', color: C.muted }}>Colour name</Text>
          <Text style={{ width: 80, fontWeight: '800', color: C.muted }}>Pcs</Text>
          <Text style={{ width: 24 }} />
        </Row>
        {rows.map((r, i) => (
          <Row key={i} style={{ marginBottom: 8 }}>
            <TextInput value={r.code} onChangeText={(v) => setRow(i, 'code', v)} maxLength={2} style={inp(50)} />
            <TextInput value={r.name} onChangeText={(v) => setRow(i, 'name', v)} placeholder="optional" style={[inp(), { flex: 1 }]} />
            <TextInput value={r.qty} onChangeText={(v) => setRow(i, 'qty', v.replace(/[^\d.]/g, ''))} keyboardType="numeric" style={inp(80)} />
            <Pressable onPress={() => setRows((p) => p.filter((_, j) => j !== i))} hitSlop={8}>
              <Text style={{ color: C.red, fontSize: 20, fontWeight: '800' }}>×</Text>
            </Pressable>
          </Row>
        ))}
        <Btn small outline icon="add" title={`Add colour ${nextLetter(rows)}`} style={{ alignSelf: 'flex-start' }} onPress={() => setRows((p) => [...p, { code: nextLetter(p), name: '', qty: '' }])} />
        <Text style={{ fontSize: 18, fontWeight: '900', marginTop: 12 }}>Total: {total} pcs</Text>
      </Card>
      {id ? <Field label="Reason for change (if jobs exist)" value={reason} onChangeText={setReason} /> : null}
    </Screen>
  );
}

const inp = (w?: number) => ({ width: w, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10, fontSize: 16 });
