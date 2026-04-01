import { env } from '../api/env';
import { TokenBundle } from '../../shared/types/auth';

export async function getTokenBundle(): Promise<TokenBundle | null> {
  const accessToken = localStorage.getItem(env.accessTokenKey);
  const refreshToken = localStorage.getItem(env.refreshTokenKey);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function setTokenBundle(tokens: TokenBundle): Promise<void> {
  localStorage.setItem(env.accessTokenKey, tokens.accessToken);
  localStorage.setItem(env.refreshTokenKey, tokens.refreshToken);
}

export async function clearTokenBundle(): Promise<void> {
  localStorage.removeItem(env.accessTokenKey);
  localStorage.removeItem(env.refreshTokenKey);
}
