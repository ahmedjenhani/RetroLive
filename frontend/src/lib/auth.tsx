import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, UserDto } from '@retrolive/shared';
import { api } from './api';
import { readJson, writeStorage } from './storage';

const KEY = 'retrolive.auth';

interface Stored {
  token: string;
  user: UserDto;
}

interface AuthContextValue {
  token: string | null;
  user: UserDto | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Stored | null>(() => readJson<Stored>(KEY));

  const start = useCallback((res: AuthResponse) => {
    const stored = { token: res.token, user: res.user };
    writeStorage(KEY, JSON.stringify(stored));
    setSession(stored);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token: session?.token ?? null,
      user: session?.user ?? null,
      login: async (email, password) => start(await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } })),
      register: async (name, email, password) =>
        start(await api<AuthResponse>('/auth/register', { method: 'POST', body: { name, email, password } })),
      logout: () => {
        writeStorage(KEY, null);
        setSession(null);
      },
    }),
    [session, start],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
