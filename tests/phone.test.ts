import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUsPhone } from '../lib/phone';

test('normalizeUsPhone accepts US numbers and rejects everything else', () => {
  assert.equal(normalizeUsPhone('3129989898'), '+13129989898');
  assert.equal(normalizeUsPhone('13129989898'), '+13129989898');
  assert.equal(normalizeUsPhone('(312) 998-9898'), '+13129989898');
  assert.equal(normalizeUsPhone('+1 312 998 9898'), '+13129989898');
  assert.equal(normalizeUsPhone('3125550100'), '+13125550100');

  for (const raw of ['12345', '0129989898', '1129989898', '3120989898', '123456789012', '', '+44 20 7946 0958', '312-998-9898 ext 2']) {
    assert.equal(normalizeUsPhone(raw), null, raw);
  }
});
