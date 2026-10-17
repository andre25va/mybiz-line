import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  draftsQuery,
  nextDraftPollDelay,
  pageDraftRows,
  parseDraftCursor,
  parseDraftLimit,
  readDraftPage,
} from '../lib/drafts-page';

test('draft limit defaults to 25 and caps at 50', () => {
  assert.equal(parseDraftLimit(null), 25);
  assert.equal(parseDraftLimit(''), 25);
  assert.equal(parseDraftLimit('0'), 25);
  assert.equal(parseDraftLimit('nope'), 25);
  assert.equal(parseDraftLimit('10'), 10);
  assert.equal(parseDraftLimit('500'), 50);
});

test('draft cursor rejects a non-date and keeps a valid instant', () => {
  assert.deepEqual(parseDraftCursor(null), { iso: null, invalid: false });
  assert.equal(parseDraftCursor('not-a-date').invalid, true);
  assert.equal(parseDraftCursor('2026-01-02T03:04:05.000Z').iso, '2026-01-02T03:04:05.000Z');
});

test('draft query asks for one extra row and an exclusive cursor', () => {
  const query = draftsQuery(50, '2026-01-02T03:04:05.000Z');
  assert.match(query, /select=id,from_number,original_message,draft_text,created_at,status/);
  assert.match(query, /status=eq\.pending/);
  assert.match(query, /from_number=not\.is\.null/);
  assert.match(query, /order=created_at\.desc/);
  assert.match(query, /limit=51/);
  assert.match(query, /created_at=lt\.2026-01-02T03%3A04%3A05\.000Z/);
  assert.doesNotMatch(query, /select=\*/);
});

test('keyset pages 60 distinct timestamps without gaps or duplicates', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    id: `draft-${index}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 60 - index)).toISOString(),
  }));
  const seen = new Set<string>();
  let before: string | null = null;
  let pages = 0;
  while (pages < 5) {
    const filtered = rows.filter(row => !before || row.created_at < before);
    const fetched = filtered.slice(0, 26);
    const page = pageDraftRows(fetched, 25);
    for (const item of page.items) {
      assert.equal(seen.has(item.id), false);
      seen.add(item.id);
    }
    pages += 1;
    if (!page.nextCursor) break;
    before = page.nextCursor;
  }
  assert.equal(seen.size, 60);
  assert.equal(pages, 3);
});

test('draft page reader accepts the new object and a legacy array', () => {
  assert.deepEqual(readDraftPage([{ id: '1', created_at: '2026-01-01T00:00:00.000Z' }]).items.length, 1);
  const page = readDraftPage({ items: [{ id: '2', created_at: '2026-01-01T00:00:00.000Z' }], nextCursor: '2026-01-01T00:00:00.000Z' });
  assert.equal(page.nextCursor, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(readDraftPage({}), { items: [], nextCursor: null });
});

test('draft poll backs off on failure and returns to 60s after success', () => {
  assert.equal(nextDraftPollDelay(60_000, false), 60_000);
  assert.equal(nextDraftPollDelay(5_000, true), 10_000);
  assert.equal(nextDraftPollDelay(40_000, true), 60_000);
  assert.equal(nextDraftPollDelay(60_000, true), 60_000);
});
