'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

export type CallStatus = 'idle' | 'connecting' | 'ringing' | 'connected' | 'disconnecting';

export interface IncomingCallInfo {
  from: string;
  call: any;
}

export function useTwilioDevice() {
  const deviceRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [isReady, setIsReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCallInfo | null>(null);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let device: any;

    async function init() {
      try {
        const { Device } = await import('@twilio/voice-sdk');
        const res = await fetch('/api/token');
        const { token } = await res.json();

        device = new Device(token, { logLevel: 'error', codecPreferences: ['opus', 'pcmu'] as any });
        deviceRef.current = device;

        device.on('registered', () => setIsReady(true));
        device.on('error', (e: any) => console.error('Device error:', e));

        device.on('incoming', (call: any) => {
          setIncoming({ from: call.parameters.From || 'Unknown', call });
          call.on('cancel', () => setIncoming(null));
          call.on('reject', () => setIncoming(null));
        });

        await device.register();
      } catch (e) {
        console.error('Device init failed:', e);
      }
    }

    init();
    return () => { device?.destroy(); };
  }, []);

  const startTimer = useCallback(() => {
    setDuration(0);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setDuration(0);
  }, []);

  const onConnect = useCallback((call: any) => {
    connRef.current = call;
    call.on('accept', () => { setStatus('connected'); startTimer(); });
    call.on('disconnect', () => { setStatus('idle'); stopTimer(); connRef.current = null; });
    call.on('cancel', () => { setStatus('idle'); stopTimer(); connRef.current = null; });
  }, [startTimer, stopTimer]);

  const makeCall = useCallback(async (to: string) => {
    if (!deviceRef.current || status !== 'idle') return;
    setStatus('connecting');
    try {
      const call = await deviceRef.current.connect({ params: { To: to } });
      onConnect(call);
      call.on('ringing', () => setStatus('ringing'));
    } catch (e) {
      console.error('Call failed:', e);
      setStatus('idle');
    }
  }, [status, onConnect]);

  const hangup = useCallback(() => {
    try { connRef.current?.disconnect(); } catch {}
    try { deviceRef.current?.disconnectAll(); } catch {}
    connRef.current = null;
    setStatus('idle');
    stopTimer();
    setMuted(false);
  }, [stopTimer]);

  const toggleMute = useCallback(() => {
    if (!connRef.current) return;
    const next = !muted;
    connRef.current.mute(next);
    setMuted(next);
  }, [muted]);

  const acceptCall = useCallback(() => {
    if (!incoming) return;
    const call = incoming.call;
    setIncoming(null);
    onConnect(call);
    call.accept();
    setStatus('connected');
    startTimer();
  }, [incoming, onConnect, startTimer]);

  const rejectCall = useCallback(() => {
    incoming?.call.reject();
    setIncoming(null);
  }, [incoming]);

  // Expose connRef so consumers can pass it to DTMF dialpad
  return { status, isReady, muted, incoming, duration, connRef, makeCall, hangup, toggleMute, acceptCall, rejectCall };
}
