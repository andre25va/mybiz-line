'use client';
import { useState, useCallback } from 'react';
import { Phone, Delete } from 'lucide-react';

const KEYS = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['*','0','#'],
];

interface Props { onCall: (to: string) => void; disabled?: boolean; activeConn?: any; }

export default function Dialpad({ onCall, disabled, activeConn }: Props) {
  const [number, setNumber] = useState('');

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

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="relative w-full max-w-xs">
        <input
          type="tel"
          value={number.startsWith('+') ? number : fmt(number)}
          onChange={e => setNumber(e.target.value.replace(/\D/g, ''))}
          placeholder="Enter number"
          className="w-full bg-transparent text-center text-3xl font-light text-text placeholder-muted focus:outline-none py-2"
        />
        {number && (
          <button onClick={del} className="absolute right-0 top-1/2 -translate-y-1/2 text-muted hover:text-text p-2">
            <Delete size={20} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {KEYS.flat().map(k => (
          <button
            key={k}
            onClick={() => press(k)}
            className="h-16 rounded-2xl bg-card border border-border text-text text-xl font-medium hover:bg-surface active:scale-95 transition-all shadow-sm"
          >
            {k}
          </button>
        ))}
      </div>

      <button
        onClick={call}
        disabled={disabled || !number}
        className="mt-2 w-16 h-16 rounded-full bg-accent hover:bg-green-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-green-200"
      >
        <Phone size={26} className="text-white" />
      </button>
    </div>
  );
}
