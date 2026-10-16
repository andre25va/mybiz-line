import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { lookupActiveAdmin } from '@/lib/admin-portal-access';
import {
  createDiagnosticFetch,
  formatProbeResult,
  logConnectionDiagnostic,
  validateZeroRowResponse,
} from '@/lib/supabase-connection-diagnostic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TOTAL_BUDGET_MS = 8_000;
const REQUEST_BUDGET_MS = 5_000;
const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function safeConfigFailure(phase: 'admin_authorization' | 'zero_row_probe') {
  const trace = {
    event: 'supabase.connection-diagnostic' as const,
    traceId: randomUUID(),
    phase,
    outcome: 'invalid_config' as const,
    elapsedMs: 0,
    milestones: [],
  };
  logConnectionDiagnostic(trace);
  return trace;
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return response({ error: 'Unauthorized' }, 401);

  // No form or UI invokes this route. Same-origin POST is required to avoid cross-site triggering.
  if (req.headers.get('origin') !== req.nextUrl.origin) {
    return response({ error: 'Forbidden' }, 403);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    safeConfigFailure('admin_authorization');
    return response({ error: 'Forbidden' }, 403);
  }

  const deadlineAt = Date.now() + TOTAL_BUDGET_MS;
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS);
  const authFetch = createDiagnosticFetch({
    phase: 'admin_authorization',
    deadlineAt,
    requestTimeoutMs: REQUEST_BUDGET_MS,
  });

  try {
    // This is the exact existing authorization query and exact-row/flag check;
    // its response stays internal and is never returned or included in logs.
    const isAdmin = await lookupActiveAdmin(auth.userId, {
      signal: controller.signal,
      fetcher: authFetch.fetcher,
    });
    const authTrace = authFetch.getTrace();
    if (authTrace) logConnectionDiagnostic(authTrace);
    if (!isAdmin) return response({ error: 'Forbidden' }, 403);

    // Only a verified active admin reaches this second, zero-row, read-only request.
    const probeFetch = createDiagnosticFetch({
      phase: 'zero_row_probe',
      deadlineAt,
      requestTimeoutMs: REQUEST_BUDGET_MS,
    });
    try {
      const probeUrl = `${supabaseUrl}/rest/v1/users?select=id&limit=0`;
      const probeResponse = await probeFetch.fetcher(probeUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      });
      const trace = await validateZeroRowResponse(probeResponse, probeFetch.getTrace());
      if (trace) {
        logConnectionDiagnostic(trace);
        return response({ diagnostic: formatProbeResult(trace) }, 200);
      }
      return response({ error: 'Diagnostic unavailable.' }, 503);
    } catch {
      const trace = probeFetch.getTrace();
      if (trace) {
        logConnectionDiagnostic(trace);
        return response({ diagnostic: formatProbeResult(trace) }, 200);
      }
      safeConfigFailure('zero_row_probe');
      return response({ error: 'Diagnostic unavailable.' }, 503);
    }
  } finally {
    clearTimeout(totalTimer);
  }
}
