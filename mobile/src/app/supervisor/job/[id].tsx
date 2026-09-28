import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { Btn, Card, Field, H, Line, Loading, Muted, Pill, Row, Screen, Sheet, StatusChip, Wrap } from '@/components/ui';
import { fileUrl, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { REJECT_REASONS } from '@/lib/constants';
import { fmtDateTime, inr, pcs } from '@/lib/format';
import { confirm, notify, useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { Job } from '@/lib/types';

type Full = Job & { status_history: { status: string; by_name: string; at: string; note: string }[] };

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, company } = useAuth();
  const isAdmin = !!user?.roles.includes('ADMIN');
  const { data: job, setData, reload } = useData(() => get<Full>(`/jobs/${id}`), [id]);
  const [sheet, setSheet] = useState<null | 'reject' | 'reassign' | 'edit'>(null);
  const [reason, setReason] = useState('QUALITY');
  const [note, setNote] = useState('');
  const [editPcs, setEditPcs] = useState('');
  const [editRate, setEditRate] = useState('');
  const { data: workers } = useData(() => get<{ id: string; name: string }[]>('/workers/tiles'), []);
  if (!job) return <Loading />;

  const act = async (path: string, body: object = {}, ask?: string) => {
    if (ask && !(await confirm(ask, ''))) return;
    try {
      setData(await post<Full>(`/jobs/${id}/${path}`, body));
      setSheet(null);
      reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const s = job.status;
  const canApprove = isAdmin && (s === 'CHECKED' || (s === 'DONE' && !company?.settings.supervisor_check_required));
  return (
    <Screen>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 22, fontWeight: '900' }}>{job.job_no}</Text>
          <StatusChip status={s} big />
        </Row>
        <Line label="Worker" value={job.worker_name} />
        <Line label="Lot" value={job.lot_no} />
        <Line label="Work type" value={job.work_type_code} />
        <Line label="Colours" value={job.colour_codes.join(', ') + (job.split_pieces ? ` (split ${job.split_pieces} pcs)` : '')} />
        <Line label="Pieces × rate" value={`${pcs(job.pieces)} × ₹${job.rate_snapshot}`} />
        <Line label="Amount" value={inr(job.amount)} bold color={C.green} />
        {job.manual_override ? <Muted>Edited by admin</Muted> : null}
        {job.rejected_reason ? <Text style={{ color: C.red, marginTop: 6 }}>Last rejected: {job.rejected_reason} {job.rejected_note}</Text> : null}
      </Card>
      {job.done_photo_url ? <Image source={{ uri: fileUrl(job.done_photo_url) }} style={{ width: '100%', height: 260, borderRadius: 12, marginBottom: 12 }} resizeMode="cover" /> : null}

      <Wrap>
        {(s === 'ASSIGNED' || s === 'STARTED') && (
          <>
            <Btn color={C.green} title="Mark done (on behalf)" onPress={() => act('done', { note: 'marked by supervisor' }, 'Mark this job done for the worker?')} />
            <Btn outline title="Reassign" onPress={() => setSheet('reassign')} />
          </>
        )}
        {s === 'DONE' && (
          <>
            <Btn color={C.green} title="✓ Checked" onPress={() => act('check')} />
            <Btn color={C.red} outline title="✗ Reject" onPress={() => setSheet('reject')} />
          </>
        )}
        {s === 'CHECKED' && isAdmin && <Btn color={C.red} outline title="✗ Reject" onPress={() => setSheet('reject')} />}
        {canApprove && <Btn color={C.green} title="Approve" onPress={() => act('approve')} />}
        {isAdmin && ['ASSIGNED', 'STARTED', 'DONE', 'CHECKED'].includes(s) && (
          <Btn outline title="Edit pcs / rate" onPress={() => { setEditPcs(String(job.pieces)); setEditRate(String(job.rate_snapshot)); setSheet('edit'); }} />
        )}
        {['ASSIGNED', 'STARTED', 'DONE'].includes(s) || (isAdmin && s === 'CHECKED') ? (
          <Btn outline color={C.muted} title="Cancel job" onPress={() => act('cancel', { note: 'cancelled' }, 'Cancel this job? The cells become free again.')} />
        ) : null}
      </Wrap>

      <H>History</H>
      {[...(job.status_history || [])].reverse().map((h, i) => (
        <Row key={i} style={{ alignItems: 'flex-start', marginBottom: 8 }}>
          <StatusChip status={h.status} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }}>
              {h.by_name} · {fmtDateTime(h.at)}
            </Text>
            {h.note ? <Muted>{h.note}</Muted> : null}
          </View>
        </Row>
      ))}

      <Sheet visible={sheet === 'reject'} onClose={() => setSheet(null)}>
        <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Reason</Text>
        <Wrap>
          {REJECT_REASONS.map((r) => (
            <Pill key={r.k} label={r.l} active={reason === r.k} onPress={() => setReason(r.k)} />
          ))}
        </Wrap>
        <Field label="Note" value={note} onChangeText={setNote} style={{ marginTop: 10 }} />
        <Btn color={C.red} title="Send back" onPress={() => act('reject', { reason, note })} />
      </Sheet>
      <Sheet visible={sheet === 'reassign'} onClose={() => setSheet(null)}>
        <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Reassign to</Text>
        <Wrap>
          {(workers || [])
            .filter((w) => w.id !== job.worker_id)
            .map((w) => (
              <Pill key={w.id} label={w.name} onPress={() => act('reassign', { worker_id: w.id, reason: 'reassigned' })} />
            ))}
        </Wrap>
      </Sheet>
      <Sheet visible={sheet === 'edit'} onClose={() => setSheet(null)}>
        <Field label="Pieces" value={editPcs} onChangeText={setEditPcs} keyboardType="numeric" />
        <Field label="Rate (₹/pc)" value={editRate} onChangeText={setEditRate} keyboardType="decimal-pad" />
        <Field label="Reason (required)" value={note} onChangeText={setNote} />
        <Btn title="Save" disabled={note.length < 3} onPress={() => act('edit', { pieces: Number(editPcs), rate: Number(editRate), reason: note })} />
      </Sheet>
      <Btn title="Back" outline style={{ marginTop: 20 }} onPress={() => router.back()} />
    </Screen>
  );
}
