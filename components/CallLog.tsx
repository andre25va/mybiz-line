'use client';
import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, MessageSquare, PlusCircle, X, User } from 'lucide-react';

const MY_NUMBER = '+14647333257';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TZ_SHORT = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: TZ })
  .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';

interface Call {
  sid: string; from: string; to: string;
  direction: string; status: string; duration: string; startTime: string;
}

interface Contact { name: string; phone: string; business: string; }

function fmtDur(s: string) {
  const n = parseInt(s || '0');
  if (n < 60) return `${n}s`;
  return `${Math.floor(n/60)}m ${n%60}s`;
}

function fmtTime(t: string) {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }) + ' ' + TZ_SHORT;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
}

const BIZ_COLORS: Record<string, string> = {
  myredeal: '#16a34a',
  'contractors-kc': '#ea580c',
  personal: '#374151',
};

function cleanPhone(raw: string): string {
  if (!raw || raw.startsWith('client:')) return MY_NUMBER;
  return raw;
}

interface Props {
  onCall: (n: string) => void;
  onSMS?: (n: string) => void;
  contacts?: Contact[];
  onSaveContact?: (phone: string) => void;
}

interface ActionSheet { phone: string; name: string; }
interface SaveSheet { phone: string; }

export default function CallLog({ onCall, onSMS, contacts = [], onSaveContact }: Props) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionSheet, setActionSheet] = useState<ActionSheet | null>(null);
  const [saveSheet, setSaveSheet] = useState<SaveSheet | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveBiz, setSaveBiz] = useState('myredeal');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    fetch('/api/calls/history')
      .then(r => r.json())
      .then(d => { setCalls(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const getContact = (phone: string): Contact | null => {
    const norm = phone.replace(/\D/g, '');
    return contacts.find(c => c.phone.replace(/\D/g, '') === norm) ?? null;
  };

  const handleSaveContact = async () => {
    if (!saveSheet || !saveName.trim()) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim(), phone: saveSheet.phone, business: saveBiz }),
      });
      if (res.ok) {
        setSaveMsg('Contact saved!');
        setTimeout(() => { setSaveSheet(null); setSaveName(''); setSaveMsg(''); }, 1200);
        onSaveContact?.(saveSheet.phone);
      } else {
        setSaveMsg('Failed to save. Try again.');
      }
    } catch {
      setSaveMsg('Failed to save. Try again.');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-12 text-gray-400 text-sm">Loading…</div>;
  if (!calls.length) return <div className="flex justify-center py-12 text-gray-400 text-sm">No calls yet</div>;

  return (
    <>
      <div className="divide-y divide-gray-100">
        {calls.map(c => {
          const isInbound = c.direction === 'inbound';
          const isMissed = c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed';
          const rawNum = isInbound ? c.from : c.to;
          const contactNum = cleanPhone(rawNum);
          const isMyOwnOutbound = rawNum.startsWith('client:');
          const savedContact = getContact(contactNum);
          const bizColor = savedContact ? (BIZ_COLORS[savedContact.business] ?? BIZ_COLORS.personal) : BIZ_COLORS.personal;
          const displayName = isMyOwnOutbound
            ? (savedContact?.name ?? cleanPhone(c.to))
            : (savedContact?.name ?? contactNum);
          const Icon = isMissed ? PhoneMissed : isInbound ? PhoneIncoming : Phone;
          const iconColor = isMissed ? 'text-red-500' : isInbound ? 'text-green-600' : 'text-gray-500';

          return (
            <div key={c.sid} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors bg-white">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                style={{ backgroundColor: bizColor }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div
                className="flex-1 min-w-0 cursor-pointer"
                data-action="open-call-action-sheet"
                onClick={() => setActionSheet({ phone: contactNum, name: displayName })}
              >
                <div className={`font-semibold text-sm truncate ${isMissed ? 'text-red-500' : 'text-gray-900'}`}>{displayName}</div>
                <div className="flex items-center gap-1 text-gray-400 text-xs mt-0.5">
                  <Icon size={11} className={iconColor} />
                  <span>{fmtTime(c.startTime)}{c.duration && parseInt(c.duration) > 0 ? ` · ${fmtDur(c.duration)}` : ''}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {onSMS && (
                  <button data-action="send-sms" onClick={(e) => { e.stopPropagation(); onSMS(contactNum); }} onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); onSMS(contactNum); }} className="p-2 text-gray-400 hover:text-blue-600 transition-colors">
                    <MessageSquare size={16} />
                  </button>
                )}
                {!savedContact && (
                  <button
                    data-action="save-contact"
                    onClick={(e) => { e.stopPropagation(); setSaveSheet({ phone: contactNum }); setSaveName(''); setSaveBiz('myredeal'); setSaveMsg(''); }}
                    onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setSaveSheet({ phone: contactNum }); setSaveName(''); setSaveBiz('myredeal'); setSaveMsg(''); }}
                    className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    <PlusCircle size={16} />
                  </button>
                )}
                <button data-action="call-back" onClick={(e) => { e.stopPropagation(); onCall(contactNum); }} onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); onCall(contactNum); }} className="p-2 text-gray-400 hover:text-green-600 transition-colors">
                  <Phone size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Call Action Sheet */}
      {actionSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setActionSheet(null)}>
          <div className="w-full max-w-sm bg-white rounded-t-2xl pb-8 pt-4 px-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-base font-semibold text-gray-900">{actionSheet.name}</div>
              <div className="text-sm text-gray-500">{actionSheet.phone}</div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                data-action="action-sheet-call"
                onClick={() => { onCall(actionSheet.phone); setActionSheet(null); }}
                className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-base flex items-center justify-center gap-2"
              >
                <Phone size={18} /> Call
              </button>
              {onSMS && (
                <button
                  data-action="action-sheet-sms"
                  onClick={() => { onSMS!(actionSheet.phone); setActionSheet(null); }}
                  className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-base flex items-center justify-center gap-2"
                >
                  <MessageSquare size={18} /> Text
                </button>
              )}
              <button
                data-action="action-sheet-cancel"
                onClick={() => setActionSheet(null)}
                className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-base flex items-center justify-center gap-2"
              >
                <X size={18} /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Contact Sheet */}
      {saveSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setSaveSheet(null)}>
          <div className="w-full max-w-sm bg-white rounded-t-2xl pb-8 pt-4 px-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-gray-900 font-semibold text-base">
                <User size={18} /> Save Contact
              </div>
              <button data-action="close-save-sheet" onClick={() => setSaveSheet(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="text-sm text-gray-500 mb-3">{saveSheet.phone}</div>
            <div className="flex flex-col gap-3">
              <input
                data-action="save-contact-name"
                type="text"
                placeholder="Full name"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <select
                data-action="save-contact-business"
                value={saveBiz}
                onChange={e => setSaveBiz(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="myredeal">🟢 Real Estate</option>
                <option value="contractors-kc">🟠 Contractors of KC</option>
                <option value="personal">⚫ Personal</option>
              </select>
              {saveMsg && <div className={`text-sm text-center ${saveMsg.includes('saved') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</div>}
              <button
                data-action="save-contact-submit"
                onClick={handleSaveContact}
                disabled={saving || !saveName.trim()}
                className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-base disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
