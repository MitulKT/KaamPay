import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { getQueue, onQueueChange, type QueuedAction } from './api';
import { cache } from './storage';

/** Loads data, reloads when the screen regains focus, keeps the last good copy in cache for offline use. */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = [], cacheKey?: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const d = await loader();
        if (!mounted.current) return;
        setData(d);
        setError(null);
        if (cacheKey) cache.set(cacheKey, d);
      } catch (e) {
        if (!mounted.current) return;
        setError((e as Error).message);
        if (cacheKey) {
          const c = await cache.get<T>(cacheKey);
          if (c) setData(c);
        }
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { data, setData, error, loading, refreshing, reload: () => load(true) };
}

export function useQueue(): QueuedAction[] {
  const [q, setQ] = useState<QueuedAction[]>([]);
  useEffect(() => {
    getQueue().then(setQ);
    return onQueueChange(setQ);
  }, []);
  return q;
}

/** Cross-platform confirm (Alert on phones, window.confirm on web). */
export function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', onPress: () => resolve(true) },
    ]),
  );
}

export function notify(title: string, message = '') {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
