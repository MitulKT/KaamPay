import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { Btn, ColourChip, H, Loading, Screen, Tile, Wrap, haptic } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { takeAndUploadPhoto } from '@/lib/files';
import { notify, useData } from '@/lib/hooks';
import { t, wtName } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Lot, WorkType } from '@/lib/types';

type Avail = { code: string; qty: number; taken_by: { worker_name: string }[] }[];

/** Self-claim (only when the company allows it): lot tile -> work tiles -> colour chips -> confirm. */
export default function Claim() {
  const { company } = useAuth();
  const { data, loading } = useData(async () => {
    const [lots, wts] = await Promise.all([
      get<Lot[]>('/lots', { status: 'IN_PRODUCTION', with_progress: false }),
      get<WorkType[]>('/work-types'),
    ]);
    return { lots, wts };
  });
  const [lot, setLot] = useState<Lot | null>(null);
  const [wt, setWt] = useState<WorkType | null>(null);
  const [colours, setColours] = useState<string[]>([]);
  const [avail, setAvail] = useState<Avail>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lot && wt) get<Avail>('/jobs/availability', { lot_id: lot.id, work_type_id: wt.id }).then(setAvail).catch(() => setAvail([]));
    setColours([]);
  }, [lot?.id, wt?.id]);

  if (loading || !data) return <Loading />;
  const anyTaken = avail.some((a) => a.taken_by.length);

  const submit = async () => {
    if (company?.settings.photo_required_on_done && !photo) return notify(t('photoRequired'));
    setBusy(true);
    try {
      await post('/jobs/self-claim', { lot_id: lot!.id, work_type_ids: [wt!.id], colour_codes: colours, photo_url: photo, client_ref: `claim-${Date.now()}` });
      haptic.ok();
      router.back();
    } catch (e) {
      haptic.err();
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        lot && wt && colours.length ? (
          <Btn big color={C.green} title={`✓ ${t('confirm')}`} loading={busy} onPress={submit} />
        ) : undefined
      }
    >
      <H style={{ marginTop: 0 }}>1. {t('pickLot')}</H>
      <Wrap>
        {data.lots.map((l) => (
          <Tile key={l.id} big width="31%" label={l.lot_no} selected={lot?.id === l.id} onPress={() => setLot(l)} />
        ))}
      </Wrap>
      {lot ? (
        <>
          <H>2. {t('pickWork')}</H>
          <Wrap>
            {data.wts.map((w) => (
              <Tile key={w.id} width="48%" icon="cut" label={wtName({ work_type_name_en: w.name_en, work_type_name_hi: w.name_hi, work_type_name_gu: w.name_gu })} selected={wt?.id === w.id} onPress={() => setWt(w)} />
            ))}
          </Wrap>
        </>
      ) : null}
      {lot && wt ? (
        <>
          <H>3. {t('pickColour')}</H>
          <Wrap>
            {!anyTaken ? <ColourChip code="ALL" size={60} selected={colours[0] === 'ALL'} onPress={() => setColours(colours[0] === 'ALL' ? [] : ['ALL'])} /> : null}
            {avail.map((a) => (
              <ColourChip
                key={a.code}
                code={a.code}
                size={60}
                sub={a.taken_by[0]?.worker_name || `${a.qty}`}
                taken={!!a.taken_by.length}
                selected={colours.includes(a.code)}
                onPress={() => setColours((p) => (p.includes(a.code) ? p.filter((x) => x !== a.code) : [...p.filter((x) => x !== 'ALL'), a.code]))}
              />
            ))}
          </Wrap>
          <Btn title={photo ? '✓ ' + t('takePhoto') : t('takePhoto')} icon="camera" outline={!photo} style={{ marginTop: 16 }} onPress={async () => setPhoto(await takeAndUploadPhoto())} />
          <Text style={{ marginTop: 8, color: C.muted }}> </Text>
        </>
      ) : null}
    </Screen>
  );
}
