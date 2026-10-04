'use client';
import { Phone, PhoneOff, User, Tag } from 'lucide-react';
import { useState } from 'react';

interface Contact {
  id: string; name: string; phone: string; email?: string;
  address?: string; notes?: string; business: string; tags?: string[];
}

interface Props {
  from: string;
  onAccept: () => void;
  onReject: () => void;
  contacts?: Contact[];
}

const BIZ_COLOR: Record<string, string> = {
  myredeal: 'bg-green-600',
  contractors: 'bg-orange-500',
  personal: 'bg-gray-600',
};
const BIZ_LABEL: Record<string, string> = {
  myredeal: 'Real Estate',
  contractors: 'Contractors of KC',
  personal: 'Personal',
};

function normalizePhone(p: string) {
  return p.replace(/\D/g, '').replace(/^1/, '');
}

export default function IncomingCall({ from, onAccept, onReject, contacts = [] }: Props) {
  const [showProfile, setShowProfile] = useState(false);

  const fromNorm = normalizePhone(from);
  const contact = contacts.find(c => normalizePhone(c.phone) === fromNorm);

  const bizColor = contact ? (BIZ_COLOR[contact.business] || 'bg-gray-600') : 'bg-gray-600';
  const bizLabel = contact ? (BIZ_LABEL[contact.business] || contact.business) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-3xl p-8 w-80 flex flex-col items-center gap-4 shadow-2xl">

        {/* Avatar */}
        <div className={`w-20 h-20 rounded-full ${bizColor} flex items-center justify-center text-white text-3xl animate-pulse shadow-lg`}>
          {contact ? contact.name[0].toUpperCase() : '📲'}
        </div>

        {/* Name / number */}
        <div className="text-center">
          <div className="text-text font-bold text-xl">{contact ? contact.name : from}</div>
          {contact && <div className="text-subtext text-sm">{from}</div>}
          <div className="text-subtext text-sm mt-0.5">Incoming call</div>
          {bizLabel && (
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-white text-xs font-medium ${bizColor}`}>
              {bizLabel}
            </span>
          )}
          {contact?.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center mt-1">
              {contact.tags.map(tag => (
                <span key={tag} className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* View Profile button */}
        {contact && (
          <button
            onClick={() => setShowProfile(p => !p)}
            className="flex items-center gap-1 text-xs text-blue-600 font-medium underline"
          >
            <User size={12} /> {showProfile ? 'Hide Profile' : 'View Profile'}
          </button>
        )}

        {/* Profile panel */}
        {showProfile && contact && (
          <div className="w-full bg-surface rounded-2xl border border-border p-3 flex flex-col gap-1.5 text-left max-h-40 overflow-y-auto">
            {contact.email && <div className="text-xs text-subtext">📧 {contact.email}</div>}
            {contact.address && <div className="text-xs text-subtext">📍 {contact.address}</div>}
            {contact.notes && <div className="text-xs text-subtext">📝 {contact.notes}</div>}
          </div>
        )}

        {/* No contact — Save to Contacts hint */}
        {!contact && (
          <div className="text-xs text-subtext text-center">Unknown caller — you can save them after the call</div>
        )}

        {/* Accept / Reject */}
        <div className="flex gap-10 mt-2">
          <button onClick={onReject} className="w-16 h-16 rounded-full bg-danger hover:bg-red-700 flex items-center justify-center transition-all shadow-lg shadow-red-100">
            <PhoneOff size={24} className="text-white" />
          </button>
          <button onClick={onAccept} className="w-16 h-16 rounded-full bg-accent hover:bg-green-700 flex items-center justify-center transition-all shadow-lg shadow-green-100">
            <Phone size={24} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
