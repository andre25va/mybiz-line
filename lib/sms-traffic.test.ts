import assert from 'node:assert/strict';
import test from 'node:test';
import {
  belongsToNumber,
  buildConversations,
  dedupeMessages,
  fetchNumberMessages,
  type SmsRecord,
} from './sms-traffic';

const OUR = '+14647333257';
const SERVICE = 'MGe41dc3cd2772ee4f016f824a7e998e31';

const assistantSend: SmsRecord = {
  sid: 'SM810de2f08726eb3932dffa369d9755be',
  from: '+14647333257',
  to: '+12404188899',
  body: 'On my way',
  direction: 'outbound-api',
  status: 'delivered',
  dateSent: '2026-10-05T00:55:00.000Z',
  dateCreated: '2026-10-05T00:54:58.000Z',
  messagingServiceSid: SERVICE,
};

test('a delivered messaging-service send is part of the inbox even when the From filter missed it', () => {
  const fromFilter: SmsRecord[] = [];
  const recentAccount: SmsRecord[] = [assistantSend];
  const visible = dedupeMessages([...fromFilter, ...recentAccount]).filter((message) =>
    belongsToNumber(message, OUR, [SERVICE]),
  );
  const convos = buildConversations(visible, OUR, [SERVICE]);
  assert.equal(convos.length, 1);
  assert.equal(convos[0].number, '+12404188899');
  assert.equal(convos[0].lastMsg, 'On my way');
  assert.equal(convos[0].lastDirection, 'outbound');
  assert.equal(convos[0].unread, 0);
  assert.equal(convos[0].lastTime, '2026-10-05T00:55:00.000Z');
});

test('fetch merges From, To, and recent account lists and keeps the assistant send', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    messages: {
      list: async (opts: { from?: string; to?: string; limit?: number }) => {
        calls.push(opts);
        if (opts.to === '+12404188899') return [assistantSend];
        if (!opts.from && !opts.to) return [assistantSend];
        return [];
      },
    },
  };

  const inbox = await fetchNumberMessages(client, { ourNumber: OUR, serviceSids: [SERVICE], limit: 50 });
  const thread = await fetchNumberMessages(client, {
    ourNumber: OUR,
    serviceSids: [SERVICE],
    contact: '+1 (240) 418-8899',
    limit: 50,
  });

  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].sid, assistantSend.sid);
  assert.equal(thread.length, 1);
  assert.ok(calls.some((opts) => !opts.from && !opts.to));
  assert.ok(calls.some((opts) => opts.to === '+12404188899' && !opts.from));
});

test('in-flight messaging-service sends with an empty From are included, other numbers are not', () => {
  const queued: SmsRecord = {
    sid: 'SMqueued',
    from: null,
    to: '+12404188899',
    body: 'Queued',
    direction: 'outbound-api',
    status: 'accepted',
    dateSent: null,
    dateCreated: '2026-10-05T00:56:00.000Z',
    messagingServiceSid: SERVICE,
  };
  const stranger: SmsRecord = {
    sid: 'SMother',
    from: '+15555550100',
    to: '+15555550199',
    body: 'nope',
    direction: 'outbound-api',
    status: 'delivered',
    dateSent: '2026-10-05T00:57:00.000Z',
    dateCreated: '2026-10-05T00:57:00.000Z',
    messagingServiceSid: 'MGsomeotherservice',
  };
  const inbound: SmsRecord = {
    sid: 'SMin',
    from: '+12404188899',
    to: OUR,
    body: 'Thanks',
    direction: 'inbound',
    status: 'received',
    dateSent: '2026-10-05T00:58:00.000Z',
    dateCreated: '2026-10-05T00:58:00.000Z',
    messagingServiceSid: null,
  };

  const convos = buildConversations([queued, stranger, inbound, assistantSend], OUR, [SERVICE]);
  assert.equal(convos.length, 1);
  assert.equal(convos[0].number, '+12404188899');
  assert.equal(convos[0].lastMsg, 'Thanks');
  assert.equal(convos[0].lastDirection, 'inbound');
  assert.deepEqual(convos.map((c) => c.number).includes('+15555550199'), false);
});
