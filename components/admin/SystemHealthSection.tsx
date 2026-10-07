'use client';

import { useEffect, useRef, useState } from 'react';

type UnknownCheck = {
  status: 'unknown';
  observedAt: null;
  ref: null;
  detail: string;
};

type PhoneHealth = {
  configuration: 'complete' | 'incomplete';
  configurationObservedAt: string;
  authTokenPresent: boolean;
  checks: {
    tokenIssuance: UnknownCheck;
    signatureVerification: UnknownCheck;
    registration: UnknownCheck;
    lastCall: UnknownCheck;
    providerError: UnknownCheck;
    providerOutage: UnknownCheck;
    twoWayAudio: UnknownCheck;
  };
};

const CHECKS: { key: keyof PhoneHealth['checks']; label: string }[] = [
  { key: 'tokenIssuance', label: 'Token issuance' },
  { key: 'signatureVerification', label: 'Signature verification' },
  { key: 'registration', label: 'Registration' },
  { key: 'lastCall', label: 'Last call' },
  { key: 'providerError', label: 'Provider error' },
  { key: 'providerOutage', label: 'Provider outage' },
  { key: 'twoWayAudio', label: 'Two-way audio' },
];

export const PHONE_HEALTH_UNAVAILABLE = 'System health is unavailable.';

export type HealthLoadResult =
  | { kind: 'authorized'; health: PhoneHealth }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

export type HealthView = {
  authorized: boolean;
  health: PhoneHealth | null;
  showError: boolean;
};

export const EMPTY_HEALTH_VIEW: HealthView = { authorized: false, health: null, showError: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownCheck(value: unknown): value is UnknownCheck {
  if (!isPlainObject(value)) return false;
  return value.status === 'unknown'
    && value.observedAt === null
    && value.ref === null
    && typeof value.detail === 'string';
}

function isNonEmptyTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isPhoneHealth(value: unknown): value is PhoneHealth {
  if (!isPlainObject(value)) return false;
  if (value.configuration !== 'complete' && value.configuration !== 'incomplete') return false;
  if (!isNonEmptyTimestamp(value.configurationObservedAt)) return false;
  if (typeof value.authTokenPresent !== 'boolean') return false;
  const checks = value.checks;
  if (!isPlainObject(checks)) return false;
  return CHECKS.every(({ key }) => isUnknownCheck(checks[key]));
}

/** Classify one phone-health response. Never includes status text or the response body in an error. */
export async function readPhoneHealthResponse(response: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<HealthLoadResult> {
  if (response.status === 401 || response.status === 403) return { kind: 'denied' };
  if (response.status !== 200) return { kind: 'unavailable' };
  try {
    const body = await response.json();
    if (!isPhoneHealth(body)) return { kind: 'unavailable' };
    return { kind: 'authorized', health: body };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** After a denial, hide the section. After a later failure, keep only a generic retry for a prior 200. */
export function reduceHealthView(current: HealthView, result: HealthLoadResult): HealthView {
  if (result.kind === 'denied') return EMPTY_HEALTH_VIEW;
  if (result.kind === 'unavailable') {
    return { authorized: current.authorized, health: null, showError: current.authorized };
  }
  return { authorized: true, health: result.health, showError: false };
}

/** Overlapping calls share one in-flight request. */
export function createSingleFlight(task: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const current = Promise.resolve().then(task).finally(() => {
      if (inFlight === current) inFlight = null;
    });
    inFlight = current;
    return current;
  };
}

export default function SystemHealthSection() {
  const [view, setView] = useState<HealthView>(EMPTY_HEALTH_VIEW);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadTask = useRef<() => Promise<void>>(async () => {});
  const loadOnce = useRef<(() => Promise<void>) | null>(null);
  if (!loadOnce.current) loadOnce.current = createSingleFlight(() => loadTask.current());

  useEffect(() => {
    let cancelled = false;
    loadTask.current = async () => {
      setRefreshing(true);
      let result: HealthLoadResult = { kind: 'unavailable' };
      try {
        const response = await fetch('/api/admin/phone-health', { cache: 'no-store' });
        result = await readPhoneHealthResponse(response);
      } catch {
        result = { kind: 'unavailable' };
      } finally {
        if (!cancelled) {
          setView(current => reduceHealthView(current, result));
          setRefreshing(false);
        }
      }
    };
    void loadOnce.current?.();
    return () => {
      cancelled = true;
      loadTask.current = async () => {};
    };
  }, []);

  useEffect(() => {
    if (view.health && window.location.hash === '#system-health') setOpen(true);
  }, [view.health]);

  if (!view.authorized) return null;

  const refreshButton = (
    <button
      type="button"
      data-action="admin-refresh-phone-health"
      onClick={() => { void loadOnce.current?.(); }}
      disabled={refreshing}
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
    >
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  );

  if (!view.health) {
    return (
      <section id="system-health" className="px-6 pt-4">
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm text-gray-700">{PHONE_HEALTH_UNAVAILABLE}</p>
          {refreshButton}
        </div>
      </section>
    );
  }

  return (
    <section id="system-health" className="px-6 pt-4">
      <div className="bg-white border border-gray-200 rounded-xl">
        <button
          type="button"
          data-action="admin-open-system-health"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
          className="w-full px-4 py-3 text-left text-sm font-semibold text-gray-900"
        >
          System Health
        </button>
        {open && (
          <div className="space-y-3 px-4 pb-4 text-sm">
            <div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Configuration</span>
                <span className="text-gray-900">{view.health.configuration === 'complete' ? 'Complete' : 'Incomplete'}</span>
              </div>
              <p className="text-xs text-gray-400">Observed {view.health.configurationObservedAt}</p>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Auth token</span>
              <span className="text-gray-900">{view.health.authTokenPresent ? 'Present' : 'Not present'}</span>
            </div>
            {CHECKS.map(({ key, label }) => {
              const check = view.health?.checks[key];
              return (
                <div key={key}>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-gray-700">Unknown</span>
                  </div>
                  {check?.detail && <p className="text-xs text-gray-500">{check.detail}</p>}
                </div>
              );
            })}
            {refreshButton}
          </div>
        )}
      </div>
    </section>
  );
}
