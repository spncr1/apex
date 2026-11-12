import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { supabase } from '../../services/supabase';
import { startSessionSync } from '../sessions/sessionSync';

type AuthStatus = 'loading' | 'signed_in' | 'offline' | 'signed_out';

const lastAccountKey = 'workout-tracker:last-account-id';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  accountId: string | null;
  configurationMissing: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; confirmationRequired: boolean }>;
  signOut: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [offlineAccountId, setOfflineAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    supabase ? 'loading' : 'signed_out',
  );

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (nextSession) {
        localStorage.setItem(lastAccountKey, nextSession.user.id);
        setOfflineAccountId(null);
        setSession(nextSession);
        setStatus('signed_in');
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem(lastAccountKey);
        setOfflineAccountId(null);
        setSession(null);
        setStatus('signed_out');
      }
    });

    void supabase.auth
      .getSession()
      .then(({ data: result, error }) => {
        if (!active) return;
        if (result.session) {
          localStorage.setItem(lastAccountKey, result.session.user.id);
          setSession(result.session);
          setStatus('signed_in');
        } else if (isAuthRetryableFetchError(error)) {
          const savedAccountId = localStorage.getItem(lastAccountKey);
          setOfflineAccountId(savedAccountId);
          setStatus(savedAccountId ? 'offline' : 'signed_out');
        } else {
          localStorage.removeItem(lastAccountKey);
          setStatus('signed_out');
        }
      })
      .catch(() => {
        if (!active) return;
        setStatus('signed_out');
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const accountId = session?.user.id;
  useEffect(() => {
    if (status !== 'signed_in' || !accountId) return;
    return startSessionSync(accountId);
  }, [accountId, status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      accountId: session?.user.id ?? offlineAccountId,
      configurationMissing: !supabase,
      async signIn(email, password) {
        if (!supabase) return 'Supabase is not configured.';
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        return error?.message ?? null;
      },
      async signUp(email, password) {
        if (!supabase) {
          return {
            error: 'Supabase is not configured.',
            confirmationRequired: false,
          };
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        return {
          error: error?.message ?? null,
          confirmationRequired: !error && !data.session,
        };
      },
      async signOut() {
        if (!supabase) return 'Supabase is not configured.';
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (!error) {
          localStorage.removeItem(lastAccountKey);
          setOfflineAccountId(null);
          setSession(null);
          setStatus('signed_out');
        }
        return error?.message ?? null;
      },
    }),
    [offlineAccountId, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
