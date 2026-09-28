import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Btn, Card, Loading, Muted, Pill, Row, Screen, StatusChip, Wrap } from '@/components/ui';
import { get } from '@/lib/api';
import { useData } from '@/lib/hooks';
import type { User } from '@/lib/types';

export default function Users() {
  const [role, setRole] = useState<string>('');
  const [inactive, setInactive] = useState(false);
  const { data, loading, refreshing, reload } = useData(() => get<User[]>('/users', { role, include_inactive: inactive }), [role, inactive]);
  return (
    <Screen refreshing={refreshing} onRefresh={reload} footer={<Btn icon="person-add" title="Add person" onPress={() => router.push('/supervisor/worker-form')} />}>
      <Wrap style={{ marginBottom: 12 }}>
        {['', 'ADMIN', 'SUPERVISOR', 'WORKER'].map((r) => (
          <Pill key={r} label={r || 'All'} active={role === r} onPress={() => setRole(r)} />
        ))}
        <Pill label="Show inactive" active={inactive} onPress={() => setInactive(!inactive)} />
      </Wrap>
      {loading && !data ? <Loading /> : null}
      {data?.map((u) => (
        <Card key={u.id} onPress={() => router.push(`/supervisor/worker-form?id=${u.id}`)} style={{ padding: 12, opacity: u.is_active ? 1 : 0.5 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>{u.name}</Text>
              <Muted>{u.pending_mobile ? 'no mobile yet' : `+91 ${u.mobile}`}</Muted>
            </View>
            <Row gap={4}>
              {u.roles.map((r) => (
                <StatusChip key={r} status={r === 'ADMIN' ? 'PAID' : r === 'SUPERVISOR' ? 'CHECKED' : 'ASSIGNED'} label={r} />
              ))}
            </Row>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
