import { apiRequest } from './httpClient';
import { AuthResponse, AuthUser, ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from '../../shared/types/auth';

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(input) }, { auth: false });
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ ...input, role: input.role ?? 'user' }) }, { auth: false });
}

export function forgotPassword(input: ForgotPasswordInput): Promise<{ message: string }> {
  return apiRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify(input) }, { auth: false });
}

export function resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
  return apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify(input) }, { auth: false });
}

export function getMe(): Promise<AuthUser> {
  return apiRequest('/auth/me', { method: 'GET' });
}
