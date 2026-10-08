export const SMS_REFRESH_INTERVAL_MS = 5_000;
export const SMS_SCROLL_BOTTOM_THRESHOLD_PX = 120;

export const SMS_NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
};

export interface SmsRefreshController<T> {
  refresh: () => Promise<void>;
  dispose: () => void;
}

/** A single-flight refresh coordinator. A call made during a request schedules
 * one trailing refresh, so focus/send refreshes aren't lost while polling. */
export function createSmsRefreshController<T>(
  request: (signal: AbortSignal) => Promise<T>,
  onData: (data: T) => void,
  onLoading?: (loading: boolean) => void,
  onError?: (error: unknown) => void,
): SmsRefreshController<T> {
  let disposed = false;
  let initialRequestStarted = false;
  let queuedRefresh = false;
  let inFlight: Promise<void> | null = null;
  let activeController: AbortController | null = null;

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (inFlight) {
      queuedRefresh = true;
      return inFlight;
    }

    const isInitialRequest = !initialRequestStarted;
    initialRequestStarted = true;
    if (isInitialRequest) onLoading?.(true);

    const controller = new AbortController();
    activeController = controller;
    const requestPromise = Promise.resolve().then(async () => {
      try {
        const data = await request(controller.signal);
        if (!disposed && !controller.signal.aborted) onData(data);
      } catch (error) {
        if (!disposed && !controller.signal.aborted) onError?.(error);
      } finally {
        if (activeController === controller) activeController = null;
        inFlight = null;
        if (isInitialRequest && !disposed) onLoading?.(false);
        if (queuedRefresh && !disposed) {
          queuedRefresh = false;
          void refresh();
        }
      }
    });
    inFlight = requestPromise;
    return requestPromise;
  };

  return {
    refresh,
    dispose: () => {
      disposed = true;
      queuedRefresh = false;
      activeController?.abort();
    },
  };
}

export async function fetchSmsJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`SMS request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function isNearBottom(
  element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'> | null,
): boolean {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SMS_SCROLL_BOTTOM_THRESHOLD_PX;
}

export interface SmsMessageIdentity {
  sid: string;
}

export function shouldFollowNewSmsMessages<T extends SmsMessageIdentity>(
  current: T[],
  next: T[],
  isAtBottom: boolean,
  initialLoad = false,
): boolean {
  if (initialLoad) return true;
  if (!isAtBottom) return false;
  const currentSids = new Set(current.map(message => message.sid));
  return next.some(message => !currentSids.has(message.sid));
}
