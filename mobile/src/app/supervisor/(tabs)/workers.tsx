import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { Btn, Card, Empty, Loading, Muted, Row, Screen, SearchInput } from '@/components/ui';
import { fileUrl, get } from '@/lib/api';
import { inr } from '@/lib/format';
import { useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { User } from '@/lib/types';

export default function Workers() {
  const [q, setQ] = useState('');
  const { data, loading, refreshing, reload } = useData(() => get<User[]>('/users', { role: 'WORKER', with_summary: true }), [], 'workers');
  const list = (data || []).filter((w) => !q || `${w.name} ${w.name_local} ${w.mobile}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen refreshing={refreshing} onRefresh={reload} footer={<Btn icon="person-add" title="Add worker" onPress={() => router.push('/supervisor/worker-form')} />}>
      <SearchInput value={q} onChangeText={setQ} placeholder="Search name / mobile" />
      {loading && !data ? <Loading /> : null}
      {data && !list.length ? <Empty icon="people-outline" text={q ? `No workers matching "${q}"` : 'No workers yet — add your first one below'} /> : null}
      {list.map((w) => (
        <Card key={w.id} onPress={() => router.push(`/supervisor/worker/${w.id}`)}>
          <Row>
            {w.photo_url ? (
              <Image source={{ uri: fileUrl(w.photo_url) }} style={{ width: 44, height: 44, borderRadius: 22 }} />
            ) : (
              <Ionicons name="person-circle" size={44} color={C.muted} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '800' }}>
                {w.name} {w.name_local ? <Text style={{ color: C.muted, fontWeight: '600' }}>{w.name_local}</Text> : null}
              </Text>
              <Muted>
                {w.profile?.worker_code} · {w.pending_mobile ? '⚠ no mobile' : `+91 ${w.mobile}`}
              </Muted>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontWeight: '800', color: C.green }}>{inr(w.summary?.earned_this_month, 0)}</Text>
              <Muted>{w.summary?.open_jobs ?? 0} open</Muted>
            </View>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
