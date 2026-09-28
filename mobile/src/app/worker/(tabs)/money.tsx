import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Card, Empty, Loading, Muted, Row, Screen, Sheet } from '@/components/ui';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr, pcs } from '@/lib/format';
import { useData } from '@/lib/hooks';
import { t, wtName } from '@/lib/i18n';
import { C, SP } from '@/lib/theme';
import type { Job, WorkerSummary } from '@/lib/types';

type Month = { weeks: { week: string; pieces: number; amount: number }[]; pieces: number; amount: number };

export default function WorkerMoney() {
  const { user, company } = useAuth();
  const show = company?.settings.show_amount_to_worker !== false;
  const { data, loading, refreshing, reload } = useData(
    async () => {
      const [sum, month] = await Promise.all([
        get<WorkerSummary>(`/workers/${user!.id}/summary`),
        get<Month>('/reports/my-month'),
      ]);
      return { sum, month };
    },
    [user?.id],
    'worker-money',
  );
  const [detail, setDetail] = useState<{ title: string; jobs: Job[] } | null>(null);

  const openList = async (title: string, status: string[]) => {
    const jobs = await get<Job[]>('/jobs', { status, limit: 300 });
    setDetail({ title, jobs });
  };

  if (loading && !data) return <Loading />;
  if (!data) return <Empty text={t('nothingYet')} />;
  const { sum, month } = data;
  const owe = sum.receivable < 0;
  const maxWeek = Math.max(1, ...month.weeks.map((w) => w.pieces));

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Card style={{ backgroundColor: owe ? C.red : C.green, alignItems: 'center', paddingVertical: 28 }} onPress={() => openList(t('toReceive'), ['APPROVED'])}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{owe ? t('youOwe') : t('toReceive')}</Text>
        <Text style={{ color: '#fff', fontSize: 48, fontWeight: '900' }}>{show ? inr(Math.abs(sum.receivable), 0) : '—'}</Text>
      </Card>
      <Row style={{ gap: SP.md, alignItems: 'stretch' }}>
        <Card style={{ flex: 1 }} onPress={() => openList(t('approvalPending'), ['DONE', 'CHECKED'])}>
          <Text style={{ fontSize: 15, color: C.muted, fontWeight: '700' }}>⏳ {t('approvalPending')}</Text>
          <Text style={{ fontSize: 26, fontWeight: '900', color: '#F97316' }}>{show ? inr(sum.pending_approval, 0) : '—'}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, color: C.muted, fontWeight: '700' }}>💵 {t('advanceTaken')}</Text>
          <Text style={{ fontSize: 26, fontWeight: '900', color: C.red }}>{inr(sum.advance_open, 0)}</Text>
        </Card>
      </Row>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>📅 {t('thisMonth')}</Text>
        <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={{ fontSize: 28, fontWeight: '900' }}>{pcs(month.pieces)}</Text>
          {show ? <Text style={{ fontSize: 28, fontWeight: '900', color: C.green }}>{inr(month.amount, 0)}</Text> : null}
        </Row>
        <View style={{ marginTop: 14, gap: 10 }}>
          {month.weeks.map((w) => (
            <Row key={w.week}>
              <Text style={{ width: 36, fontWeight: '800', fontSize: 16 }}>{w.week}</Text>
              <View style={{ flex: 1, height: 22, backgroundColor: C.border, borderRadius: 6, overflow: 'hidden' }}>
                <View style={{ width: `${(100 * w.pieces) / maxWeek}%`, height: 22, backgroundColor: C.primary }} />
              </View>
              <Text style={{ width: 70, textAlign: 'right', fontWeight: '700' }}>{w.pieces}</Text>
            </Row>
          ))}
        </View>
      </Card>

      <Sheet visible={!!detail} onClose={() => setDetail(null)}>
        <Text style={{ fontSize: 22, fontWeight: '900', marginBottom: 10 }}>{detail?.title}</Text>
        {!detail?.jobs.length ? <Muted>{t('nothingYet')}</Muted> : null}
        {detail?.jobs.slice(0, 30).map((j) => (
          <Row key={j.id} style={{ justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border }}>
            <Text style={{ fontSize: 17, fontWeight: '700' }}>
              {t('lot')} {j.lot_no} · {wtName(j)} · {j.colour_codes.join(',')}
            </Text>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.green }}>{show ? inr(j.amount, 0) : pcs(j.pieces)}</Text>
          </Row>
        ))}
      </Sheet>
    </Screen>
  );
}
