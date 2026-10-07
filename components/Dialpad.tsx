'use client';
import { useState, useCallback } from 'react';
import { Phone, Delete } from 'lucide-react';
import type { PhoneActivationState } from '@/hooks/useTwilioDevice';

const KEYS = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['*','0','#'],
];

interface Props {
  onCall: (to: string) => void;
  disabled?: boolean;
  activeConn?: any;
  isReady?: boolean;
  activationState?: PhoneActivationState;
  activationError?: string | null;
  onActivate?: () => Promise<void> | void;
}

const STATUS_LABEL: Record<PhoneActivationState, string> = {
  initializing: '● Initializing phone…',
  activating: '● Activating phone…',
  ready: '● Ready',
  error: '● Activation failed',
  unregistered: '● Phone not registered',
};

export default function Dialpad({
  onCall,
  disabled,
  activeConn,
  isReady,
  activationState,
  activationError,
  onActivate,
}: Props) {
  const [number, setNumber] = useState('');
  const state = activationState || (isReady ? 'ready' : 'initializing');
  const ready = state === 'ready' && isReady !== false;

  const press = useCallback((k: string) => {
    if (activeConn) { activeConn.sendDigits(k); return; }
    setNumber(p => p.length < 15 ? p + k : p);
  }, [activeConn]);

  const del = () => setNumber(p => p.slice(0, -1));

  const call = () => {
    if (!number) return;
    const formatted = number.startsWith('+') ? number : `+1${number.replace(/\D/g, '')}`;
    onCall(formatted);
  };

  const fmt = (n: string) => {
    const d = n.replace(/\D/g, '');
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;
  };

  const statusColor = state === 'ready' ? 'text-green-600' : state === 'error' ? 'text-red-600' : 'text-yellow-600';
  const activationButtonLabel = state === 'error' ? 'Retry activation' : 'Activate phone';

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="w-full max-w-xs px-1" role="status" aria-live="polite">
        <span className={`text-xs font-medium ${statusColor}`}>{STATUS_LABEL[state]}</span>
      </div>

      {!ready && (
        <div className="w-full max-w-xs flex flex-col gap-2">
          <button
            type="button"
            data-action="activate-phone"
            onClick={() => { void onActivate?.(); }}
            disabled={state === 'activating' || !onActivate}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
          >
            {state === 'activating' ? 'Activating…' : activationButtonLabel}
          </button>
          {activationError && (
            <p className="text-xs text-red-600 text-center" role="alert">{activationError}</p>
          )}
          {(state === 'initializing' || state === 'unregistered') && !activationError && (
            <p className="text-xs text-gray-500 text-center">Activate the phone to register this device.</p>
          )}
        </div>
      )}

      <div className="relative w-full max-w-xs">
        <input
          type="tel"
          value={number.startsWith('+') ? number : fmt(number)}
          onChange={e => setNumber(e.target.value.replace(/\D/g, ''))}
          placeholder="Enter number"
          className="w-full bg-transparent text-center text-3xl font-light text-gray-900 placeholder-gray-400 focus:outline-none py-2"
        />
        {number && (
          <button onClick={del} data-action="delete-digit" className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-2">
            <Delete size={20} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {KEYS.flat().map(k => (
          <button
            key={k}
            data-action={`dial-${k}`}
            onClick={() => press(k)}
            className="h-16 rounded-2xl bg-white border border-gray-200 text-gray-900 text-xl font-medium hover:bg-gray-50 active:scale-95 transition-all shadow-sm"
          >
            {k}
          </button>
        ))}
      </div>

      {ready && activationError && (
        <p className="w-full max-w-xs text-xs text-red-600 text-center" role="alert">{activationError}</p>
      )}

      <button
        data-action="start-call"
        onClick={call}
        disabled={disabled || !number || !ready}
        className="mt-2 w-16 h-16 rounded-full bg-green-600 hover:bg-green-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-green-200"
      >
        <Phone size={26} className="text-white" />
      </button>
    </div>
  );
}
