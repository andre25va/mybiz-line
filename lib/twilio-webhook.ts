import twilio from 'twilio';

/** Messaging webhook only. Voice stays on /api/twiml so call forwarding is unchanged. */
export const SMS_WEBHOOK_URL = 'https://mybiz-line.vercel.app/api/sms/inbound';

type WebhookRequest = {
  headers: { get(name: string): string | null };
  nextUrl: { pathname: string; search: string };
};

export function formParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === 'string') params[key] = value;
  });
  return params;
}

export function webhookUrlCandidates(req: WebhookRequest, productionUrl: string): string[] {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim();
  const path = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  const urls: string[] = [];
  if (process.env.TWILIO_SMS_WEBHOOK_URL) urls.push(process.env.TWILIO_SMS_WEBHOOK_URL);
  if (host) urls.push(`${proto}://${host}${path}`);
  const app = process.env.NEXT_PUBLIC_APP_URL;
  if (app) urls.push(`${app.replace(/\/$/, '')}${path}`);
  urls.push(productionUrl);
  return Array.from(new Set(urls));
}

export function isValidTwilioSignature(
  authToken: string,
  signature: string,
  urls: string[],
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false;
  return urls.some((url) => {
    try {
      return twilio.validateRequest(authToken, signature, url, params);
    } catch {
      return false;
    }
  });
}

export function twimlBody(message: string | null): string {
  const response = new twilio.twiml.MessagingResponse();
  if (message) response.message(message);
  return response.toString();
}
