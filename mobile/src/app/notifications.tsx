import React, { useEffect } from 'react';
import { Text } from 'react-native';

import { Card, Empty, Loading, Muted, Screen } from '@/components/ui';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useData } from '@/lib/hooks';
import { t } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Notification } from '@/lib/types';

export default function Notifications() {
  const { data, loading, refreshing, reload } = useData(() => get<{ items: Notification[]; unread: number }>('/notifications'));
  useEffect(() => {
    if (data?.unread) post('/notifications/read-all').catch(() => undefined);
  }, [data?.unread]);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      {loading && !data ? <Loading /> : null}
      {data && !data.items.length ? <Empty icon="notifications-off-outline" text={t('nothingYet')} /> : null}
      {data?.items.map((n) => (
        <Card key={n.id} style={{ borderLeftWidth: n.read ? 0 : 4, borderLeftColor: C.primary }}>
          <Text style={{ fontSize: 17, fontWeight: '800' }}>{n.title}</Text>
          <Text style={{ fontSize: 16, marginTop: 2 }}>{n.body}</Text>
          <Muted style={{ marginTop: 4 }}>{fmtDateTime(n.at)}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
