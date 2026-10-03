'use client';
import { useState } from 'react';
import { Phone, MessageSquare, Grid3x3, Users, CheckSquare, Settings, X } from 'lucide-react';
import { useTwilioDevice } from '@/hooks/useTwilioDevice';
import Dialpad from './Dialpad';
import ActiveCall from './ActiveCall';
import CallLog from './CallLog';
import SMSInbox from './SMSInbox';
import SMSThread from './SMSThread';
import IncomingCall from './IncomingCall';
import Contacts from './Contacts';
import Tasks from './Tasks';

type Tab = 'calls' | 'messages' | 'dialpad' | 'contacts' | 'tasks';

const BUSINESSES = [
  { id: 'myredeal', name: 'MyReDeal', color: '#16a34a' },
  { id: 'contractors-kc', name: 'Contractors of KC', color: '#ea580c' },
];

export default function AppShell() {
  const [tab, setTab] = useState<Tab>('dialpad');
  const [smsContact, setSmsContact] = useState<string | null>(null);
  const [activeNumber, setActiveNumber] = useState('');
  const [biz, setBiz] = useState(BUSINESSES[0]);
  const [showSettings, setShowSettings] = useState(false);
  // Prefill state for "Save to Contacts" from SMS thread
  const [contactPrefill, setContactPrefill] = useState<{ phone?: string; email?: string } | null>(null);

  const { status, isReady, muted, incoming, duration, makeCall, hangup, toggleMute, acceptCall, rejectCall } =
    useTwilioDevice();

  const isOnCall = status !== 'idle';

  function handleCall(to: string) {
    setActiveNumber(to);
    setTab('dialpad');
    makeCall(to);
  }

  function handleSMS(number: string) {
    setSmsContact(number);
    setTab('messages');
  }

  function handleAddContact(phone: string, prefill?: { email?: string }) {
    setContactPrefill({ phone, email: prefill?.email });
    setTab('contacts');
  }

  return (
    <div className="flex flex-col h-screen bg-surface max-w-md mx-auto relative">
      {/* Incoming call overlay */}
      {incoming && (
        <IncomingCall from={incoming.from} onAccept={acceptCall} onReject={rejectCall} />
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="absolute inset-0 bg-surface z-50 flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
            <button onClick={() => setShowSettings(false)} className="text-subtext hover:text-text p-1 transition-colors">
              <X size={20} />
            </button>
            <span className="font-semibold text-text">Settings</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
            <div>
              <h2 className="text-text font-semibold text-lg mb-1">MyBiz Line</h2>
              <p className="text-subtext text-sm">Beta v0.1 · Your number: +1 (464) 733-3257</p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="text-text font-medium mb-3">Business Profiles</h3>
              <div className="space-y-2">
                {BUSINESSES.map(b => (
                  <div
                    key={b.id}
                    onClick={() => { setBiz(b); setShowSettings(false); }}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                      biz.id === b.id ? 'bg-green-50 border border-accent' : 'hover:bg-surface'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: b.color }} />
                    <span className={`text-sm font-medium ${biz.id === b.id ? 'text-accent' : 'text-text'}`}>
                      {b.name}
                    </span>
                    {biz.id === b.id && <span className="ml-auto text-accent text-xs font-medium">Active</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="text-text font-medium mb-1">AI Assistant</h3>
              <p className="text-subtext text-sm">
                Tap the ✨ sparkle icon in any SMS thread to detect appointments and add them to your
                calendar or task list.
              </p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="text-text font-medium mb-3">Account</h3>
              <a href="/api/auth/logout" className="text-red-500 text-sm font-medium">
                Sign out
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border flex-shrink-0">
        <div className="text-lg font-bold text-text">MyBiz Line</div>
        <div className="flex items-center gap-2">
          {!isReady && <span className="text-xs text-subtext">Connecting…</span>}
          {isReady && !isOnCall && <span className="w-2 h-2 rounded-full bg-accent" title="Ready" />}
          <select
            value={biz.id}
            onChange={e => setBiz(BUSINESSES.find(b => b.id === e.target.value) || BUSINESSES[0])}
            className="text-sm font-medium bg-surface border border-border rounded-lg px-2 py-1 text-text focus:outline-none focus:border-accent"
          >
            {BUSINESSES.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-subtext hover:text-text transition-colors rounded-lg hover:bg-surface"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Active call banner */}
        {isOnCall && (
          <div className="pt-4">
            <ActiveCall
              status={status}
              duration={duration}
              number={activeNumber}
              muted={muted}
              onHangup={hangup}
              onToggleMute={toggleMute}
              activeConn={null}
            />
          </div>
        )}

        {!isOnCall && (
          <>
            {tab === 'dialpad' && (
              <div className="px-4 pt-4">
                <Dialpad onCall={handleCall} disabled={isOnCall} />
              </div>
            )}
            {tab === 'calls' && <CallLog myNumber="+14647333257" onCall={handleCall} />}
            {tab === 'messages' && (
              smsContact ? (
                <div className="flex flex-col" style={{ height: 'calc(100vh - 132px)' }}>
                  <SMSThread
                    number={smsContact}
                    onBack={() => setSmsContact(null)}
                    onCall={handleCall}
                    onAddContact={handleAddContact}
                  />
                </div>
              ) : (
                <SMSInbox onSelect={n => setSmsContact(n)} />
              )
            )}
            {tab === 'contacts' && (
              <Contacts
                onCall={handleCall}
                onSMS={handleSMS}
                prefillPhone={contactPrefill?.phone}
                prefillEmail={contactPrefill?.email}
                onPrefillUsed={() => setContactPrefill(null)}
              />
            )}
            {tab === 'tasks' && <Tasks />}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <div className="flex bg-card border-t border-border flex-shrink-0 safe-area-pb">
        {([
          { id: 'calls', icon: Phone, label: 'Recents' },
          { id: 'messages', icon: MessageSquare, label: 'Messages' },
          { id: 'dialpad', icon: Grid3x3, label: 'Keypad' },
          { id: 'contacts', icon: Users, label: 'Contacts' },
          { id: 'tasks', icon: CheckSquare, label: 'Tasks' },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              if (id !== 'messages') setSmsContact(null);
            }}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
              tab === id ? 'text-accent' : 'text-subtext hover:text-text'
            }`}
          >
            <Icon size={20} />
            <span className="text-xs">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
