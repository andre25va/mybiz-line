import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DB_TIMEOUT_MS = 5_000;
export const REST_USERS_PATHNAME = '/rest/v1/users';

export type DbErrorKind = 'timeout' | 'network' | 'http' | 'invalid_response';

export class DbError extends Error {
  readonly kind: DbErrorKind;
  readonly status?: number;

  constructor(kind: DbErrorKind, status?: number) {
    super(kind);
    this.name = 'DbError';
    this.kind = kind;
    this.status = status;
  }
}

export type SbInit = RequestInit & { timeoutMs?: number };

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND',
  'EAI_AGAIN', 'ETIMEDOUT', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

export function safeHttpStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value)) {
    const parsed = Number(value);
    return parsed >= 100 && parsed <= 599 ? parsed : undefined;
  }
  return undefined;
}

export function safeNumericProperty(value: unknown, property: string, min: number, max: number): number | undefined {
  try {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const candidate = (value as Record<string, unknown>)[property];
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= min && candidate <= max) {
      return candidate;
    }
    if (typeof candidate === 'string' && /^\d{1,6}$/.test(candidate)) {
      const parsed = Number(candidate);
      return parsed >= min && parsed <= max ? parsed : undefined;
    }
  } catch {
    // Error objects may expose arbitrary getters; never let those values escape into logs.
  }
  return undefined;
}

function hasKnownNetworkCode(error: unknown): boolean {
  const code = (() => {
    try {
      if (!error || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
      return (error as Record<string, unknown>).code;
    } catch {
      return undefined;
    }
  })();
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

export function classifyError(error: unknown): 'timeout' | 'network' | 'http' | 'invalid_response' | 'provider' | 'unknown' {
  if (error instanceof DbError) return error.kind;
  if (error instanceof SyntaxError) return 'invalid_response';
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout';
  if (error instanceof TypeError || hasKnownNetworkCode(error)) return 'network';
  if (safeNumericProperty(error, 'status', 100, 599) !== undefined) return 'http';
  if (safeNumericProperty(error, 'code', 0, 999999) !== undefined) return 'provider';
  return 'unknown';
}

function toDbError(error: unknown): DbError {
  if (error instanceof DbError) return error;
  const kind = classifyError(error);
  if (kind === 'timeout' || kind === 'network' || kind === 'invalid_response') return new DbError(kind);
  return new DbError('network');
}

export function restUrl(path: string): string {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new DbError('invalid_response');
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}/rest/v1${suffix}`;
}

function serviceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new DbError('invalid_response');
  return key;
}

function withoutTimeout(init: SbInit | undefined): RequestInit {
  if (!init) return {};
  const { timeoutMs: _timeoutMs, ...rest } = init;
  return rest;
}

export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.signal) return fetch(input, init);
  return fetch(input, { ...init, signal: AbortSignal.timeout(DB_TIMEOUT_MS) });
}

export async function supabaseRest(path: string, init?: SbInit): Promise<Response> {
  const request = withoutTimeout(init);
  const timeoutMs = init?.timeoutMs ?? DB_TIMEOUT_MS;
  const signal = request.signal ?? AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(restUrl(path), {
      ...request,
      signal,
      headers: {
        apikey: serviceKey(),
        Authorization: `Bearer ${serviceKey()}`,
        Accept: 'application/json',
        ...(request.headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    throw toDbError(error);
  }
}

export async function sb(path: string, init?: SbInit): Promise<any> {
  const request = withoutTimeout(init);
  const response = await supabaseRest(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(request.headers as Record<string, string> | undefined),
    },
  });
  let text = '';
  try {
    text = await response.text();
  } catch {
    throw new DbError('invalid_response', safeHttpStatus(response.status));
  }
  if (!response.ok) throw new DbError('http', safeHttpStatus(response.status));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new DbError('invalid_response', safeHttpStatus(response.status));
  }
}

/** Parsed JSON, or null when the request fails. The error text is only kind and status. */
export async function sbOrNull(path: string, init?: SbInit): Promise<any | null> {
  try {
    return await sb(path, init);
  } catch (error) {
    if (error instanceof DbError) {
      console.error(JSON.stringify({ event: 'supabase.request', kind: error.kind, status: error.status ?? null }));
    }
    return null;
  }
}

export function rpc(fn: string, args: Record<string, unknown>, init?: SbInit) {
  return sb(`/rpc/${fn}`, {
    ...init,
    method: 'POST',
    body: JSON.stringify(args ?? {}),
  });
}

let client: SupabaseClient | undefined;
let clientIdentity = '';

export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DbError('invalid_response');
  const identity = `${url}\0${key}`;
  if (!client || clientIdentity !== identity) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    });
    clientIdentity = identity;
  }
  return client;
}

/** Test hook. Production code never resets the singleton. */
export function resetSupabaseForTests(): void {
  client = undefined;
  clientIdentity = '';
}

/**
 * Direct Postgres from a serverless function must use Supavisor transaction mode.
 * The app does not open a Postgres connection today. Call this only when one is added.
 * Transaction mode: prepare false, one connection per instance, no session features.
 */
export function transactionPoolerOptions(raw = process.env.SUPABASE_DB_POOLER_URL): { port: '6543'; prepare: false; max: 1 } {
  if (!raw) throw new Error('SUPABASE_DB_POOLER_URL is not set');
  const url = new URL(raw);
  if (url.port !== '6543') throw new Error('SUPABASE_DB_POOLER_URL must use port 6543');
  if (!url.hostname.endsWith('.pooler.supabase.com')) {
    throw new Error('SUPABASE_DB_POOLER_URL must use the Supavisor host');
  }
  if (!url.username.startsWith('postgres.')) {
    throw new Error('SUPABASE_DB_POOLER_URL user must be postgres.<project-ref>');
  }
  return { port: '6543', prepare: false, max: 1 };
}
