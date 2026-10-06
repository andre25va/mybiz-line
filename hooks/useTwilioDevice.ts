'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

export type CallStatus = 'idle' | 'connecting' | 'ringing' | 'connected' | 'disconnecting';

export interface IncomingCallInfo {
  from: string;
  call: any;
}

export interface TwilioDiag {
  deviceState: string;
  audioContextState: string;
  tokenOk: boolean | null;
  lastError: string | null;
  registeredAt: string | null;
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

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/token');
  const data = await res.json();
  return data.token;
}

export function useTwilioDevice() {
  const deviceRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const registeredRef = useRef(false);

  const [status, setStatus] = useState<CallStatus>('idle');
  const [isReady, setIsReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCallInfo | null>(null);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [diag, setDiag] = useState<TwilioDiag>({
    deviceState: 'not created',
    audioContextState: 'unknown',
    tokenOk: null,
    lastError: null,
    registeredAt: null,
  });

  const updateDiag = useCallback((patch: Partial<TwilioDiag>) => {
    setDiag(prev => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    let device: any;
    let destroyed = false;

    async function createDevice() {
      try {
        updateDiag({ deviceState: 'fetching token' });
        const token = await fetchToken();
        updateDiag({ tokenOk: true, deviceState: 'creating device' });

        const { Device } = await import('@twilio/voice-sdk');
        device = new Device(token, { logLevel: 'error', codecPreferences: ['opus', 'pcmu'] as any });
        deviceRef.current = device;
        updateDiag({ deviceState: 'device created — tap screen to activate' });

        device.on('registered', () => {
          if (destroyed) return;
          setIsReady(true);
          registeredRef.current = true;
          updateDiag({ deviceState: 'Ready ✅', registeredAt: new Date().toLocaleTimeString() });
        });
        device.on('unregistered', () => {
          setIsReady(false);
          updateDiag({ deviceState: 'unregistered' });
        });
        device.on('tokenAboutToExpire', async () => {
          try {
            const newToken = await fetchToken();
            device.updateToken(newToken);
            updateDiag({ tokenOk: true });
          } catch (e: any) {
            updateDiag({ lastError: 'Token refresh failed: ' + e?.message });
          }
        });
        refreshTimerRef.current = setInterval(async () => {
          try {
            const newToken = await fetchToken();
            deviceRef.current?.updateToken(newToken);
          } catch {}
        }, 50 * 60 * 1000);
        device.on('error', async (e: any) => {
          const msg = e?.message || String(e);
          updateDiag({ lastError: `Error ${e?.code}: ${msg}` });
          if (e?.code === 20104) {
            try {
              const newToken = await fetchToken();
              device.updateToken(newToken);
              await device.register();
            } catch {}
          }
        });
        device.on('incoming', (call: any) => {
          setIncoming({ from: call.parameters.From || 'Unknown', call });
          call.on('cancel', () => setIncoming(null));
          call.on('reject', () => setIncoming(null));
        });

        // KEY FIX: Don't call register() yet — wait for first user gesture
        // so the AudioContext is in 'running' state before we register
        async function onFirstGesture() {
          if (destroyed) return;
          try {
            const ctx = (device as any).audio?.audioContext ||
                        (device as any).audio?.context;
            const ctxState = ctx?.state || 'no AudioContext';
            updateDiag({ audioContextState: ctxState });

            if (ctx && ctx.state === 'suspended') {
              await ctx.resume();
              updateDiag({ audioContextState: 'resumed' });
            }

            if (!registeredRef.current) {
              updateDiag({ deviceState: 'registering...' });
              await device.register();
            }
          } catch (e: any) {
            updateDiag({ lastError: 'Register failed: ' + e?.message, deviceState: 'register error' });
          }
        }

        document.addEventListener('click', onFirstGesture, { once: true });
        document.addEventListener('touchstart', onFirstGesture, { once: true });

      } catch (e: any) {
        updateDiag({ tokenOk: false, deviceState: 'init failed', lastError: e?.message });
      }
    }

    createDevice();
    return () => {
      destroyed = true;
      device?.destroy();
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [updateDiag]);

  const startTimer = useCallback(() => {
    setDuration(0);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setDuration(0);
  }, []);

  const routeToEarpiece = useCallback(async (call: any) => {
    try {
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
        await (audioEl as any).setSinkId('');
      }
    } catch {}
  }, []);

  const toggleSpeaker = useCallback(async () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    try {
      if (audioRef.current && 'setSinkId' in audioRef.current) {
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
    } catch (e: any) {
      updateDiag({ lastError: 'makeCall failed: ' + e?.message });
      setStatus('idle');
    }
  }, [status, onConnect, updateDiag]);

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

  return { status, isReady, muted, speakerOn, incoming, duration, connRef, diag, makeCall, hangup, toggleMute, toggleSpeaker, acceptCall, rejectCall };
}
