'use client';
import { useEffect } from 'react';

export function usePushNotifications() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Use a dummy VAPID-less subscription for local web push (best effort)
      // Full VAPID push requires a server key — for now we wire up the SW
      console.log('[Push] Service worker registered, permission granted');
    }).catch(console.error);
  }, []);
}
