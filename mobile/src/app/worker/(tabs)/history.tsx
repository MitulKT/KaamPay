import React, { useState } from 'react';
import { Text } from 'react-native';

import { Btn, Card, Empty, H, Line, Loading, Muted, Row, Screen, StatusChip } from '@/components/ui';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { shareSlip } from '@/lib/files';
import { fmtDate, inr } from '@/lib/format';
import { notify, useData } from '@/lib/hooks';
import { t } from '@/lib/i18n';
import { C } from '@/lib/theme';

interface Settlement {
  cycle_id: string;
  cycle_no: string;
  from_date: string;
  to_date: string;
  status: string;
  gross: number;
  advance_recovery: number;
  deductions: number;
  net_payable: number;
  paid_amount: number;
  balance: number;
  payments: { id: string; amount: number; mode: string; date: string; receipt_no: string }[];
}

export default function WorkerHistory() {
  const { user } = useAuth();
  const { data, loading, refreshing, reload } = useData(
    () => get<{ settlements: Settlement[]; advances: { id: string; amount: number; date: string; mode: string; recovered_amount: number }[] }>(`/workers/${user!.id}/settlements`),
    [user?.id],
    'worker-history',
  );
  const [open, setOpen] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <H style={{ marginTop: 0 }}>{t('settlements')}</H>
      {!data?.settlements.length ? <Empty icon="receipt-outline" text={t('nothingYet')} /> : null}
      {data?.settlements.map((s) => (
        <Card key={s.cycle_id} onPress={() => setOpen(open === s.cycle_id ? null : s.cycle_id)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>
              {fmtDate(s.from_date)} – {fmtDate(s.to_date)}
            </Text>
            <StatusChip status={s.balance <= 0 ? 'PAID' : 'APPROVED'} label={s.balance <= 0 ? t('st_PAID') : t('balance')} />
          </Row>
          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <Muted>{s.cycle_no}</Muted>
            <Text style={{ fontSize: 24, fontWeight: '900', color: C.green }}>{inr(s.paid_amount, 0)}</Text>
          </Row>
          {open === s.cycle_id ? (
            <>
              <Line label={t('gross')} value={inr(s.gross)} />
              <Line label={t('advanceCut')} value={`- ${inr(s.advance_recovery)}`} color={C.red} />
              <Line label={t('deductions')} value={`- ${inr(s.deductions)}`} color={C.red} />
              <Line label={t('paid')} value={inr(s.paid_amount)} bold color={C.green} />
              {s.balance > 0 ? <Line label={t('balance')} value={inr(s.balance)} bold /> : null}
              {s.payments.map((p) => (
                <Muted key={p.id}>
                  {fmtDate(p.date)} · {p.mode} · {p.receipt_no} · {inr(p.amount)}
                </Muted>
              ))}
              <Btn
                title={t('shareSlip')}
                icon="logo-whatsapp"
                color={C.green}
                loading={sharing === s.cycle_id}
                style={{ marginTop: 12 }}
                onPress={async () => {
                  setSharing(s.cycle_id);
                  try {
                    await shareSlip(s.cycle_id, user!.id);
                  } catch (e) {
                    notify((e as Error).message);
                  } finally {
                    setSharing(null);
                  }
                }}
              />
            </>
          ) : null}
        </Card>
      ))}
      <H>{t('advances')}</H>
      {!data?.advances.length ? <Muted>{t('nothingYet')}</Muted> : null}
      {data?.advances.map((a) => (
        <Card key={a.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 17, fontWeight: '700' }}>
              {fmtDate(a.date)} · {a.mode}
            </Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: C.red }}>{inr(a.amount, 0)}</Text>
          </Row>
          {a.recovered_amount ? <Muted>{t('advanceCut')}: {inr(a.recovered_amount, 0)}</Muted> : null}
        </Card>
      ))}
    </Screen>
  );
}
