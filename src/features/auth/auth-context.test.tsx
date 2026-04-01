import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth-context';

vi.mock('../../services/api/authApi', () => ({
  getMe: vi.fn().mockResolvedValue({ id: '1', email: 'a@b.com' }),
  login: vi.fn(),
  register: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock('../../services/storage/tokenStorage', () => ({
  getTokenBundle: vi.fn().mockResolvedValue(null),
  setTokenBundle: vi.fn(),
  clearTokenBundle: vi.fn(),
}));

function StatusProbe() {
  const { status } = useAuth();
  return <div>{status}</div>;
}

describe('AuthProvider', () => {
  it('starts signedOut when no token exists', async () => {
    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );
    expect(await screen.findByText('signedOut')).toBeInTheDocument();
  });
});
