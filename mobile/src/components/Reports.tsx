import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { get } from '@/lib/api';
import { downloadExport } from '@/lib/files';
import { fmtDate, fmtDateTime, inr, monthRange } from '@/lib/format';
import { notify, useData } from '@/lib/hooks';
import { C, STATUS_COLORS } from '@/lib/theme';

import { Btn, Card, Empty, Kpi, Loading, Muted, Pill, Progress, Row, Screen, StatusChip, Wrap } from './ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const REPORTS: { key: string; title: string; icon: IconName; admin?: boolean; dated?: boolean }[] = [
  { key: 'status-board', title: 'Job status board', icon: 'stats-chart', dated: true },
  { key: 'lot-progress', title: 'Lot progress', icon: 'layers' },
  { key: 'worker-productivity', title: 'Worker productivity', icon: 'people', dated: true },
  { key: 'ageing', title: 'Ageing / WIP', icon: 'time' },
  { key: 'timeline', title: 'Timeline', icon: 'git-commit', admin: true, dated: true },
  { key: 'payout-register', title: 'Payout register', icon: 'wallet', admin: true, dated: true },
  { key: 'lot-cost', title: 'Lot labour cost', icon: 'pricetags', admin: true },
  { key: 'work-type-cost', title: 'Work type cost', icon: 'cut', admin: true, dated: true },
  { key: 'monthly-summary', title: 'Monthly labour summary', icon: 'calendar', admin: true },
  { key: 'exceptions', title: 'Exceptions', icon: 'warning', admin: true, dated: true },
];

const RANGES = [
  { k: 'this', l: 'This month', r: () => monthRange(0) },
  { k: 'last', l: 'Last month', r: () => monthRange(-1) },
  { k: 'today', l: 'Today', r: () => ({ from: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), to: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) }) },
];

function Bar({ label, value, max, color = C.primary, right }: { label: string; value: number; max: number; color?: string; right?: string }) {
  return (
    <Row style={{ marginVertical: 3 }}>
      <Text style={{ width: 96, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 14, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${max ? (100 * value) / max : 0}%`, height: 14, backgroundColor: color }} />
      </View>
      <Text style={{ width: 84, textAlign: 'right', fontSize: 12, fontWeight: '700' }}>{right ?? value}</Text>
    </Row>
  );
}

function StackedBar({ parts }: { parts: { v: number; c: string }[] }) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <View style={{ flexDirection: 'row', height: 16, borderRadius: 4, overflow: 'hidden', flex: 1, backgroundColor: C.border }}>
      {parts.map((p, i) => (p.v ? <View key={i} style={{ width: `${(100 * p.v) / total}%`, backgroundColor: p.c }} /> : null))}
    </View>
  );
}

export function ReportView({ reportKey }: { reportKey: string }) {
  const def = REPORTS.find((r) => r.key === reportKey);
  const [range, setRange] = useState('this');
  const [busy, setBusy] = useState(false);
  const r = RANGES.find((x) => x.k === range)!.r();
  const params = def?.dated ? { date_from: r.from, date_to: r.to } : {};
  const { data, loading, refreshing, reload } = useData(() => get(`/reports/${reportKey}`, params), [reportKey, range]);

  const exportXlsx = async () => {
    setBusy(true);
    try {
      await downloadExport(`/reports/${reportKey}`, `${reportKey}.xlsx`, { ...params, format: 'xlsx' } as Record<string, string>);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '900', flex: 1 }}>{def?.title}</Text>
        <Btn small outline icon="download" title="Excel" loading={busy} onPress={exportXlsx} />
      </Row>
      {def?.dated ? (
        <Wrap style={{ marginBottom: 12 }}>
          {RANGES.map((x) => (
            <Pill key={x.k} label={x.l} active={range === x.k} onPress={() => setRange(x.k)} />
          ))}
        </Wrap>
      ) : null}
      {loading && !data ? <Loading /> : null}
      {data ? <Body reportKey={reportKey} data={data} /> : null}
    </Screen>
  );
}

const STS = ['ASSIGNED', 'STARTED', 'DONE', 'CHECKED', 'APPROVED', 'PAID'];

function Body({ reportKey, data }: { reportKey: string; data: any }) {
  const rows: any[] = data.rows || [];
  switch (reportKey) {
    case 'status-board':
      return (
        <>
          <Wrap>
            {STS.map((s) => (
              <Kpi key={s} label={s} value={data.summary[s]?.count ?? 0} sub={inr(data.summary[s]?.amount, 0)} color={STATUS_COLORS[s]} />
            ))}
          </Wrap>
          <Card>
            <Text style={{ fontWeight: '800', marginBottom: 8 }}>By lot</Text>
            {rows.map((r) => (
              <Row key={r.lot_id} style={{ marginVertical: 4 }}>
                <Text style={{ width: 56, fontWeight: '700' }}>{r.lot_no}</Text>
                <StackedBar parts={STS.map((s) => ({ v: r[s], c: STATUS_COLORS[s] }))} />
              </Row>
            ))}
            {!rows.length ? <Muted>No jobs in this period</Muted> : null}
          </Card>
        </>
      );
    case 'lot-progress':
      return (
        <>
          <Wrap>
            <Kpi label="Lots" value={data.summary.lots} />
            <Kpi label="Behind schedule" value={data.summary.behind} color={C.red} />
          </Wrap>
          {rows.map((r) => (
            <Card key={r.lot_id} style={r.behind ? { borderLeftWidth: 4, borderLeftColor: C.red } : undefined}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 18, fontWeight: '900' }}>Lot {r.lot_no}</Text>
                <Text style={{ fontWeight: '800' }}>{r.percent_done}%</Text>
              </Row>
              <Progress pct={r.percent_done} color={r.behind ? C.red : C.green} />
              <Muted style={{ marginTop: 4 }}>
                {r.done_cells}/{r.total_cells} cells done · {r.assigned_cells} assigned
                {r.target_date ? ` · due ${fmtDate(r.target_date)} (${r.days_left}d)` : ''}
              </Muted>
            </Card>
          ))}
        </>
      );
    case 'worker-productivity': {
      const max = Math.max(1, ...rows.map((r) => r.pieces));
      return (
        <Card>
          {rows.map((r) => (
            <View key={r.worker_id} style={{ marginBottom: 8 }}>
              <Bar label={r.worker_name} value={r.pieces} max={max} right={`${r.pieces} pcs`} />
              <Muted>
                {r.jobs_done} jobs · {r.avg_pieces_per_day}/day · {r.rejections} rejected ({r.rejection_pct}%)
              </Muted>
            </View>
          ))}
          {!rows.length ? <Muted>No completed jobs in this period</Muted> : null}
        </Card>
      );
    }
    case 'ageing':
      return (
        <>
          <Card>
            <Row>
              <Text style={{ width: 90 }} />
              {['0-1', '2-3', '4-7', '7+'].map((b) => (
                <Text key={b} style={{ flex: 1, textAlign: 'center', fontWeight: '800' }}>
                  {b}d
                </Text>
              ))}
            </Row>
            {Object.entries(data.summary).map(([s, b]: [string, any]) => (
              <Row key={s} style={{ marginTop: 6 }}>
                <StatusChip status={s} />
                <View style={{ width: 90 - 70 }} />
                {['0-1', '2-3', '4-7', '7+'].map((k) => (
                  <Text key={k} style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: k === '7+' && b[k] ? C.red : C.text }}>
                    {b[k]}
                  </Text>
                ))}
              </Row>
            ))}
          </Card>
          {rows.slice(0, 50).map((j) => (
            <Card key={j.id} style={{ padding: 10 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700' }}>
                  {j.worker_name} · Lot {j.lot_no} · {j.work_type_code}
                </Text>
                <Text style={{ fontWeight: '800', color: j.age_days > 7 ? C.red : C.text }}>{j.age_days}d</Text>
              </Row>
              <StatusChip status={j.status} />
            </Card>
          ))}
        </>
      );
    case 'timeline':
      return (
        <>
          {rows.map((e, i) => (
            <Row key={i} style={{ alignItems: 'flex-start', marginBottom: 10 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS_COLORS[e.event] || C.primary, marginTop: 5 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700' }}>
                  {fmtDateTime(e.at)} · {e.event}
                </Text>
                <Text>
                  {e.worker} – {e.what} {e.amount ? `· ${inr(e.amount)}` : ''}
                </Text>
                <Muted>
                  by {e.by} {e.note ? `· ${e.note}` : ''}
                </Muted>
              </View>
            </Row>
          ))}
          {!rows.length ? <Empty text="No events" /> : null}
        </>
      );
    case 'payout-register':
      return (
        <>
          <Wrap>
            <Kpi label="Gross" value={inr(data.summary.gross, 0)} />
            <Kpi label="Net payable" value={inr(data.summary.net_payable, 0)} />
            <Kpi label="Paid" value={inr(data.summary.paid, 0)} color={C.green} />
            <Kpi label="Balance" value={inr(data.summary.balance, 0)} color={C.red} />
          </Wrap>
          <Table cols={['cycle_no', 'worker', 'gross', 'advance_recovery', 'deductions', 'net_payable', 'paid', 'balance', 'mode']} rows={rows} money={['gross', 'advance_recovery', 'deductions', 'net_payable', 'paid', 'balance']} />
        </>
      );
    case 'lot-cost':
      return (
        <>
          <Wrap>
            <Kpi label="Estimated labour" value={inr(data.summary.estimated, 0)} />
            <Kpi label="Approved labour" value={inr(data.summary.approved, 0)} color={C.green} />
          </Wrap>
          {rows.map((r) => (
            <Card key={r.lot_id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 18, fontWeight: '900' }}>Lot {r.lot_no}</Text>
                <Text style={{ fontSize: 18, fontWeight: '900', color: C.primary }}>{inr(r.estimated_cost_per_piece)}/pc</Text>
              </Row>
              <Muted>
                {r.pieces} pcs · est {inr(r.estimated_cost, 0)} · approved {inr(r.approved_cost, 0)} · pending {inr(r.pending_cost, 0)}
              </Muted>
              <Progress pct={r.estimated_cost ? (100 * r.approved_cost) / r.estimated_cost : 0} />
            </Card>
          ))}
        </>
      );
    case 'work-type-cost': {
      const max = Math.max(1, ...rows.map((r) => r.amount));
      return (
        <Card>
          {rows.map((r) => (
            <View key={r.work_type_id} style={{ marginBottom: 8 }}>
              <Bar label={r.code} value={r.amount} max={max} right={inr(r.amount, 0)} />
              <Muted>
                {r.pieces} pcs · avg {r.avg_rate ?? '—'} · range {r.min_rate ?? '—'}–{r.max_rate ?? '—'}
              </Muted>
            </View>
          ))}
        </Card>
      );
    }
    case 'monthly-summary': {
      const max = Math.max(1, ...rows.map((r) => r.labour_cost));
      return (
        <>
          <Card>
            {rows.map((r) => (
              <Bar key={r.month} label={r.month} value={r.labour_cost} max={max} right={inr(r.labour_cost, 0)} />
            ))}
          </Card>
          {[...rows].reverse().map((r) => (
            <Card key={r.month}>
              <Text style={{ fontSize: 17, fontWeight: '900' }}>{r.month}</Text>
              <Muted>
                {inr(r.labour_cost, 0)} · {r.workers_paid} workers · avg {inr(r.avg_per_worker, 0)}
              </Muted>
              <Text style={{ marginTop: 4, fontWeight: '700' }}>Top: {r.top_earners.map((x: any) => `${x.name} ${inr(x.amount, 0)}`).join(', ')}</Text>
            </Card>
          ))}
        </>
      );
    }
    case 'exceptions':
      return (
        <>
          <Wrap>
            {Object.entries(data.summary).map(([k, v]) => (
              <Kpi key={k} label={k.replace(/_/g, ' ')} value={v as number} color={C.red} />
            ))}
          </Wrap>
          {rows.map((r, i) => (
            <Card key={i} style={{ padding: 10 }}>
              <Text style={{ fontWeight: '800' }}>
                {r.kind.replace(/_/g, ' ')} · {fmtDateTime(r.at)}
              </Text>
              <Text>{r.detail}</Text>
              <Muted>by {r.by}</Muted>
            </Card>
          ))}
          {!rows.length ? <Empty text="No exceptions 👍" /> : null}
        </>
      );
    default:
      return <Table cols={rows[0] ? Object.keys(rows[0]).slice(0, 8) : []} rows={rows} />;
  }
}

export function Table({ cols, rows, money = [] }: { cols: string[]; rows: any[]; money?: string[] }) {
  return (
    <ScrollView horizontal>
      <View>
        <Row style={{ backgroundColor: C.border, paddingVertical: 6 }}>
          {cols.map((c) => (
            <Text key={c} style={{ width: 110, fontWeight: '800', fontSize: 12, paddingHorizontal: 6 }}>
              {c.replace(/_/g, ' ')}
            </Text>
          ))}
        </Row>
        {rows.map((r, i) => (
          <Row key={i} style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: C.border }}>
            {cols.map((c) => (
              <Text key={c} style={{ width: 110, fontSize: 12, paddingHorizontal: 6 }}>
                {money.includes(c) ? inr(r[c]) : typeof r[c] === 'string' && /^\d{4}-\d\d-\d\dT/.test(r[c]) ? fmtDate(r[c]) : String(r[c] ?? '')}
              </Text>
            ))}
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}
