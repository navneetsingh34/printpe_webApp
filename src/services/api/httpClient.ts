import { env } from './env';
import { clearTokenBundle, getTokenBundle, setTokenBundle } from '../storage/tokenStorage';

type ApiEnvelope<T> = { success?: boolean; data?: T; message?: string | string[] };
type RequestOptions = { auth?: boolean; retryOnUnauthorized?: boolean };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

function normalizeMessage(value: unknown): string {
  if (!value) return 'Request failed';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') return value;
  return 'Request failed';
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapEnvelope<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'success' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (envelope.success === true) return envelope.data as T;
    if (envelope.success === false) throw new ApiError(normalizeMessage(envelope.message), 400);
  }
  return payload as T;
}

async function refreshAccessToken(): Promise<string | null> {
  const bundle = await getTokenBundle();
  if (!bundle?.refreshToken) return null;
  const response = await fetch(`${env.apiBaseUrl.replace(/\/$/, '')}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: bundle.refreshToken }),
  });
  const payload = await parseResponseBody(response);
  if (!response.ok) {
    await clearTokenBundle();
    return null;
  }
  const data = unwrapEnvelope<{ accessToken: string; refreshToken: string }>(payload);
  if (!data?.accessToken || !data?.refreshToken) {
    await clearTokenBundle();
    return null;
  }
  await setTokenBundle(data);
  return data.accessToken;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const { auth = true, retryOnUnauthorized = true } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const bundle = await getTokenBundle();
    if (bundle?.accessToken) headers.set('Authorization', `Bearer ${bundle.accessToken}`);
  }
  const response = await fetch(`${env.apiBaseUrl.replace(/\/$/, '')}${path}`, { ...init, headers, signal: controller.signal });
  clearTimeout(timeout);
  const payload = await parseResponseBody(response);
  if (response.status === 401 && auth && retryOnUnauthorized) {
    if (!refreshInFlight) refreshInFlight = refreshAccessToken().finally(() => { refreshInFlight = null; });
    const token = await refreshInFlight;
    if (token) return apiRequest<T>(path, init, { auth, retryOnUnauthorized: false });
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? normalizeMessage((payload as ApiEnvelope<T>).message)
      : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return unwrapEnvelope<T>(payload);
}
