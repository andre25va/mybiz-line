'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

export type CallStatus = 'idle' | 'connecting' | 'ringing' | 'connected' | 'disconnecting';
export type PhoneActivationState = 'initializing' | 'activating' | 'ready' | 'error' | 'unregistered';

export interface FreshTwilioToken {
  token: string;
  expiresAt: string;
  expiresAtMs: number;
}

const MINIMUM_TOKEN_VALIDITY_MS = 60_000;
const MAX_ACTIVATION_ATTEMPTS = 3;
const REGISTRATION_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_INTERVAL_MS = 50 * 60 * 1000;

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
  micPermission: string;
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

function jwtExpiryMs(token: string): number | null {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) return null;

  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Retrieve and validate a non-cached token without ever including the JWT in an error. */
export async function fetchFreshToken(fetcher: typeof fetch = fetch): Promise<FreshTwilioToken> {
  let response: Response;
  try {
    response = await fetcher('/api/token', {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
  } catch {
    throw new Error('Unable to reach the phone token service.');
  }

  if (!response.ok) throw new Error(`Unable to retrieve a phone token (HTTP ${response.status}).`);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('The phone token response was invalid.');
  }

  if (!data || typeof data !== 'object') throw new Error('The phone token response was invalid.');
  const payload = data as { token?: unknown; expiresAt?: unknown };
  if (typeof payload.token !== 'string' || !payload.token.trim()) {
    throw new Error('The phone token response was invalid.');
  }

  const expiresAtMs = typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : Number.NaN;
  const jwtExpiresAtMs = jwtExpiryMs(payload.token);
  const earliestUsableExpiry = Date.now() + MINIMUM_TOKEN_VALIDITY_MS;
  if (jwtExpiresAtMs === null || !Number.isFinite(expiresAtMs)) {
    throw new Error('The phone token response was invalid.');
  }
  if (expiresAtMs <= earliestUsableExpiry || jwtExpiresAtMs <= earliestUsableExpiry) {
    throw new Error('The phone token is expired or has an invalid expiry.');
  }

  return { token: payload.token, expiresAt: payload.expiresAt as string, expiresAtMs };
}

/** Update an existing Twilio device with a newly validated token. */
export async function refreshDeviceToken(
  device: { updateToken: (token: string) => void },
  fetcher: () => Promise<FreshTwilioToken> = fetchFreshToken,
): Promise<FreshTwilioToken> {
  const freshToken = await fetcher();
  device.updateToken(freshToken.token);
  return freshToken;
}

/** Retry a phone-registration task a fixed number of times, with bounded backoff. */
export async function runBoundedActivation(
  attempt: (attemptNumber: number) => Promise<void>,
  options: {
    maxAttempts?: number;
    retryDelayMs?: number;
    onRetry?: (error: unknown, nextAttempt: number) => void;
  } = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? MAX_ACTIVATION_ATTEMPTS;
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 300);
  let lastError: unknown;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      await attempt(attemptNumber);
      return;
    } catch (error) {
      lastError = error;
      if (attemptNumber === maxAttempts) break;
      options.onRetry?.(error, attemptNumber + 1);
      if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attemptNumber));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Phone registration failed.');
}

/** Ensure same-gesture and overlapping retries share one in-flight activation attempt. */
export function createConcurrentAttemptGuard<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const taskPromise = Promise.resolve().then(task);
    let guardedPromise: Promise<T>;
    guardedPromise = taskPromise.finally(() => {
      if (inFlight === guardedPromise) inFlight = null;
    });
    inFlight = guardedPromise;
    return guardedPromise;
  };
}

function makeSafeDeviceError(error: any): Error {
  if (error?.code === 20104) return new Error('The phone token expired. A fresh token will be requested.');
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return new Error('Microphone access was denied. Allow microphone access, then retry activation.');
  }
  return new Error('Phone registration failed. Check the connection and retry activation.');
}

function waitForRegistration(device: any): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const remove = (eventName: string, handler: (...args: any[]) => void) => {
      if (typeof device.off === 'function') device.off(eventName, handler);
      else if (typeof device.removeListener === 'function') device.removeListener(eventName, handler);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      remove('registered', onRegistered);
      remove('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onRegistered = () => finish();
    const onError = (error: unknown) => finish(makeSafeDeviceError(error));

    device.on('registered', onRegistered);
    device.on('error', onError);
    timeout = setTimeout(() => finish(new Error('Phone registration timed out.')), REGISTRATION_TIMEOUT_MS);
    try {
      const registration = device.register();
      if (registration && typeof registration.then === 'function') registration.catch(onError);
    } catch (error) {
      onError(error);
    }
  });
}

// iOS routes audio to earpiece when <audio> has playsInline set.
// Twilio SDK creates hidden <audio> elements — we just patch them.
function patchAudioElementsForEarpiece() {
  try {
    document.querySelectorAll('audio').forEach(el => {
      if (!(el as any)._earpiecePatchedByMybiz) {
        (el as any).playsInline = true;
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        (el as any)._earpiecePatchedByMybiz = true;
      }
    });
  } catch {}
}

export function useTwilioDevice() {
  const deviceRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const registeredRef = useRef(false);
  const tokenExpiryRef = useRef<number | null>(null);
  const initializationPromiseRef = useRef<Promise<any> | null>(null);
  const initializeDeviceRef = useRef<(() => Promise<any>) | null>(null);
  const refreshTokenRef = useRef<((device: any) => Promise<FreshTwilioToken>) | null>(null);
  const activationStateRef = useRef<PhoneActivationState>('initializing');
  const activationTaskRef = useRef<() => Promise<void>>(async () => {});
  const activationRunnerRef = useRef<(() => Promise<void>) | null>(null);
  if (!activationRunnerRef.current) {
    activationRunnerRef.current = createConcurrentAttemptGuard(() => activationTaskRef.current());
  }

  const [status, setStatus] = useState<CallStatus>('idle');
  const [activationState, setActivationStateValue] = useState<PhoneActivationState>('initializing');
  const [isReady, setIsReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCallInfo | null>(null);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [diag, setDiag] = useState<TwilioDiag>({
    deviceState: 'initializing — requesting token',
    audioContextState: 'unknown',
    tokenOk: null,
    lastError: null,
    registeredAt: null,
    micPermission: 'unknown',
  });

  const setActivationState = useCallback((next: PhoneActivationState) => {
    activationStateRef.current = next;
    setActivationStateValue(next);
  }, []);

  const updateDiag = useCallback((patch: Partial<TwilioDiag>) => {
    setDiag(prev => ({ ...prev, ...patch }));
  }, []);

  const activatePhone = useCallback(() => {
    return activationRunnerRef.current ? activationRunnerRef.current() : Promise.resolve();
  }, []);

  useEffect(() => {
    let destroyed = false;
    let tokenRefreshPromise: Promise<FreshTwilioToken> | null = null;

    const refreshTokenForDevice = async (device: any) => {
      if (tokenRefreshPromise) return tokenRefreshPromise;
      const current = refreshDeviceToken(device).then(freshToken => {
        tokenExpiryRef.current = freshToken.expiresAtMs;
        if (!destroyed) updateDiag({ tokenOk: true });
        return freshToken;
      });
      tokenRefreshPromise = current;
      try {
        return await current;
      } finally {
        if (tokenRefreshPromise === current) tokenRefreshPromise = null;
      }
    };
    refreshTokenRef.current = refreshTokenForDevice;

    const initializeDevice = async () => {
      if (deviceRef.current) return deviceRef.current;
      if (initializationPromiseRef.current) return initializationPromiseRef.current;

      setActivationState('initializing');
      updateDiag({ deviceState: 'initializing — requesting token', tokenOk: null, lastError: null });
      const initialization = (async () => {
        const freshToken = await fetchFreshToken();
        if (destroyed) throw new Error('Phone initialization cancelled.');

        updateDiag({ tokenOk: true, deviceState: 'initializing — creating device' });
        const { Device } = await import('@twilio/voice-sdk');
        if (destroyed) throw new Error('Phone initialization cancelled.');

        const device = new Device(freshToken.token, {
          logLevel: 'error',
          codecPreferences: ['opus', 'pcmu'] as any,
        });
        deviceRef.current = device;
        tokenExpiryRef.current = freshToken.expiresAtMs;

        device.on('registered', () => {
          if (destroyed) return;
          registeredRef.current = true;
          setIsReady(true);
          setActivationState('ready');
          updateDiag({ deviceState: 'registered', registeredAt: new Date().toLocaleTimeString(), lastError: null });
        });

        device.on('unregistered', () => {
          if (destroyed) return;
          registeredRef.current = false;
          setIsReady(false);
          if (activationStateRef.current !== 'activating') setActivationState('unregistered');
          updateDiag({ deviceState: 'unregistered' });
        });

        device.on('tokenAboutToExpire', () => {
          void refreshTokenForDevice(device).catch(() => {
            if (!destroyed) updateDiag({ lastError: 'Unable to refresh the phone token. Retry activation.' });
          });
        });

        device.on('error', (error: any) => {
          if (destroyed) return;
          const tokenExpired = error?.code === 20104;
          updateDiag({
            lastError: tokenExpired
              ? 'The phone token expired. Retry activation for a fresh token.'
              : 'The phone device reported an error. Retry activation if registration is unavailable.',
            ...(tokenExpired ? { deviceState: 'token expired' } : {}),
          });
          if (tokenExpired) {
            registeredRef.current = false;
            setIsReady(false);
            if (activationStateRef.current !== 'activating') setActivationState('error');
          }
        });

        device.on('incoming', (call: any) => {
          if (destroyed) return;
          setIncoming({ from: call.parameters.From || 'Unknown', call });
          call.on('cancel', () => setIncoming(null));
          call.on('reject', () => setIncoming(null));
        });

        refreshTimerRef.current = setInterval(() => {
          if (tokenExpiryRef.current && tokenExpiryRef.current > Date.now() + MINIMUM_TOKEN_VALIDITY_MS) {
            void refreshTokenForDevice(device).catch(() => {
              if (!destroyed) updateDiag({ lastError: 'Unable to refresh the phone token. Retry activation.' });
            });
          }
        }, TOKEN_REFRESH_INTERVAL_MS);

        const activationAlreadyStarted = activationStateRef.current === 'activating';
        if (!activationAlreadyStarted) setActivationState('unregistered');
        updateDiag({ deviceState: activationAlreadyStarted ? 'activating — device created' : 'device created — unregistered' });
        return device;
      })();

      initializationPromiseRef.current = initialization;
      try {
        return await initialization;
      } catch (error) {
        if (!destroyed) {
          setActivationState('error');
          updateDiag({
            tokenOk: false,
            deviceState: 'initialization failed',
            lastError: error instanceof Error && (
              error.message.startsWith('Unable to reach the phone token service') ||
              error.message.startsWith('Unable to retrieve a phone token') ||
              error.message.startsWith('The phone token') ||
              error.message.startsWith('The phone token response')
            ) ? error.message : 'Unable to initialize the phone device. Retry activation.',
          });
        }
        throw error;
      } finally {
        if (initializationPromiseRef.current === initialization) initializationPromiseRef.current = null;
      }
    };
    initializeDeviceRef.current = initializeDevice;

    activationTaskRef.current = async () => {
      if (destroyed || registeredRef.current) return;
      setActivationState('activating');
      updateDiag({ deviceState: 'activating — requesting microphone', lastError: null });

      let device: any;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        updateDiag({ micPermission: 'granted', audioContextState: 'checking' });
        device = deviceRef.current || await initializeDeviceRef.current?.();
        if (!device) throw new Error('The phone device is not available yet. Retry activation.');

        const context: AudioContext | undefined =
          (device as any).audio?.audioContext ||
          (device as any).audio?.context ||
          (device as any)._audioContext;
        if (context?.state === 'suspended') {
          await context.resume();
          updateDiag({ audioContextState: 'running' });
        } else {
          updateDiag({ audioContextState: context?.state || 'unavailable' });
        }

        await runBoundedActivation(async attemptNumber => {
          const tokenNeedsRefresh = !tokenExpiryRef.current || tokenExpiryRef.current <= Date.now() + MINIMUM_TOKEN_VALIDITY_MS;
          if (attemptNumber > 1 || tokenNeedsRefresh) {
            const refreshToken = refreshTokenRef.current;
            if (!refreshToken) throw new Error('Unable to refresh the phone token.');
            await refreshToken(device);
          }
          if (destroyed) return;
          updateDiag({ deviceState: attemptNumber === 1 ? 'activating — registering' : `activating — registration retry ${attemptNumber - 1}` });
          await waitForRegistration(device);
        }, {
          maxAttempts: MAX_ACTIVATION_ATTEMPTS,
          retryDelayMs: 300,
          onRetry: error => {
            if (!destroyed) updateDiag({ lastError: error instanceof Error ? error.message : 'Phone registration failed. Retrying.' });
          },
        });
      } catch (error: any) {
        if (destroyed) return;
        const message = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
          ? 'Microphone access was denied. Allow microphone access in browser settings, then retry.'
          : error instanceof Error && (
            error.message.startsWith('Unable to reach the phone token service') ||
            error.message.startsWith('Unable to retrieve a phone token') ||
            error.message.startsWith('The phone token') ||
            error.message.startsWith('The phone token response') ||
            error.message.startsWith('Unable to refresh the phone token') ||
            error.message.startsWith('Phone registration timed out')
          )
            ? error.message
            : error?.code === 20104
              ? 'The phone token expired. Retry activation for a fresh token.'
              : 'Phone activation failed. Check the microphone and connection, then retry.';
        setActivationState('error');
        updateDiag({
          deviceState: 'activation failed',
          lastError: message,
          ...(error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError' ? { micPermission: 'denied' } : {}),
        });
      }
    };

    const onGesture = () => {
      if (registeredRef.current || destroyed) return;
      void activationRunnerRef.current?.().catch(() => {});
    };
    document.addEventListener('click', onGesture);

    void initializeDevice().catch(() => {});

    return () => {
      destroyed = true;
      document.removeEventListener('click', onGesture);
      refreshTokenRef.current = null;
      initializeDeviceRef.current = null;
      activationTaskRef.current = async () => {};
      deviceRef.current?.destroy();
      deviceRef.current = null;
      registeredRef.current = false;
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [setActivationState, updateDiag]);

  const startTimer = useCallback(() => {
    setDuration(0);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setDuration(0);
  }, []);

  const toggleSpeaker = useCallback(async () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    try {
      // Patch all audio elements for speaker toggle
      document.querySelectorAll('audio').forEach(async el => {
        if ('setSinkId' in el) {
          await (el as any).setSinkId(next ? 'speaker' : '');
        }
      });
    } catch {}
  }, [speakerOn]);

  const onConnect = useCallback((call: any) => {
    connRef.current = call;
    // Patch Twilio's internal audio elements for earpiece routing on iOS
    // Do it immediately and again after a short delay (SDK may create elements async)
    patchAudioElementsForEarpiece();
    setTimeout(patchAudioElementsForEarpiece, 300);
    setTimeout(patchAudioElementsForEarpiece, 1000);
    call.on('accept', () => { setStatus('connected'); startTimer(); patchAudioElementsForEarpiece(); });
    call.on('disconnect', () => { setStatus('idle'); stopTimer(); connRef.current = null; setSpeakerOn(false); });
    call.on('cancel', () => { setStatus('idle'); stopTimer(); connRef.current = null; setSpeakerOn(false); });
  }, [startTimer, stopTimer]);

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
    } catch {
      updateDiag({ lastError: 'Call could not be connected. Retry when the phone is ready.' });
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

  return {
    status,
    activationState,
    activationError: diag.lastError,
    activatePhone,
    isReady,
    muted,
    speakerOn,
    incoming,
    duration,
    connRef,
    diag,
    makeCall,
    hangup,
    toggleMute,
    toggleSpeaker,
    acceptCall,
    rejectCall,
  };
}
