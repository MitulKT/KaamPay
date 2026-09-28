import React, { useState } from 'react';
import { Text } from 'react-native';

import { Card, Loading, Muted, Pill, Screen, Wrap } from '@/components/ui';
import { get } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useData } from '@/lib/hooks';

const ENTITIES = ['', 'job', 'lot', 'lot_rate', 'payment', 'advance', 'deduction', 'payout_cycle', 'user', 'company', 'import'];

export default function Audit() {
  const [entity, setEntity] = useState('');
  const { data, loading, refreshing, reload } = useData(() => get<any[]>('/audit-logs', { entity, limit: 300 }), [entity]);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Wrap style={{ marginBottom: 12 }}>
        {ENTITIES.map((e) => (
          <Pill key={e} label={e || 'All'} active={entity === e} onPress={() => setEntity(e)} />
        ))}
      </Wrap>
      {loading && !data ? <Loading /> : null}
      {data?.map((a) => (
        <Card key={a.id} style={{ padding: 10 }}>
          <Text style={{ fontWeight: '800' }}>
            {a.action} · {a.entity}
          </Text>
          <Muted>
            {fmtDateTime(a.at)} · {a.user_name || 'system'}
          </Muted>
          {a.old_value != null ? <Text style={{ fontSize: 11 }} numberOfLines={3}>old: {JSON.stringify(a.old_value)}</Text> : null}
          {a.new_value != null ? <Text style={{ fontSize: 11 }} numberOfLines={4}>new: {JSON.stringify(a.new_value)}</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}
