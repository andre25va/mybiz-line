'use client';

import { useEffect, useState } from 'react';

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

function isPhoneHealth(value: unknown): value is PhoneHealth {
  if (!value || typeof value !== 'object') return false;
  const record = value as { configuration?: unknown };
  return record.configuration === 'complete' || record.configuration === 'incomplete';
}

export default function SystemHealthSection() {
  const [health, setHealth] = useState<PhoneHealth | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/phone-health', { cache: 'no-store' });
        if (response.status !== 200) return;
        const body: unknown = await response.json();
        if (!cancelled && isPhoneHealth(body)) setHealth(body);
      } catch {
        // Fail closed: non-admins and failed lookups see no health UI.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (health && window.location.hash === '#system-health') setOpen(true);
  }, [health]);

  if (!health) return null;

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
                <span className="text-gray-900">{health.configuration === 'complete' ? 'Complete' : 'Incomplete'}</span>
              </div>
              <p className="text-xs text-gray-400">Observed {health.configurationObservedAt}</p>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Auth token</span>
              <span className="text-gray-900">{health.authTokenPresent ? 'Present' : 'Not present'}</span>
            </div>
            {CHECKS.map(({ key, label }) => {
              const check = health.checks[key];
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
          </div>
        )}
      </div>
    </section>
  );
}
