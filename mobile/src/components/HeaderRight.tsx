import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { get } from '@/lib/api';
import { C } from '@/lib/theme';

/** Bell (with unread count) + profile icon for every role's header. */
export function HeaderRight() {
  const [unread, setUnread] = useState(0);
  useFocusEffect(
    useCallback(() => {
      get<{ unread: number }>('/notifications', { unread_only: true })
        .then((d) => setUnread(d.unread))
        .catch(() => undefined);
    }, []),
  );
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginRight: 6 }}>
      <Pressable
        onPress={() => router.push('/notifications')}
        style={box}
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <Ionicons name="notifications-outline" size={26} color={C.primary} />
        {unread ? (
          <View style={{ position: 'absolute', top: 4, right: 2, backgroundColor: C.red, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable onPress={() => router.push('/profile')} style={box} accessibilityRole="button" accessibilityLabel="Profile">
        <Ionicons name="person-circle-outline" size={28} color={C.primary} />
      </Pressable>
    </View>
  );
}

// 44×44 = minimum comfortable thumb target (Apple HIG / Material).
const box = { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' } as const;
