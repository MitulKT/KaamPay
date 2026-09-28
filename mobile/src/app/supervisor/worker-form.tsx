import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Switch, Text } from 'react-native';

import { Btn, ErrorText, Field, H, Loading, Muted, Pill, Row, Screen, Wrap } from '@/components/ui';
import { fileUrl, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { takeAndUploadPhoto } from '@/lib/files';
import { notify } from '@/lib/hooks';
import type { Role, User, WorkType } from '@/lib/types';

/** "SIDE POCKET" → "Side pocket" — easier to scan than all caps. */
const titleCase = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();

/** Add / edit a user. Supervisors can only add workers; admin can add any role. */
export default function WorkerForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const nav = useNavigation();
  const { user: me } = useAuth();
  const isAdmin = !!me?.roles.includes('ADMIN');
  const [loading, setLoading] = useState(!!id);
  const [f, setF] = useState({ name: '', name_local: '', mobile: '', payment_mode: 'CASH', upi_id: '', bank_name: '', ifsc: '', account_last4: '', photo_url: '' as string | null });
  const [roles, setRoles] = useState<Role[]>(['WORKER']);
  const [skills, setSkills] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [wts, setWts] = useState<WorkType[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    nav.setOptions({ title: id ? 'Edit person' : 'Add person' });
    get<WorkType[]>('/work-types').then(setWts).catch(() => undefined);
    if (!id) return;
    get<User>(`/users/${id}`).then((u) => {
      setF({
        name: u.name,
        name_local: u.name_local || '',
        mobile: u.pending_mobile ? '' : u.mobile,
        payment_mode: u.profile?.payment_mode || 'CASH',
        upi_id: u.profile?.upi_id || '',
        bank_name: u.profile?.bank_name || '',
        ifsc: u.profile?.ifsc || '',
        account_last4: u.profile?.account_last4 || '',
        photo_url: u.photo_url || null,
      });
      setRoles(u.roles);
      setSkills(u.profile?.skill_work_type_ids || []);
      setActive(u.is_active);
      setLoading(false);
    });
  }, [id]);

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setErr(null);
    setBusy(true);
    const body: Record<string, unknown> = { ...f, mobile: f.mobile || undefined, skill_work_type_ids: skills };
    if (isAdmin) body.roles = roles;
    try {
      if (id) await patch(`/users/${id}`, { ...body, is_active: active });
      else await post('/users', body);
      router.back();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  return (
    <Screen footer={<Btn title="Save" loading={busy} disabled={!f.name} onPress={save} />}>
      <ErrorText error={err} />
      <Row style={{ marginBottom: 12 }}>
        {f.photo_url ? <Image source={{ uri: fileUrl(f.photo_url) }} style={{ width: 64, height: 64, borderRadius: 32 }} /> : null}
        <Btn small outline icon="camera" title="Photo" onPress={async () => {
          try {
            const u = await takeAndUploadPhoto();
            if (u) setF((p) => ({ ...p, photo_url: u }));
          } catch (e) {
            notify((e as Error).message);
          }
        }} />
      </Row>
      <Field label="Name (English)" value={f.name} onChangeText={set('name')} />
      <Field label="Name in Hindi / Gujarati (optional)" value={f.name_local} onChangeText={set('name_local')} />
      <Field
        label="Mobile (+91) – needed for login"
        value={f.mobile}
        onChangeText={(v) => set('mobile')(v.replace(/\D/g, '').slice(0, 10))}
        keyboardType="number-pad"
        inputMode="tel"
        maxLength={10}
        placeholder="98XXXXXXXX"
        invalid={!!f.mobile && f.mobile.length !== 10}
        hint={f.mobile && f.mobile.length !== 10 ? `${f.mobile.length}/10 digits` : undefined}
      />
      {isAdmin ? (
        <>
          <H>Roles</H>
          <Wrap style={{ marginBottom: 10 }}>
            {(['WORKER', 'SUPERVISOR', 'ADMIN'] as Role[]).map((r) => (
              <Pill key={r} label={titleCase(r)} active={roles.includes(r)} onPress={() => setRoles((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))} />
            ))}
          </Wrap>
        </>
      ) : null}
      {roles.includes('WORKER') ? (
        <>
          <H>Payment</H>
          <Wrap style={{ marginBottom: 10 }}>
            {['CASH', 'UPI', 'BANK'].map((m) => (
              <Pill key={m} label={m === 'UPI' ? 'UPI' : titleCase(m)} active={f.payment_mode === m} onPress={() => set('payment_mode')(m)} />
            ))}
          </Wrap>
          {f.payment_mode === 'UPI' ? <Field label="UPI ID" value={f.upi_id} onChangeText={set('upi_id')} autoCapitalize="none" /> : null}
          {f.payment_mode === 'BANK' ? (
            <>
              <Field label="Bank name" value={f.bank_name} onChangeText={set('bank_name')} />
              <Field label="IFSC" value={f.ifsc} onChangeText={(v) => set('ifsc')(v.toUpperCase())} />
              <Field label="Account – last 4 digits only" value={f.account_last4} onChangeText={(v) => set('account_last4')(v.replace(/\D/g, '').slice(-4))} keyboardType="number-pad" />
            </>
          ) : null}
          <H>Skills</H>
          <Wrap>
            {wts.map((w) => (
              <Pill key={w.id} label={titleCase(w.name_en || w.code)} active={skills.includes(w.id)} onPress={() => setSkills((p) => (p.includes(w.id) ? p.filter((x) => x !== w.id) : [...p, w.id]))} />
            ))}
          </Wrap>
        </>
      ) : null}
      {id ? (
        <Row style={{ marginTop: 20 }}>
          <Switch value={active} onValueChange={setActive} />
          <Text>{active ? 'Active' : 'Deactivated (cannot log in)'}</Text>
        </Row>
      ) : null}
    </Screen>
  );
}
