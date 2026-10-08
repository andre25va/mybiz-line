export interface DetectedEvent {
  detected: boolean;
  title: string;
  date: string | null;
  time: string | null;
  description: string;
}

export interface EventDetectionStateCallbacks {
  fetcher?: typeof fetch;
  onLoadingChange: (loading: boolean) => void;
  onResult: (result: DetectedEvent | null) => void;
  onError: (message: string | null) => void;
}

const DETECT_EVENT_ENDPOINT = '/api/ai-detect';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDetectedEvent(value: unknown): value is DetectedEvent {
  if (!isRecord(value)) return false;
  const isDate = (date: unknown) => date === null || (
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  );
  const isTime = (time: unknown) => time === null || (
    typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  );

  return typeof value.detected === 'boolean' &&
    typeof value.title === 'string' &&
    isDate(value.date) &&
    isTime(value.time) &&
    typeof value.description === 'string';
}

function messageForHttpStatus(status: number): string {
  if (status === 503) return 'Event detection is temporarily unavailable. Please try again later.';
  if (status >= 500) return 'The event detection service is unavailable. Please try again.';
  return 'Could not detect an event from these messages. Please try again.';
}

async function requestEventDetection(text: string, fetcher: typeof fetch): Promise<DetectedEvent> {
  let response: Response;
  try {
    response = await fetcher(DETECT_EVENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new Error('Could not connect to event detection. Check your connection and try again.');
  }

  if (!response.ok) throw new Error(messageForHttpStatus(response.status));

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Event detection returned an unreadable response. Please try again.');
  }

  if (!isDetectedEvent(body)) {
    throw new Error('Event detection returned an invalid response. Please try again.');
  }

  return body;
}

/** Runs only the detection request; event and SMS actions remain explicit user actions. */
export async function runEventDetection(
  text: string,
  callbacks: EventDetectionStateCallbacks,
): Promise<void> {
  const fetcher = callbacks.fetcher ?? fetch;
  callbacks.onLoadingChange(true);
  callbacks.onError(null);

  try {
    callbacks.onResult(await requestEventDetection(text, fetcher));
  } catch (error) {
    callbacks.onResult(null);
    callbacks.onError(error instanceof Error ? error.message : 'Could not detect an event. Please try again.');
  } finally {
    callbacks.onLoadingChange(false);
  }
}
