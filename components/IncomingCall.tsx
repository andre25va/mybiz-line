'use client';
import { Phone, PhoneOff } from 'lucide-react';

interface Props { from: string; onAccept: () => void; onReject: () => void; }

export default function IncomingCall({ from, onAccept, onReject }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-3xl p-8 w-80 flex flex-col items-center gap-6 shadow-2xl">
        <div className="w-20 h-20 rounded-full bg-surface border border-border flex items-center justify-center text-3xl animate-pulse">📲</div>
        <div className="text-center">
          <div className="text-text font-semibold text-lg">{from}</div>
          <div className="text-subtext text-sm mt-1">Incoming call</div>
        </div>
        <div className="flex gap-10">
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
