import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { cache, secure } from './storage';

/** Backend base URL: EXPO_PUBLIC_API_URL env var wins, then app.json extra.apiUrl. */
// On the hosted web app (served by the API itself) the API is the same origin.
// For local web dev against a separate API, set EXPO_PUBLIC_API_URL.
const sameOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';
export const API_URL: string = (
  process.env.EXPO_PUBLIC_API_URL ||
  sameOrigin ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  'http://localhost:8000'
).replace(/\/$/, '');

export const fileUrl = (path?: string | null) => (!path ? undefined : path.startsWith('http') ? path : `${API_URL}${path}`);

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    const msg =
      typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message ||
          (Array.isArray(detail) ? (detail as { msg: string }[]).map((d) => d.msg).join(', ') : 'Something went wrong');
    super(msg);
    this.status = status;
    this.detail = detail;
  }
}

let accessToken: string | null = null;
let onLoggedOut: (() => void) | null = null;

export const tokens = {
  async load() {
    accessToken = await secure.get('access');
    return accessToken;
  },
  async save(access: string, refresh: string) {
    accessToken = access;
    await secure.set('access', access);
    await secure.set('refresh', refresh);
  },
  async clear() {
    accessToken = null;
    await secure.del('access');
    await secure.del('refresh');
  },
  onLogout(fn: () => void) {
    onLoggedOut = fn;
  },
};

async function refresh(): Promise<boolean> {
  const rt = await secure.get('refresh');
  if (!rt) return false;
  try {
    const r = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    await tokens.save(d.access_token, d.refresh_token);
    return true;
  } catch {
    return false;
  }
}

type Opts = { method?: string; body?: unknown; params?: Record<string, unknown>; form?: FormData; raw?: boolean };

function qs(params?: Record<string, unknown>) {
  if (!params) return '';
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.append(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T = any>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}${qs(opts.params)}`, {
      method: opts.method || (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'No internet / server not reachable');
  }
  if (res.status === 401 && !retried && path !== '/auth/refresh') {
    if (await refresh()) return api<T>(path, opts, true);
    await tokens.clear();
    onLoggedOut?.();
  }
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail);
  }
  if (opts.raw) return res as unknown as T;
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}

export const get = <T = any>(path: string, params?: Record<string, unknown>) => api<T>(path, { params });
export const post = <T = any>(path: string, body?: unknown, params?: Record<string, unknown>) =>
  api<T>(path, { method: 'POST', body: body ?? {}, params });
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string, params?: Record<string, unknown>) => api<T>(path, { method: 'DELETE', params });

// ---------------- offline queue ----------------
// Shop floors have patchy signal. Worker "Done" taps and supervisor checks are queued when offline and
// replayed in order when the phone reconnects. The server rejects stale transitions with 409 -> dropped + reported.

export interface QueuedAction {
  id: string;
  path: string;
  body: unknown;
  label: string;
  at: number;
  jobIds?: string[];
}

const QKEY = 'offline-queue';
let listeners: ((q: QueuedAction[]) => void)[] = [];

export async function getQueue(): Promise<QueuedAction[]> {
  return (await cache.get<QueuedAction[]>(QKEY)) || [];
}

async function setQueue(q: QueuedAction[]) {
  await cache.set(QKEY, q);
  listeners.forEach((l) => l(q));
}

export function onQueueChange(fn: (q: QueuedAction[]) => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** POST now if online; if the network is down, queue it and resolve with {queued:true}. */
export async function postOrQueue<T = any>(path: string, body: unknown, label: string, jobIds?: string[]): Promise<T | { queued: true }> {
  const net = await NetInfo.fetch();
  if (net.isConnected === false) {
    const q = await getQueue();
    q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, path, body, label, at: Date.now(), jobIds });
    await setQueue(q);
    return { queued: true };
  }
  try {
    return await post<T>(path, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const q = await getQueue();
      q.push({ id: `${Date.now()}`, path, body, label, at: Date.now(), jobIds });
      await setQueue(q);
      return { queued: true };
    }
    throw e;
  }
}

let flushing = false;
export async function flushQueue(): Promise<{ sent: number; failed: { label: string; error: string }[] }> {
  if (flushing) return { sent: 0, failed: [] };
  flushing = true;
  const failed: { label: string; error: string }[] = [];
  let sent = 0;
  try {
    let q = await getQueue();
    while (q.length) {
      const item = q[0];
      try {
        await post(item.path, item.body);
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // still offline, keep the rest
        failed.push({ label: item.label, error: (e as Error).message });
      }
      q = q.slice(1);
      await setQueue(q);
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

NetInfo.addEventListener((s) => {
  if (s.isConnected) flushQueue();
});
