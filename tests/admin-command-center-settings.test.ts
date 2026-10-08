import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('settings shows one Admin Portal link only behind the existing health eligibility flag', async () => {
  const appShell = await readFile(new URL('../components/AppShell.tsx', import.meta.url), 'utf8');
  const settingsMain = appShell.match(/\{settingsPage === 'main' && \([\s\S]*?\n          \)\}/);
  assert.ok(settingsMain, 'settings main view is present');

  const marker = '{showHealthLink && (';
  const start = settingsMain[0].indexOf(marker);
  assert.notEqual(start, -1);
  assert.equal(settingsMain[0].indexOf(marker, start + marker.length), -1);
  const link = settingsMain[0].slice(start + marker.length, settingsMain[0].indexOf(')}', start));

  assert.match(link, /<a[\s\S]*href="\/admin"/);
  assert.doesNotMatch(link, /href="https?:|href="\/admin#|target=|onClick|fetch\(|\/api\//);
  assert.match(link, /data-action="admin-open-command-center"/);
  assert.match(link, />Admin Portal</);
  assert.match(link, /Open the existing Admin Portal/);

  assert.equal((appShell.match(/data-action="admin-open-command-center"/g) || []).length, 1);
  assert.equal((appShell.match(/>Admin Portal</g) || []).length, 1);
  assert.equal((appShell.match(/fetch\('\/api\/admin\/phone-health', \{ cache: 'no-store' \}\)/g) || []).length, 1);
  assert.match(appShell, /if \(!cancelled && response\.status === 200\) setShowHealthLink\(true\)/);
  assert.equal((appShell.match(/setShowHealthLink\(true\)/g) || []).length, 1);
  assert.doesNotMatch(appShell, /\/api\/admin\/users|\/api\/admin\/ai-settings/);
  assert.match(settingsMain[0], /System Diagnostics/);
  assert.match(settingsMain[0], /href="\/api\/auth\/logout"/);
});
