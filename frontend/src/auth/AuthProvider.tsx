import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from '../api/client';
import type { Role, SessionPayload, SessionUser } from '../api/types';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);
const SESSION_KEY = ['session'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        const res = await api.get<SessionPayload | { user: null }>('/auth/session');
        return res.user ? (res as SessionPayload) : null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const payload = session.data ?? null;
  useEffect(() => { setCsrfToken(payload?.csrfToken ?? null); }, [payload]);

  useEffect(() => {
    // A 401 on any API call means the session expired or was revoked: drop cached data.
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      qc.setQueryData(SESSION_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<SessionPayload>('/auth/login', { email, password });
    setCsrfToken(res.csrfToken);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    qc.setQueryData(SESSION_KEY, res);
    return res.user;
  }, [qc]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setCsrfToken(null);
      // Keep the session query (observers stay attached) and drop everything else the user loaded.
      qc.setQueryData(SESSION_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    }
  }, [qc]);

  const value = useMemo<AuthState>(() => ({
    user: payload?.user ?? null,
    loading: session.isLoading,
    login,
    logout,
    can: (p) => Boolean(payload?.user.permissions.includes(p)),
    refresh: () => session.refetch(),
  }), [payload, session, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error('useUser requires a signed-in user');
  return user;
}

export const homeFor = (role: Role) => (role === 'admin' ? '/admin' : '/dashboard');
export const roleLabel: Record<Role, string> = { student: 'Learner', teacher: 'Trainer', admin: 'Administrator' };
