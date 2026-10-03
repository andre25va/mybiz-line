'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) router.push('/');
    else setError('Wrong password');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">📱</div>
          <h1 className="text-2xl font-bold text-text">MyBiz Line</h1>
          <p className="text-subtext text-sm mt-1">Your multi-business comm hub</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className="w-full bg-card border border-border rounded-xl px-4 py-3 text-text placeholder-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            autoFocus
          />
          {error && <p className="text-danger text-sm text-center">{error}</p>}
          <button
            type="submit"
            className="w-full bg-accent hover:bg-green-700 text-white font-semibold rounded-xl py-3 transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
