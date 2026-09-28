import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Card, DateField, ErrorText, Field, H, Loading, Muted, Pill, Row, Screen, Wrap, addDays } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import { confirm, notify } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Lot } from '@/lib/types';

type ColourRow = { code: string; name: string; qty: string };
// Codes are auto-assigned A, B, C… and re-lettered after a delete so there are never gaps.
const letter = (i: number) => String.fromCharCode(65 + i);
const nextLetter = (rows: ColourRow[]) => letter(rows.length);

/** Create / edit a lot with its colour-wise piece count. */
export default function LotForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const nav = useNavigation();
  const [loading, setLoading] = useState(!!id);
  const [lotNo, setLotNo] = useState('');
  const [item, setItem] = useState('');
  const [styleId, setStyleId] = useState<string | null>(null);
  const [styles, setStyles] = useState<{ id: string; name: string; style_code: string }[]>([]);
  const [target, setTarget] = useState(id ? '' : addDays(14));
  const [rows, setRows] = useState<ColourRow[]>([{ code: 'A', name: '', qty: '' }]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false); // show red hints only after first save attempt
  const dirty = useRef(false);
  const saved = useRef(false);

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

  // Ask before throwing away a half-filled form (back arrow / hardware back / browser back).
  useEffect(() => {
    const sub = nav.addListener('beforeRemove', (e: { preventDefault: () => void; data: { action: unknown } }) => {
      if (!dirty.current || saved.current) return;
      e.preventDefault();
      confirm('Discard changes?', 'You have unsaved changes on this lot.').then((ok) => {
        if (ok) {
          dirty.current = false;
          nav.dispatch(e.data.action as never);
        }
      });
    });
    return sub;
  }, [nav]);

  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const setRow = (i: number, k: keyof ColourRow, v: string) => {
    dirty.current = true;
    setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };
  const removeRow = (i: number) => {
    dirty.current = true;
    // re-letter only for new lots; existing lots keep their codes (jobs reference them)
    setRows((p) => p.filter((_, j) => j !== i).map((r, j) => (id ? r : { ...r, code: letter(j) })));
  };
  const touch = <T,>(fn: (v: T) => void) => (v: T) => {
    dirty.current = true;
    fn(v);
  };

  // What's still missing — shown above the disabled button instead of a silent grey button.
  const missing = [!lotNo.trim() && 'lot number', total <= 0 && 'pieces for at least one colour'].filter(Boolean) as string[];
  const canSave = !missing.length;

  const save = async () => {
    setTouched(true);
    if (!canSave) return;
    setErr(null);
    setBusy(true);
    const colours = rows.filter((r) => r.code && r.qty !== '').map((r) => ({ code: r.code, name: r.name, qty: Number(r.qty) }));
    try {
      if (id) {
        const res = await patch(`/lots/${id}`, { item_name: item, colours, target_date: target || undefined, reason });
        if (res.recalculated_jobs?.length) notify('Open jobs recalculated', `${res.recalculated_jobs.length} job amounts updated`);
        saved.current = true;
        router.back();
      } else {
        saved.current = true;
        const l = await post<Lot>('/lots', { lot_no: lotNo, item_name: item, style_id: styleId, colours, target_date: target || undefined, start_date: new Date().toISOString().slice(0, 10) });
        router.replace(`/supervisor/lot/${l.id}?tab=rates`);
      }
    } catch (e) {
      saved.current = false;
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  return (
    <Screen
      footer={
        <View style={{ gap: 6 }}>
          {missing.length ? (
            <Text style={{ fontSize: 12, color: touched ? C.red : C.muted, textAlign: 'center' }} accessibilityLiveRegion="polite">
              Add {missing.join(' and ')} to continue
            </Text>
          ) : null}
          {/* Kept tappable: tapping with missing info highlights the fields instead of doing nothing */}
          <Btn title={id ? 'Save changes' : 'Create lot → set rates'} loading={busy} soft={!canSave} onPress={save} />
        </View>
      }
    >
      <ErrorText error={err} />
      <Field
        label="Lot number"
        value={lotNo}
        onChangeText={touch(setLotNo)}
        editable={!id}
        keyboardType="number-pad"
        inputMode="numeric"
        placeholder="e.g. 157"
        invalid={touched && !lotNo.trim()}
      />
      <Field label="Item / style name" value={item} onChangeText={touch(setItem)} placeholder="e.g. Cargo trouser" />
      <DateField label="Target date" value={target} onChange={touch(setTarget)} />
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
          <Text style={[th, { width: CODE_W }]}>Code</Text>
          <Text style={[th, { flex: 1 }]}>Colour name</Text>
          <Text style={[th, { width: PCS_W }]}>Pcs</Text>
          {rows.length > 1 ? <View style={{ width: DEL_W }} /> : null}
        </Row>
        {rows.map((r, i) => (
          <Row key={i} style={{ marginBottom: 8 }}>
            {/* Code is auto-assigned — shown as a badge, not an editable box */}
            <View style={{ width: CODE_W, height: 44, borderRadius: 8, backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`Colour ${r.code}`}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: C.primary }}>{r.code}</Text>
            </View>
            {/* minWidth 0 lets this shrink on narrow phones instead of pushing Pcs off-screen */}
            <TextInput
              value={r.name}
              onChangeText={(v) => setRow(i, 'name', v)}
              placeholder="Name (optional)"
              placeholderTextColor={C.placeholder}
              accessibilityLabel={`Colour ${r.code} name`}
              style={[inp, { flex: 1, minWidth: 0 }]}
            />
            <TextInput
              value={r.qty}
              onChangeText={(v) => setRow(i, 'qty', v.replace(/\D/g, ''))}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder="0"
              placeholderTextColor={C.placeholder}
              accessibilityLabel={`Colour ${r.code} pieces`}
              style={[inp, { width: PCS_W, textAlign: 'right' }, touched && total <= 0 && { borderColor: C.red }]}
            />
            {rows.length > 1 ? (
              <Pressable
                onPress={() => removeRow(i)}
                accessibilityRole="button"
                accessibilityLabel={`Remove colour ${r.code}`}
                style={{ width: DEL_W, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: C.red, fontSize: 22, fontWeight: '800' }}>×</Text>
              </Pressable>
            ) : null}
          </Row>
        ))}
        <Btn
          small
          outline
          icon="add"
          title={`Add colour ${nextLetter(rows)}`}
          style={{ alignSelf: 'flex-start', minHeight: 40 }}
          onPress={() => {
            dirty.current = true;
            setRows((p) => [...p, { code: nextLetter(p), name: '', qty: '' }]);
          }}
        />
        <Text style={{ fontSize: 18, fontWeight: '900', marginTop: 12 }}>Total: {total} pcs</Text>
      </Card>
      {id ? <Field label="Reason for change (if jobs exist)" value={reason} onChangeText={touch(setReason)} /> : null}
    </Screen>
  );
}

const CODE_W = 40;
const PCS_W = 72;
const DEL_W = 32;
const th = { fontSize: 13, fontWeight: '800' as const, color: C.muted };
const inp = { height: 44, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, fontSize: 16, color: C.text };
