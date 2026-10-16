// Client deadline exceeds the route cap (30s) so the server can return a result first.
export const AUTH_REQUEST_TIMEOUT_MS = 35_000;

export type AuthRequestErrorKind = 'timeout' | 'network' | 'invalid-response';

export class AuthRequestError extends Error {
  readonly kind: AuthRequestErrorKind;

  constructor(kind: AuthRequestErrorKind) {
    super(kind === 'timeout'
      ? 'The sign-in request timed out.'
      : kind === 'invalid-response'
        ? 'The sign-in service returned an invalid response.'
        : 'The sign-in service could not be reached.');
    this.name = 'AuthRequestError';
    this.kind = kind;
  }
}

/**
 * Send a same-origin login request with a hard client-side deadline.
 * Return only status metadata; provider response bodies are deliberately not
 * surfaced to the login UI.
 */
export async function postAuthRequest(
  path: string,
  payload: unknown,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const request = Promise.resolve().then(async () => {
    const response = await fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new AuthRequestError('invalid-response');
    }
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
      throw new AuthRequestError('invalid-response');
    }
    return { ok: true, status: response.status };
  }).catch(error => {
    if (error instanceof AuthRequestError) throw error;
    throw new AuthRequestError(timedOut ? 'timeout' : 'network');
  });

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new AuthRequestError('timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
