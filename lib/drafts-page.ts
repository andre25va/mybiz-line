export const DRAFT_PAGE_DEFAULT = 25;
export const DRAFT_PAGE_MAX = 50;
export const DRAFT_COLUMNS = 'id,from_number,original_message,draft_text,created_at,status';

export type DraftRow = {
  id: string;
  from_number: string | null;
  original_message: string | null;
  draft_text: string;
  created_at: string;
  status?: string | null;
};

export function parseDraftLimit(raw: string | null): number {
  if (raw === null || raw === '') return DRAFT_PAGE_DEFAULT;
  if (!/^\d+$/.test(raw)) return DRAFT_PAGE_DEFAULT;
  const value = Number(raw);
  if (value < 1) return DRAFT_PAGE_DEFAULT;
  return Math.min(value, DRAFT_PAGE_MAX);
}

export function parseDraftCursor(raw: string | null): { iso: string | null; invalid: boolean } {
  if (raw === null || raw === '') return { iso: null, invalid: false };
  const time = Date.parse(raw);
  if (Number.isNaN(time)) return { iso: null, invalid: true };
  return { iso: new Date(time).toISOString(), invalid: false };
}

export function draftsQuery(limit: number, beforeIso: string | null): string {
  const cap = Math.min(Math.max(limit, 1), DRAFT_PAGE_MAX);
  let query = `/dispatcher_drafts?status=eq.pending&from_number=not.is.null&select=${DRAFT_COLUMNS}&order=created_at.desc&limit=${cap + 1}`;
  if (beforeIso) query += `&created_at=lt.${encodeURIComponent(beforeIso)}`;
  return query;
}

export function pageDraftRows<T extends { created_at: string }>(rows: T[], limit: number) {
  const cap = Math.min(Math.max(limit, 1), DRAFT_PAGE_MAX);
  const hasMore = rows.length > cap;
  const items = hasMore ? rows.slice(0, cap) : rows.slice();
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;
  return { items, nextCursor };
}

export function readDraftPage(body: unknown): { items: DraftRow[]; nextCursor: string | null } {
  if (Array.isArray(body)) return { items: body as DraftRow[], nextCursor: null };
  if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
    const page = body as { items: DraftRow[]; nextCursor?: unknown };
    const nextCursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    return { items: page.items, nextCursor };
  }
  return { items: [], nextCursor: null };
}

export function nextDraftPollDelay(currentMs: number, failed: boolean): number {
  if (!failed) return 60_000;
  const grown = Math.max(5_000, currentMs) * 2;
  return Math.min(60_000, grown);
}
