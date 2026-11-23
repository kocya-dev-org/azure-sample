// サインイン中の利用者が操作を許可されているか。API の /api/me で確かめる（ADR 0015）。
// 画面の無効表示は見た目の制御で、実際の認可は API 側で行う。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';

export type AuthStatus = 'loading' | 'authorized' | 'unauthorized' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  name: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<AuthContextValue>({ status: 'loading', name: '' });

  useEffect(() => {
    let active = true;
    api
      .getMe()
      .then((me) => {
        if (active)
          setValue({ status: me.authorized ? 'authorized' : 'unauthorized', name: me.name });
      })
      .catch(() => {
        if (active) setValue({ status: 'error', name: '' });
      });
    return () => {
      active = false;
    };
  }, []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth は AuthProvider の中で使ってください。');
  return value;
}
