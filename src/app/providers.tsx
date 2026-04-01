import { ReactNode } from 'react';
import { AuthProvider } from '../features/auth/auth-context';

type Props = {
  children: ReactNode;
};

export function AppProviders({ children }: Props) {
  return <AuthProvider>{children}</AuthProvider>;
}
