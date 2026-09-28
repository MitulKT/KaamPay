import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { fileUrl } from '@/lib/api';
import { fmtDateTime, inr, pcs } from '@/lib/format';
import { t, wtName } from '@/lib/i18n';
import { C, STATUS_COLORS } from '@/lib/theme';
import type { Job } from '@/lib/types';

import { Btn, Card, Row, StatusChip } from './ui';

/** Worker card: lot number huge, work type, colours + pieces, amount, one giant button. */
export function WorkerJobCard({
  job,
  onDone,
  onStart,
  onUndo,
  showAmount,
  useStarted,
  selected,
  onLongPress,
  queued,
}: {
  job: Job;
  onDone?: () => void;
  onStart?: () => void;
  onUndo?: () => void;
  showAmount: boolean;
  useStarted: boolean;
  selected?: boolean;
  onLongPress?: () => void;
  queued?: boolean;
}) {
  const returned = job.status === 'ASSIGNED' && !!job.rejected_reason;
  const open = job.status === 'ASSIGNED' || job.status === 'STARTED';
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350}>
      <Card style={{ borderLeftWidth: 8, borderLeftColor: returned ? C.red : STATUS_COLORS[job.status], ...(selected ? { borderWidth: 3, borderColor: C.primary } : {}) }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text style={{ fontSize: 14, color: C.muted, fontWeight: '700' }}>{t('lot')}</Text>
            <Text style={{ fontSize: 44, fontWeight: '900', color: C.text, lineHeight: 48 }}>{job.lot_no}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {returned ? <StatusChip status="REJECTED" label={`↩ ${t('returned')}`} big /> : <StatusChip status={job.status} label={t(`st_${job.status}`)} big />}
            {queued ? <StatusChip status="STARTED" label={`⏳ ${t('pendingSync')}`} /> : null}
          </View>
        </Row>
        <Row style={{ marginTop: 6 }}>
          <Ionicons name="cut" size={26} color={C.primary} />
          <Text style={{ fontSize: 24, fontWeight: '800', color: C.text }}>{wtName(job)}</Text>
        </Row>
        <Row style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {job.colour_codes.map((c) => (
            <View key={c} style={{ backgroundColor: C.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary }}>{c}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 22, fontWeight: '700', color: C.text, marginLeft: 4 }}>{pcs(job.pieces)}</Text>
          {showAmount && job.amount !== undefined ? (
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.green, marginLeft: 'auto' }}>{inr(job.amount, 0)}</Text>
          ) : null}
        </Row>
        {returned ? (
          <View style={{ backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10, marginTop: 10 }}>
            <Text style={{ fontSize: 18, color: C.red, fontWeight: '700' }}>
              ⚠ {t(`rr_${job.rejected_reason}`)} {job.rejected_note ? `– ${job.rejected_note}` : ''}
            </Text>
          </View>
        ) : null}
        {open && !queued ? (
          <View style={{ marginTop: 14, gap: 10 }}>
            {useStarted && job.status === 'ASSIGNED' ? (
              <Btn big title={t('started')} icon="play" color={STATUS_COLORS.STARTED} onPress={onStart} />
            ) : null}
            <Btn big title={`✓ ${t('done')}`} color={C.green} onPress={onDone} />
          </View>
        ) : null}
        {job.status === 'DONE' && onUndo ? (
          <Btn title={t('undo')} icon="arrow-undo" outline color={C.muted} small style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={onUndo} />
        ) : null}
      </Card>
    </Pressable>
  );
}

/** Compact card for supervisor / admin lists. */
export function StaffJobRow({
  job,
  right,
  onPress,
  selected,
  onToggle,
}: {
  job: Job;
  right?: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  onToggle?: () => void;
}) {
  return (
    <Card onPress={onPress} style={{ padding: 12, ...(selected ? { borderWidth: 2, borderColor: C.primary } : {}) }}>
      <Row style={{ alignItems: 'flex-start' }}>
        {onToggle ? (
          <Pressable onPress={onToggle} hitSlop={10} style={{ paddingTop: 2 }}>
            <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={24} color={selected ? C.primary : C.muted} />
          </Pressable>
        ) : null}
        {job.done_photo_url ? (
          <Image source={{ uri: fileUrl(job.done_photo_url) }} style={{ width: 46, height: 46, borderRadius: 8 }} />
        ) : null}
        <View style={{ flex: 1 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '800', fontSize: 15 }}>
              {job.worker_name} · Lot {job.lot_no}
            </Text>
            <StatusChip status={job.status} />
          </Row>
          <Text style={{ color: C.text, marginTop: 2 }}>
            {job.work_type_code} · {job.colour_codes.join(',')} · {pcs(job.pieces)}
            {job.rate_snapshot !== undefined ? ` × ${job.rate_snapshot}` : ''} ={' '}
            <Text style={{ fontWeight: '800', color: C.green }}>{inr(job.amount)}</Text>
          </Text>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
            {job.job_no}
            {job.done_at ? ` · done ${fmtDateTime(job.done_at)}` : ` · assigned ${fmtDateTime(job.assigned_at)}`}
            {job.done_on_behalf ? ' · by supervisor' : ''}
            {job.manual_override ? ' · edited' : ''}
            {job.reject_count ? ` · rejected ×${job.reject_count}` : ''}
          </Text>
          {job.done_note ? <Text style={{ fontSize: 12, color: C.muted }}>“{job.done_note}”</Text> : null}
        </View>
      </Row>
      {right ? <View style={{ marginTop: 8 }}>{right}</View> : null}
    </Card>
  );
}
