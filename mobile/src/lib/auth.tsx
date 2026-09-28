import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, get, patch, post, tokens } from './api';
import { setLang } from './i18n';
import { registerPush } from './push';
import { cache } from './storage';
import type { Company, Lang, Role, User, WorkerProfile } from './types';

interface AuthState {
  ready: boolean;
  user: User | null;
  company: Company | null;
  profile: WorkerProfile | null;
  role: Role | null;
  lang: Lang;
  setRole: (r: Role) => Promise<void>;
  setLanguage: (l: Lang) => Promise<void>;
  requestOtp: (mobile: string) => Promise<{ registered: boolean }>;
  verifyOtp: (mobile: string, code: string, companyId?: string) => Promise<{ choose_company?: { id: string; name: string }[]; code?: string }>;
  signup: (d: { company_name: string; owner_name: string; mobile: string; code: string }) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [role, setRoleState] = useState<Role | null>(null);
  const [lang, setLangState] = useState<Lang>('hi');

  const applyUser = useCallback(async (u: User, c: Company | null, p?: WorkerProfile | null) => {
    setUser(u);
    setCompany(c);
    setProfile(p ?? null);
    const l = (u.preferred_language || 'hi') as Lang;
    setLang(l);
    setLangState(l);
    const last = await cache.get<Role>(`role-${u.id}`);
    setRoleState(last && u.roles.includes(last) ? last : u.roles.length === 1 ? u.roles[0] : null);
    await cache.set('me', { user: u, company: c, profile: p });
  }, []);

  const refreshMe = useCallback(async () => {
    const d = await get<{ user: User; company: Company; worker_profile: WorkerProfile | null }>('/auth/me');
    await applyUser(d.user, d.company, d.worker_profile);
  }, [applyUser]);

  const logout = useCallback(async () => {
    await tokens.clear();
    setUser(null);
    setCompany(null);
    setRoleState(null);
  }, []);

  useEffect(() => {
    tokens.onLogout(() => {
      setUser(null);
      setRoleState(null);
    });
    (async () => {
      const t = await tokens.load();
      if (t) {
        try {
          await refreshMe();
        } catch (e) {
          // offline start: use cached profile so workers can still see and tap their jobs
          const c = await cache.get<{ user: User; company: Company; profile: WorkerProfile }>('me');
          if (c && (e as { status?: number }).status === 0) await applyUser(c.user, c.company, c.profile);
        }
      }
      setReady(true);
    })();
  }, [refreshMe, applyUser]);

  useEffect(() => {
    if (user) registerPush().catch(() => undefined);
  }, [user?.id]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      company,
      profile,
      role,
      lang,
      async setRole(r) {
        setRoleState(r);
        if (user) await cache.set(`role-${user.id}`, r);
      },
      async setLanguage(l) {
        setLang(l);
        setLangState(l);
        const u = await patch<User>('/auth/me', { preferred_language: l });
        setUser((prev) => (prev ? { ...prev, preferred_language: u.preferred_language } : prev));
      },
      async requestOtp(mobile) {
        return post('/auth/otp/request', { mobile });
      },
      async verifyOtp(mobile, code, companyId) {
        const d = await post('/auth/otp/verify', { mobile, code, company_id: companyId });
        if (d.choose_company) return d;
        await tokens.save(d.access_token, d.refresh_token);
        await applyUser(d.user, d.company);
        await refreshMe();
        return {};
      },
      async signup(body) {
        const d = await post('/auth/signup', body);
        await tokens.save(d.access_token, d.refresh_token);
        await applyUser(d.user, d.company);
      },
      refreshMe,
      logout,
    }),
    [ready, user, company, profile, role, lang, applyUser, refreshMe, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

export const homeFor = (r: Role | null) =>
  r === 'ADMIN' ? '/admin' : r === 'SUPERVISOR' ? '/supervisor' : r === 'WORKER' ? '/worker' : '/role';

// re-export for screens that need raw api access
export { api };
