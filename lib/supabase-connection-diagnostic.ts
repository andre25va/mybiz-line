import { randomUUID } from 'node:crypto';
import { REST_USERS_PATHNAME } from './supabase-server';
import https, { type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';

export type ConnectionDiagnosticPhase = 'admin_authorization' | 'zero_row_probe';
export type ConnectionDiagnosticStage = 'dns' | 'connect' | 'tls' | 'request' | 'response';
export type ConnectionDiagnosticErrorClass =
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_response'
  | 'invalid_config'
  | 'unknown';

export type ConnectionDiagnosticMilestone = {
  stage: ConnectionDiagnosticStage;
  elapsedMs: number;
};

export type ConnectionDiagnosticTrace = {
  event: 'supabase.connection-diagnostic';
  traceId: string;
  phase: ConnectionDiagnosticPhase;
  outcome: 'success' | ConnectionDiagnosticErrorClass;
  elapsedMs: number;
  milestones: ConnectionDiagnosticMilestone[];
  failureStage?: ConnectionDiagnosticStage;
  upstreamStatus?: number;
  networkCode?: string;
};

type RequestFactory = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export type DiagnosticFetchOptions = {
  phase: ConnectionDiagnosticPhase;
  deadlineAt: number;
  requestTimeoutMs?: number;
  expectedHost?: string;
  requestFactory?: RequestFactory;
};

const KNOWN_NETWORK_CODES = new Set([
  'EAI_AGAIN', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT', 'ERR_SSL_WRONG_VERSION_NUMBER',
]);
const MAX_RESPONSE_BYTES = 4096;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_SUPABASE_HOST = 'alxrmusieuzgssynktxg.supabase.co';

type MutableTrace = {
  startedAt: number;
  traceId: string;
  phase: ConnectionDiagnosticPhase;
  outcome: ConnectionDiagnosticTrace['outcome'];
  milestones: ConnectionDiagnosticMilestone[];
  failureStage?: ConnectionDiagnosticStage;
  upstreamStatus?: number;
  networkCode?: string;
};

function elapsedSince(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function safeHttpStatus(status: unknown): number | undefined {
  return typeof status === 'number' && Number.isInteger(status) && status >= 200 && status <= 599
    ? status
    : undefined;
}

function safeNetworkCode(error: unknown): string | undefined {
  try {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && KNOWN_NETWORK_CODES.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function traceSnapshot(trace: MutableTrace): ConnectionDiagnosticTrace {
  const result: ConnectionDiagnosticTrace = {
    event: 'supabase.connection-diagnostic',
    traceId: trace.traceId,
    phase: trace.phase,
    outcome: trace.outcome,
    elapsedMs: elapsedSince(trace.startedAt),
    milestones: trace.milestones.map(point => ({ ...point })),
  };
  if (trace.failureStage) result.failureStage = trace.failureStage;
  if (trace.upstreamStatus !== undefined) result.upstreamStatus = trace.upstreamStatus;
  if (trace.networkCode) result.networkCode = trace.networkCode;
  return result;
}

function allowedQuery(url: URL, phase: ConnectionDiagnosticPhase): boolean {
  const params = new URLSearchParams(url.search);
  const keyList: string[] = [];
  params.forEach((_value, key) => keyList.push(key));
  const keys = keyList.sort().join(',');
  if (phase === 'zero_row_probe') {
    return keys === 'limit,select' && params.get('select') === 'id' && params.get('limit') === '0';
  }
  const id = params.get('id');
  return keys === 'id,limit,select'
    && typeof id === 'string'
    && /^eq\.[0-9a-f-]{36}$/i.test(id)
    && params.get('select') === 'is_admin,is_active'
    && params.get('limit') === '1';
}

function toSafeRequestHeaders(headers: HeadersInit | undefined): Record<string, string> | null {
  try {
    const source = new Headers(headers);
    const result: Record<string, string> = {};
    for (const name of ['accept', 'apikey', 'authorization']) {
      const value = source.get(name);
      if (value !== null) result[name] = value;
    }
    if (!result.apikey || !result.authorization || !result.accept) return null;
    let headerCount = 0;
    source.forEach(() => { headerCount += 1; });
    if (headerCount !== Object.keys(result).length) return null;
    return result;
  } catch {
    return null;
  }
}

function configuredTarget(
  input: RequestInfo | URL,
  phase: ConnectionDiagnosticPhase,
  expectedHost: string,
): URL | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== expectedHost || (url.port && url.port !== '443')) return null;
    if (url.username || url.password || url.hash || url.pathname !== REST_USERS_PATHNAME) return null;
    return allowedQuery(url, phase) ? url : null;
  } catch {
    return null;
  }
}

function makeSyntheticResponse(status: number, body: string | null): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function validateZeroRowResponse(
  response: Response,
  trace: ConnectionDiagnosticTrace | null,
): Promise<ConnectionDiagnosticTrace | null> {
  if (!trace || trace.outcome !== 'success') return trace;
  try {
    const rows: unknown = await response.json();
    if (Array.isArray(rows) && rows.length === 0) return trace;
  } catch {
    // Preserve only a fixed invalid-response classification; never retain response content.
  }
  return {
    ...trace,
    outcome: 'invalid_response',
    failureStage: 'response',
  };
}

/**
 * Creates a route-local, single-call fetch adapter. It uses per-request https
 * socket events instead of process-global diagnostics hooks; responses and
 * headers remain private to the caller and are never included in the trace.
 */
export function createDiagnosticFetch(options: DiagnosticFetchOptions): {
  fetcher: typeof fetch;
  getTrace: () => ConnectionDiagnosticTrace | null;
} {
  let trace: MutableTrace | null = null;
  let used = false;
  const requestFactory = options.requestFactory ?? (https.request as RequestFactory);
  const expectedHost = options.expectedHost ?? DEFAULT_SUPABASE_HOST;

  const fetcher: typeof fetch = async (input, init) => {
    if (used) throw new Error('diagnostic request already consumed');
    used = true;
    const start = performance.now();
    trace = {
      startedAt: start,
      traceId: randomUUID(),
      phase: options.phase,
      outcome: 'unknown',
      milestones: [],
    };
    const current = trace;
    let stage: ConnectionDiagnosticStage = 'dns';
    const record = (name: ConnectionDiagnosticStage) => {
      if (!current.milestones.some(point => point.stage === name)) {
        current.milestones.push({ stage: name, elapsedMs: elapsedSince(start) });
      }
    };
    const fail = (errorClass: ConnectionDiagnosticErrorClass, failureStage: ConnectionDiagnosticStage, error?: unknown) => {
      current.outcome = errorClass;
      current.failureStage = failureStage;
      const code = safeNetworkCode(error);
      if (code) current.networkCode = code;
    };

    const target = configuredTarget(input, options.phase, expectedHost);
    const method = init?.method?.toUpperCase() ?? (input instanceof Request ? input.method : 'GET');
    const headers = toSafeRequestHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!target || method !== 'GET' || init?.body || !headers) {
      fail('invalid_config', 'dns');
      throw new Error('diagnostic request configuration invalid');
    }
    if (signal?.aborted) {
      fail('timeout', 'dns');
      throw new Error('diagnostic request aborted');
    }

    const remaining = options.deadlineAt - Date.now();
    const timeoutMs = Math.max(0, Math.min(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, remaining));
    if (timeoutMs <= 0) {
      fail('timeout', 'dns');
      throw new Error('diagnostic deadline elapsed');
    }

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      let responseStatus: number | undefined;
      let responseBytes = 0;
      const chunks: Buffer[] = [];
      const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        agent.destroy();
        if (error) reject(error);
        else if (responseStatus === undefined) {
          fail('invalid_response', stage);
          reject(new Error('diagnostic response invalid'));
        } else if (current.outcome === 'unknown') {
          if (responseStatus < 200 || responseStatus > 299) {
            current.outcome = 'http';
            current.failureStage = 'response';
            current.upstreamStatus = responseStatus;
          } else {
            current.outcome = 'success';
          }
          const bodylessStatus = responseStatus === 204 || responseStatus === 304;
          if (bodylessStatus && current.outcome === 'success') {
            current.outcome = 'invalid_response';
            current.failureStage = 'response';
          }
          const body = bodylessStatus ? null : Buffer.concat(chunks).toString('utf8');
          resolve(makeSyntheticResponse(responseStatus, body));
        }
      };
      const onAbort = () => {
        if (settled) return;
        fail('timeout', stage);
        request?.destroy();
        finish(new Error('diagnostic request aborted'));
      };
      const timer = setTimeout(() => {
        fail('timeout', stage);
        request?.destroy();
        finish(new Error('diagnostic request timeout'));
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });

      let request: ClientRequest | null = null;
      try {
        request = requestFactory(target, {
          method: 'GET',
          headers,
          agent,
        }, (response) => {
          const status = safeHttpStatus(response.statusCode);
          if (status === undefined) {
            fail('invalid_response', 'response');
            response.resume();
            finish(new Error('diagnostic status invalid'));
            return;
          }
          responseStatus = status;
          stage = 'response';
          record('response');
          response.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            responseBytes += Buffer.byteLength(chunk);
            if (responseBytes > MAX_RESPONSE_BYTES) {
              fail('invalid_response', 'response');
              request?.destroy();
              finish(new Error('diagnostic response too large'));
              return;
            }
            if (status >= 200 && status <= 299) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.once('aborted', () => {
            if (settled) return;
            fail('network', 'response');
            finish(new Error('diagnostic response aborted'));
          });
          response.once('error', (error: Error) => {
            if (settled) return;
            fail('network', 'response', error);
            finish(new Error('diagnostic response failed'));
          });
          response.once('end', () => finish());
          response.resume();
        });
        request.once('socket', (socket: TLSSocket) => {
          stage = 'dns';
          socket.once('lookup', (error?: Error) => {
            if (error) {
              fail('network', 'dns', error);
              request?.destroy();
              finish(new Error('diagnostic DNS lookup failed'));
              return;
            }
            record('dns');
            stage = 'connect';
          });
          socket.once('connect', () => {
            record('connect');
            stage = 'tls';
          });
          socket.once('secureConnect', () => {
            record('tls');
            stage = 'request';
          });
        });
        request.once('finish', () => {
          record('request');
          stage = 'response';
        });
        request.once('error', (error: Error) => {
          if (settled) return;
          fail(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network', stage, error);
          finish(new Error('diagnostic transport failed'));
        });
        request.end();
      } catch (error) {
        fail('network', stage, error);
        finish(new Error('diagnostic transport failed'));
      }
    });
  };

  return {
    fetcher,
    getTrace: () => trace ? traceSnapshot(trace) : null,
  };
}

export function logConnectionDiagnostic(trace: ConnectionDiagnosticTrace): void {
  // Keep the log schema strictly to fixed labels, elapsed times, and allowlisted codes.
  const line = JSON.stringify(trace);
  if (trace.outcome === 'success') console.info(line);
  else console.error(line);
}

export function formatProbeResult(trace: ConnectionDiagnosticTrace): Record<string, unknown> {
  const result: Record<string, unknown> = {
    traceId: trace.traceId,
    phase: trace.phase,
    outcome: trace.outcome,
    elapsedMs: trace.elapsedMs,
    milestones: trace.milestones,
  };
  if (trace.failureStage) result.failureStage = trace.failureStage;
  if (trace.upstreamStatus !== undefined) result.upstreamStatus = trace.upstreamStatus;
  if (trace.networkCode) result.networkCode = trace.networkCode;
  return result;
}
