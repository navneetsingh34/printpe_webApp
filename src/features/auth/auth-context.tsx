/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { forgotPassword, getMe, login, register, resetPassword } from '../../services/api/authApi';
import { getUnreadCount } from '../../services/api/notificationsApi';
import { clearTokenBundle, getTokenBundle, setTokenBundle } from '../../services/storage/tokenStorage';
import { AuthUser, ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from '../../shared/types/auth';
import { connectNotificationsSocket } from '../../services/realtime/notificationsSocket';
import { connectOrderTrackingSocket } from '../../services/realtime/orderTrackingSocket';
import { connectShopStatusSocket } from '../../services/realtime/shopStatusSocket';
import type { Socket } from 'socket.io-client';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';
type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  unreadCount: number;
  signIn: (input: LoginInput) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (input: ForgotPasswordInput) => Promise<string>;
  confirmPasswordReset: (input: ResetPasswordInput) => Promise<string>;
  refreshUnreadCount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const refreshUnreadCount = useCallback(async () => {
    const response = await getUnreadCount();
    setUnreadCount(response.unreadCount);
  }, []);

  useEffect(() => {
    let notificationsSocket: Socket | null = null;
    let orderSocket: Socket | null = null;
    let shopStatusSocket: Socket | null = null;

    const bootstrap = async () => {
      try {
        const tokens = await getTokenBundle();
        if (!tokens?.accessToken) {
          setStatus('signedOut');
          return;
        }
        const profile = await getMe();
        setUser(profile);
        setStatus('signedIn');
        void refreshUnreadCount().catch(() => setUnreadCount(0));

        notificationsSocket = connectNotificationsSocket(tokens.accessToken, {
          onNotification: () => setUnreadCount((prev) => prev + 1),
          onUnreadCount: (payload) => {
            const next = typeof payload.count === 'number' ? payload.count : 0;
            setUnreadCount(next);
          },
        });
        orderSocket = connectOrderTrackingSocket(tokens.accessToken);
        shopStatusSocket = connectShopStatusSocket(tokens.accessToken);
      } catch {
        await clearTokenBundle();
        setUser(null);
        setUnreadCount(0);
        setStatus('signedOut');
      }
    };
    void bootstrap();

    return () => {
      notificationsSocket?.disconnect();
      orderSocket?.disconnect();
      shopStatusSocket?.disconnect();
    };
  }, [refreshUnreadCount]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      unreadCount,
      signIn: async (input) => {
        const response = await login(input);
        await setTokenBundle({ accessToken: response.accessToken, refreshToken: response.refreshToken });
        setUser(response.user);
        setUnreadCount(0);
        setStatus('signedIn');
      },
      signUp: async (input) => {
        const response = await register(input);
        await setTokenBundle({ accessToken: response.accessToken, refreshToken: response.refreshToken });
        setUser(response.user);
        setStatus('signedIn');
      },
      signOut: async () => {
        await clearTokenBundle();
        setUser(null);
        setUnreadCount(0);
        setStatus('signedOut');
      },
      requestPasswordReset: async (input) => {
        const response = await forgotPassword(input);
        return response.message ?? 'OTP sent successfully.';
      },
      confirmPasswordReset: async (input) => {
        const response = await resetPassword(input);
        return response.message ?? 'Password reset successfully.';
      },
      refreshUnreadCount,
    }),
    [status, user, unreadCount, refreshUnreadCount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
