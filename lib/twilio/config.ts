/**
 * Server-only Voice configuration presence.
 * Callers that build a token may read the four credential strings.
 * Health checks must use the boolean helpers and must not return those strings.
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/twilio/config is server-only');
}

export type VoiceTokenCredentials = {
  accountSid: string;
  apiKey: string;
  apiSecret: string;
  twimlAppSid: string;
};

/** Same truthiness as the token route: no trim. A whitespace-only value is present. */
export function readVoiceTokenCredentials(): VoiceTokenCredentials | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;
  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) return null;
  return { accountSid, apiKey, apiSecret, twimlAppSid };
}

export function isVoiceTokenConfigComplete(): boolean {
  return readVoiceTokenCredentials() !== null;
}

/** Presence only. Never treat this as signature verification. */
export function isTwilioAuthTokenPresent(): boolean {
  return Boolean(process.env.TWILIO_AUTH_TOKEN);
}
