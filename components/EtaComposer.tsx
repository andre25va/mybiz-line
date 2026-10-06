'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, MapPin, X } from 'lucide-react';

let placesLoadPromise: Promise<any> | null = null;

async function loadPlacesLibrary(): Promise<any> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_PLACES_API_KEY;
  if (!key) throw new Error('Address search is not configured. Please contact support.');
  const w = window as any;
  if (w.google?.maps?.importLibrary) return w.google.maps.importLibrary('places');
  if (!placesLoadPromise) {
    placesLoadPromise = new Promise<void>((resolve, reject) => {
      let script = document.getElementById('mybiz-google-maps-js') as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = 'mybiz-google-maps-js';
        script.async = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places`;
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Could not load Google address search. Please try again.')), { once: true });
      if (w.google?.maps?.importLibrary) resolve();
    }).then(async () => {
      const google = (window as any).google;
      if (!google?.maps?.importLibrary) throw new Error('Google address search did not initialize.');
      return google.maps.importLibrary('places');
    }).catch(error => {
      placesLoadPromise = null;
      throw error;
    });
  }
  return placesLoadPromise;
}

interface Props {
  recipient: string;
  recipientName?: string;
  onClose: () => void;
  onSent?: () => void;
}

interface Suggestion {
  prediction: any;
  label: string;
}

export default function EtaComposer({ recipient, recipientName, onClose, onSent }: Props) {
  const [address, setAddress] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const sessionToken = useRef<any>(null);
  const requestId = useRef(0);
  const autocomplete = useRef<any>(null);

  useEffect(() => {
    const query = address.trim();
    const currentRequest = ++requestId.current;
    if (query.length < 3 || selectedAddress) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = await loadPlacesLibrary();
        if (!sessionToken.current) sessionToken.current = new AutocompleteSessionToken();
        autocomplete.current = AutocompleteSuggestion;
        const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: sessionToken.current,
          includedRegionCodes: ['us'],
        });
        if (currentRequest !== requestId.current) return;
        setSuggestions((response.suggestions || []).flatMap((item: any) => {
          const prediction = item.placePrediction;
          if (!prediction) return [];
          const label = prediction.text?.toString?.() || prediction.mainText?.toString?.() || '';
          return label ? [{ prediction, label }] : [];
        }));
        setError('');
      } catch (e) {
        if (currentRequest !== requestId.current) return;
        setSuggestions([]);
        setError(e instanceof Error ? e.message : 'Address suggestions are unavailable.');
      } finally {
        if (currentRequest === requestId.current) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [address, selectedAddress]);

  const chooseAddress = async (suggestion: Suggestion) => {
    setSearching(true);
    setError('');
    try {
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ['formattedAddress'] });
      const formatted = String(place.formattedAddress || suggestion.label).trim();
      if (!formatted) throw new Error('Select a suggested destination address.');
      setAddress(formatted);
      setSelectedAddress(formatted);
      setSuggestions([]);
      sessionToken.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not select that address. Please try another.');
    } finally {
      setSearching(false);
    }
  };

  const calculateEta = () => {
    if (!selectedAddress) {
      setError('Choose a destination from the address suggestions first.');
      return;
    }
    if (!navigator.geolocation) {
      setError('Location is unavailable in this browser.');
      return;
    }
    setBusy(true);
    setError('');
    setDurationSeconds(null);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch('/api/eta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originLat: position.coords.latitude,
            originLng: position.coords.longitude,
            destinationAddress: selectedAddress,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not calculate a driving ETA.');
        const seconds = Number(result.durationSeconds);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) throw new Error('No driving route was found for this address.');
        const arrival = new Date(Date.now() + seconds * 1000);
        const arrivalText = arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        const mins = Math.ceil(seconds / 60);
        const hours = Math.floor(mins / 60);
        const durationText = hours ? `${hours} hr${hours === 1 ? '' : 's'}${mins % 60 ? ` ${mins % 60} min` : ''}` : `${mins} min`;
        const firstName = recipientName?.trim().split(/\s+/)[0] || 'there';
        setDurationSeconds(seconds);
        setMessage(`Hi ${firstName}, I'm on my way — estimated arrival in ${durationText} (around ${arrivalText}).`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not calculate a driving ETA.');
      } finally {
        setBusy(false);
      }
    }, geolocationError => {
      setBusy(false);
      setError(geolocationError.code === geolocationError.PERMISSION_DENIED
        ? 'Location permission was not granted. Allow location access and try again.'
        : geolocationError.code === geolocationError.TIMEOUT
          ? 'Location request timed out. Please try again.'
          : 'Could not get your location. Please try again.');
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  };

  const send = async () => {
    if (!durationSeconds || !message.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, body: message.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send message.');
      if (onSent) onSent();
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const arrival = durationSeconds ? new Date(Date.now() + durationSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '';

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={() => { if (!busy && !sending) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="eta-title" className="w-full max-w-lg bg-white rounded-t-2xl pb-8 pt-4 px-4 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 id="eta-title" className="text-base font-semibold text-gray-900">Send ETA</h2>
            <div className="text-xs text-gray-500">To {recipientName || recipient} · {recipient}</div>
          </div>
          <button type="button" data-action="sms-eta-close" aria-label="Close ETA" onClick={onClose} disabled={busy || sending} className="p-2 text-gray-500 disabled:opacity-40"><X size={18} /></button>
        </div>

        {!durationSeconds ? (
          <>
            <label htmlFor="eta-destination" className="block text-sm font-medium text-gray-700">Destination address</label>
            <div className="relative">
              <input
                id="eta-destination"
                data-action="sms-eta-address"
                autoComplete="off"
                value={address}
                onChange={e => { setAddress(e.target.value); setSelectedAddress(''); setDurationSeconds(null); setError(''); }}
                placeholder="Start typing a street address…"
                disabled={busy}
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-10 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              />
              {searching && <Loader2 size={16} className="absolute right-3 top-3.5 animate-spin text-gray-400" />}
              {suggestions.length > 0 && (
                <ul role="listbox" aria-label="Address suggestions" className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                  {suggestions.map((item, index) => (
                    <li key={`${item.label}-${index}`} role="option" aria-selected="false">
                      <button type="button" data-action="sms-eta-select-address" onClick={() => chooseAddress(item)} className="w-full px-4 py-3 text-left text-sm text-gray-800 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                        <MapPin size={14} className="inline mr-2 text-gray-400" />{item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selectedAddress && <p className="text-xs text-green-700">Selected: {selectedAddress}</p>}
            <p className="text-xs text-gray-500">Your location is requested once when you calculate the ETA.</p>
            {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
            <div className="flex gap-2">
              <button type="button" data-action="sms-eta-cancel" onClick={onClose} disabled={busy} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold disabled:opacity-50">Cancel</button>
              <button type="button" data-action="sms-eta-calculate" onClick={calculateEta} disabled={busy || searching || !selectedAddress} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-50">
                {busy ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Calculating…</span> : <span className="inline-flex items-center gap-2"><Clock size={16} />Calculate ETA</span>}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-gray-700">Estimated arrival: <span className="font-semibold">{arrival}</span> (your local time)</div>
            <textarea data-action="sms-eta-edit-message" aria-label="Edit ETA message" value={message} onChange={e => setMessage(e.target.value)} rows={4} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
            <div className="flex gap-2">
              <button type="button" data-action="sms-eta-cancel" onClick={onClose} disabled={sending} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold disabled:opacity-50">Cancel</button>
              <button type="button" data-action="sms-eta-send" onClick={send} disabled={sending || !message.trim()} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-50">{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
