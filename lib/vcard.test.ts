import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isVcardContentType, parseVCards } from './vcard';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sample_contact.vcf');
const sample = readFileSync(fixturePath, 'utf8');

test('parses the Apple iOS contact card fixture', () => {
  const [card] = parseVCards(sample);
  assert.equal(card.name, 'Maria Lopez');
  assert.equal(card.phones[0].value, '+1 (816) 555-1234');
  assert.equal(card.phones[0].pref, true);
  assert.equal(card.phones[1].value, '+1 (913) 555-0198');
  assert.equal(card.emails[0].value, 'maria@x.com');
  assert.equal(card.addresses[0].formatted, '4521 W 91st Terrace, Overland Park, KS 66207');
  assert.equal(card.org, 'Lopez Homes');
  assert.equal(card.note, 'Shared from iPhone. Looking around Overland Park');
});

test('accepts CRLF Apple cards and text/vcard content types', () => {
  const [card] = parseVCards(sample.replace(/\n/g, '\r\n'));
  assert.equal(card.name, 'Maria Lopez');
  assert.equal(isVcardContentType('text/x-vcard'), true);
  assert.equal(isVcardContentType('text/vcard; charset=utf-8'), true);
  assert.equal(isVcardContentType('image/jpeg'), false);
});

test('parses multiple cards, folded lines, quoted-printable, and ignores photos', () => {
  const raw = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Adams;Ken;;;',
    'FN:Ken Adams',
    'TEL;type=CELL:+19135550199',
    'EMAIL:ken@example.com',
    'END:VCARD',
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa',
    'TEL;type=HOME:+19135550000',
    'item2.TEL:+18165551234',
    'item2.X-ABLabel:mobile',
    'NOTE;ENCODING=QUOTED-PRINTABLE:Caf=C3=A9 meeting\\, Tuesday',
    'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ',
    ' SkZJRg==',
    'ORG:Lopez\\, Homes;',
    'END:VCARD',
  ].join('\n');

  const cards = parseVCards(raw);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, 'Ken Adams');
  assert.equal(cards[1].name, 'José García');
  assert.equal(cards[1].phones[0].value, '+18165551234');
  assert.match(cards[1].note || '', /Café meeting, Tuesday/);
  assert.equal(cards[1].org, 'Lopez, Homes');
});

test('builds a name from N when FN is missing', () => {
  const [card] = parseVCards('BEGIN:VCARD\nN:Lopez;Maria;Anne;Dr.;Jr.\nTEL:+18165551234\nEND:VCARD\n');
  assert.equal(card.name, 'Dr. Maria Anne Lopez Jr.');
});

test('unfolds a folded NOTE without eating the space', () => {
  const raw = 'BEGIN:VCARD\nFN:Folded Note\nTEL:+18165551234\nNOTE:Looking around \n Overland Park\nEND:VCARD\n';
  const [card] = parseVCards(raw);
  assert.equal(card.note, 'Looking around Overland Park');
});
