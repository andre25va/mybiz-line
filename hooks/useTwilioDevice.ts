'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

export type CallStatus = 'idle' | 'connecting' | 'ringing' | 'connected' | 'disconnecting';

export interface IncomingCallInfo {
  from: string;
  call: any;
}

const LOCAL_CALL_LOG_KEY = 'mybiz_local_calls';

export interface LocalCallEntry {
  sid: string;
  from: string;
  to: string;
  direction: 'outbound-api' | 'inbound';
  status: string;
  duration: string;
  startTime: string;
  local: true;
}

function saveLocalCall(entry: LocalCallEntry) {
  try {
    const existing: LocalCallEntry[] = JSON.parse(localStorage.getItem(LOCAL_CALL_LOG_KEY) || '[]');
    // Keep only last 50 local entries
    const updated = [entry, ...existing].slice(0, 50);
    localStorage.setItem(LOCAL_CALL_LOG_KEY, JSON.stringify(updated));
  } catch {}
}

export function getLocalCalls(): LocalCallEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CALL_LOG_KEY) || '[]');
  } catch {
    return [];
  }
}

export function useTwilioDevice() {
  const deviceRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [voiceState, setVoiceState] = useState<'connecting' | 'ready' | 'offline'>('connecting');
  const isReady = voiceState === 'ready';
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCallInfo | null>(null);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let device: any;
    let cancelled = false;
    // iOS Safari often never finishes Device.register() (AudioContext stays
    // suspended until a tap). Don't leave the header on "Connecting…".
    const giveUp = setTimeout(() => {
      if (!cancelled) setVoiceState((state) => (state === 'connecting' ? 'offline' : state));
    }, 8000);

    async function init() {
      try {
        const { Device } = await import('@twilio/voice-sdk');
        const res = await fetch('/api/token');
        const data = await res.json();
        if (!res.ok || !data?.token) throw new Error(data?.error || 'Voice token unavailable');

        device = new Device(data.token, { logLevel: 'error', codecPreferences: ['opus', 'pcmu'] as any });
        if (cancelled) {
          device.destroy();
          return;
        }
        deviceRef.current = device;

        device.on('registered', () => { if (!cancelled) setVoiceState('ready'); });
        device.on('unregistered', () => {
          if (!cancelled) setVoiceState((state) => (state === 'ready' ? 'offline' : state));
        });
        device.on('error', (e: any) => {
          console.error('Device error:', e);
          if (!cancelled) setVoiceState((state) => (state === 'ready' ? state : 'offline'));
        });

        device.on('incoming', (call: any) => {
          setIncoming({ from: call.parameters.From || 'Unknown', call });
          call.on('cancel', () => setIncoming(null));
          call.on('reject', () => setIncoming(null));
        });

        await device.register();
      } catch (e) {
        console.error('Device init failed:', e);
        if (!cancelled) setVoiceState('offline');
      }
    }

    init();
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
      device?.destroy();
      if (deviceRef.current === device) deviceRef.current = null;
    };
  }, []);

  // A tap resumes the iOS audio context so the phone can register after the
  // header has already stopped saying "Connecting…".
  useEffect(() => {
    if (voiceState === 'ready') return;
    const retry = () => {
      const device = deviceRef.current;
      if (!device) return;
      const audio = device.audio;
      const ctx = audio?.context || audio?._audioContext;
      ctx?.resume?.().catch(() => undefined);
      Promise.resolve(device.register()).catch(() => undefined);
    };
    window.addEventListener('touchend', retry, { once: true, passive: true });
    window.addEventListener('click', retry, { once: true });
    return () => {
      window.removeEventListener('touchend', retry);
      window.removeEventListener('click', retry);
    };
  }, [voiceState]);

  const startTimer = useCallback(() => {
    setDuration(0);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setDuration(0);
  }, []);

  // Route audio to earpiece (default) — not speaker
  const routeToEarpiece = useCallback(async (call: any) => {
    try {
      // Twilio SDK internal audio element
      const audioEl = call._mediaHandler?._remoteStream
        ? (() => {
            const a = new Audio();
            a.srcObject = call._mediaHandler._remoteStream;
            a.autoplay = true;
            audioRef.current = a;
            return a;
          })()
        : null;

      if (audioEl && 'setSinkId' in audioEl) {
        // 'default' = earpiece on iPhone when not on speaker
        await (audioEl as any).setSinkId('');
      }
    } catch {
      // setSinkId not supported on this device — silent fallback
    }
  }, []);

  const toggleSpeaker = useCallback(async () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    try {
      if (audioRef.current && 'setSinkId' in audioRef.current) {
        // Empty string = default/earpiece, 'speaker' = loudspeaker
        await (audioRef.current as any).setSinkId(next ? 'speaker' : '');
      }
    } catch {}
  }, [speakerOn]);

  const onConnect = useCallback((call: any) => {
    connRef.current = call;
    routeToEarpiece(call);
    call.on('accept', () => { setStatus('connected'); startTimer(); });
    call.on('disconnect', () => { setStatus('idle'); stopTimer(); connRef.current = null; setSpeakerOn(false); });
    call.on('cancel', () => { setStatus('idle'); stopTimer(); connRef.current = null; setSpeakerOn(false); });
  }, [startTimer, stopTimer, routeToEarpiece]);

  const makeCall = useCallback(async (to: string) => {
    if (!deviceRef.current || status !== 'idle') return;
    setStatus('connecting');

    // Log locally immediately so it appears in Recents right away
    const localEntry: LocalCallEntry = {
      sid: `local_${Date.now()}`,
      from: 'client:andre',
      to,
      direction: 'outbound-api',
      status: 'initiated',
      duration: '0',
      startTime: new Date().toISOString(),
      local: true,
    };
    saveLocalCall(localEntry);

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
    setSpeakerOn(false);
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
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

  return { status, isReady, voiceState, muted, speakerOn, incoming, duration, connRef, makeCall, hangup, toggleMute, toggleSpeaker, acceptCall, rejectCall };
}
