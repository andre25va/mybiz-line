'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'phone' | 'code';

export default function LoginPage() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function formatPhone(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send code');
      } else {
        setStep('code');
      }
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid code');
      } else {
        router.push('/');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">📱</div>
          <h1 className="text-2xl font-bold text-text">MyBiz Line</h1>
          <p className="text-subtext text-sm mt-1">Your multi-business comm hub</p>
        </div>

        {step === 'phone' ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="block text-sm text-subtext mb-1">Your phone number</label>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="(312) 000-0000"
                value={formatPhone(phone)}
                onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-text placeholder-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent text-lg tracking-wide"
                autoFocus
              />
            </div>
            {error && <p className="text-danger text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading || phone.length < 10}
              data-action="login-send-code"
              className="w-full bg-accent hover:bg-green-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition-colors"
            >
              {loading ? 'Sending…' : 'Send Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <div>
              <label className="block text-sm text-subtext mb-1">
                Enter the 6-digit code sent to{' '}
                <span className="text-text font-medium">{formatPhone(phone)}</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-text placeholder-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent text-2xl tracking-widest text-center"
                autoFocus
              />
            </div>
            {error && <p className="text-danger text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              data-action="login-verify-code"
              className="w-full bg-accent hover:bg-green-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              data-action="login-back"
              className="w-full text-subtext text-sm py-2"
            >
              ← Change number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
