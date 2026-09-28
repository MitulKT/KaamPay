import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { WorkerJobCard } from '@/components/JobCard';
import { Btn, Card, Empty, ErrorText, H, Loading, Row, Screen, Sheet, haptic } from '@/components/ui';
import { fileUrl, get, post, postOrQueue } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { takeAndUploadPhoto } from '@/lib/files';
import { isoDay, pcs, toDate } from '@/lib/format';
import { notify, useData, useQueue } from '@/lib/hooks';
import { t, wtName } from '@/lib/i18n';
import { C, SP } from '@/lib/theme';
import type { Job } from '@/lib/types';

export default function WorkerJobs() {
  const { user, company } = useAuth();
  const s = company?.settings;
  const queue = useQueue();
  const { data, setData, error, loading, refreshing, reload } = useData(
    () => get<Job[]>('/jobs', { status: ['ASSIGNED', 'STARTED', 'DONE', 'CHECKED'] }),
    [],
    'worker-jobs',
  );
  const [confirmJobs, setConfirmJobs] = useState<Job[] | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const queuedIds = useMemo(() => new Set(queue.flatMap((q) => q.jobIds || [])), [queue]);
  const jobs = data || [];
  const open = jobs.filter((j) => (j.status === 'ASSIGNED' || j.status === 'STARTED') && !queuedIds.has(j.id));
  const today = isoDay();
  const doneToday = jobs.filter((j) => j.done_at && isoDay(toDate(j.done_at)!) === today).length + queuedIds.size;
  // returned (rejected) jobs first, then oldest assigned
  const sorted = [...jobs].sort((a, b) => {
    const rank = (j: Job) => (j.status === 'ASSIGNED' && j.rejected_reason ? 0 : j.status === 'ASSIGNED' || j.status === 'STARTED' ? 1 : 2);
    return rank(a) - rank(b) || a.assigned_at.localeCompare(b.assigned_at);
  });

  const markLocal = (ids: string[], status: Job['status']) =>
    setData((prev) => (prev || []).map((j) => (ids.includes(j.id) ? { ...j, status, done_at: new Date().toISOString(), rejected_reason: null } : j)));

  const doDone = async () => {
    if (!confirmJobs) return;
    if (s?.photo_required_on_done && !photo) {
      haptic.err();
      notify(t('photoRequired'));
      return;
    }
    setBusy(true);
    try {
      const ids = confirmJobs.map((j) => j.id);
      const label = confirmJobs.map((j) => `Lot ${j.lot_no} ${j.work_type_code}`).join(', ');
      const res =
        ids.length === 1
          ? await postOrQueue(`/jobs/${ids[0]}/done`, { photo_url: photo, note: '' }, label, ids)
          : await postOrQueue('/jobs-bulk/done', { job_ids: ids, note: '' }, label, ids);
      if (!('queued' in res)) markLocal(ids, 'DONE');
      haptic.ok();
      setConfirmJobs(null);
      setPhoto(null);
      setSelected([]);
      if (!('queued' in res)) reload();
    } catch (e) {
      haptic.err();
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (j: Job) => {
    try {
      await postOrQueue(`/jobs/${j.id}/start`, {}, `Start lot ${j.lot_no}`, [j.id]);
      haptic.ok();
      reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const undo = async (j: Job) => {
    try {
      await post(`/jobs/${j.id}/undo-done`);
      reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const toggle = (id: string) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const confirmTotal = (confirmJobs || []).reduce((a, j) => a + j.pieces, 0);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={reload}
      footer={
        selected.length ? (
          <Row>
            <Btn title={`✕`} outline color={C.muted} onPress={() => setSelected([])} />
            <Btn big style={{ flex: 1 }} color={C.green} title={`✓ ${t('allDone')} (${selected.length})`} onPress={() => setConfirmJobs(jobs.filter((j) => selected.includes(j.id)))} />
          </Row>
        ) : s?.allow_worker_self_claim ? (
          <Btn big icon="add-circle" title={t('newJob')} onPress={() => router.push('/worker/claim')} />
        ) : undefined
      }
    >
      <Card style={{ backgroundColor: C.primary }}>
        <Row>
          {user?.photo_url ? (
            <Image source={{ uri: fileUrl(user.photo_url) }} style={{ width: 56, height: 56, borderRadius: 28 }} />
          ) : (
            <Ionicons name="person-circle" size={56} color="#fff" />
          )}
          <View>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900' }}>
              {t('namaste')} {user?.name_local || user?.name}
            </Text>
            <Text style={{ color: '#C7D2FE', fontSize: 16 }}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          </View>
        </Row>
        <Row style={{ marginTop: SP.lg, gap: SP.md }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 12 }}>
            <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900' }}>{open.length}</Text>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{t('pendingJobs')}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 12 }}>
            <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900' }}>{doneToday}</Text>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{t('doneToday')}</Text>
          </View>
        </Row>
      </Card>
      <ErrorText error={error && !data ? error : null} />
      {loading && !data ? <Loading /> : null}
      {data && !open.length ? <Empty icon="happy-outline" text={t('noPendingJobs')} /> : null}
      {sorted.map((j) => (
        <WorkerJobCard
          key={j.id}
          job={j}
          queued={queuedIds.has(j.id)}
          showAmount={!!s?.show_amount_to_worker}
          useStarted={!!s?.use_started_step}
          selected={selected.includes(j.id)}
          onLongPress={j.status === 'ASSIGNED' || j.status === 'STARTED' ? () => toggle(j.id) : undefined}
          onStart={() => start(j)}
          onDone={() => (selected.length ? toggle(j.id) : setConfirmJobs([j]))}
          onUndo={j.source !== 'self_claim' ? () => undo(j) : undefined}
        />
      ))}

      <Sheet visible={!!confirmJobs} onClose={() => setConfirmJobs(null)}>
        {confirmJobs?.length === 1 ? (
          <>
            <Text style={{ fontSize: 30, fontWeight: '900', textAlign: 'center' }}>
              {t('lot')} {confirmJobs[0].lot_no}
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 4 }}>
              {wtName(confirmJobs[0])} · {confirmJobs[0].colour_codes.join(',')} · {pcs(confirmJobs[0].pieces)}
            </Text>
          </>
        ) : (
          <Text style={{ fontSize: 26, fontWeight: '900', textAlign: 'center' }}>
            {confirmJobs?.length} × · {pcs(confirmTotal)}
          </Text>
        )}
        <Text style={{ fontSize: 26, textAlign: 'center', marginVertical: 12 }}>{t('isComplete')}</Text>
        {confirmJobs?.length === 1 ? (
          <Btn
            title={photo ? '✓ ' + t('takePhoto') : t('takePhoto')}
            icon="camera"
            outline={!photo}
            color={photo ? C.green : C.primary}
            onPress={async () => {
              try {
                const url = await takeAndUploadPhoto();
                if (url) setPhoto(url);
              } catch (e) {
                notify((e as Error).message);
              }
            }}
            style={{ marginBottom: 14 }}
          />
        ) : null}
        <Row style={{ gap: 14 }}>
          <Btn big style={{ flex: 1 }} color={C.red} title={`✕ ${t('no')}`} onPress={() => setConfirmJobs(null)} />
          <Btn big style={{ flex: 1 }} color={C.green} title={`✓ ${t('yes')}`} loading={busy} onPress={doDone} />
        </Row>
      </Sheet>
      {queue.length ? (
        <>
          <H>{t('pendingSync')}</H>
          {queue.map((q) => (
            <Card key={q.id}>
              <Text>⏳ {q.label}</Text>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
