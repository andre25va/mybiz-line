import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  applyCallErrorToLog,
  callEndMessage,
  describeCallError,
  diagnosticForReturnedCall,
  mergeLocalCall,
  nextLocalCallStatus,
  readCallStatus,
  readTwilioCallSid,
  type LocalCallEntry,
} from '../hooks/useTwilioDevice';

const localCall = (sid: string, status = 'initiated'): LocalCallEntry => ({
  sid,
  from: 'client:andre',
  to: '+17085069000',
  direction: 'outbound-api',
  status,
  duration: '0',
  startTime: '2026-10-07T03:12:59.813Z',
  local: true,
});

test('installed Voice SDK 2.18.5 has no documented public AudioContext getter on Device or AudioHelper', async () => {
  const pkg = JSON.parse(await readFile(new URL('../node_modules/@twilio/voice-sdk/package.json', import.meta.url), 'utf8')) as { version: string };
  const deviceDecl = await readFile(new URL('../node_modules/@twilio/voice-sdk/esm/twilio/device.d.ts', import.meta.url), 'utf8');
  const helperDecl = await readFile(new URL('../node_modules/@twilio/voice-sdk/esm/twilio/audiohelper.d.ts', import.meta.url), 'utf8');
  const publicHelper = await readFile(new URL('../node_modules/@twilio/voice-sdk/lib/twilio/public/audiohelper.d.ts', import.meta.url), 'utf8');
  assert.equal(pkg.version, '2.18.5');

  const getterAt = deviceDecl.indexOf('static get audioContext(): AudioContext | undefined;');
  assert.ok(getterAt > 0);
  const getterDoc = deviceDecl.slice(Math.max(0, getterAt - 220), getterAt);
  assert.match(getterDoc, /@private/);
  assert.match(deviceDecl, /private static _audioContext\?;/);
  assert.match(helperDecl, /private _audioContext\?;/);
  assert.doesNotMatch(helperDecl, /get audioContext\(/);
  assert.doesNotMatch(publicHelper, /audioContext/);
});

test('call diagnostics keep only a fixed message and integer code', () => {
  const payload = 'wss://voice.example/secret-path Connection Error eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3OTEzNDI3Nzl9.signaturevalue';
  const message = describeCallError({ code: 31005, message: payload, explanation: payload, causes: [payload] });
  assert.equal(message, 'Call failed (31005).');
  assert.equal(message.includes(payload), false);
  assert.equal(message.includes('secret'), false);
  assert.equal(message.includes('wss://'), false);
  assert.equal(describeCallError({ code: '31005', message: payload }), 'Call failed.');
  assert.equal(describeCallError({ message: payload }), 'Call failed.');
  assert.equal(describeCallError({}), 'Call failed.');
  assert.equal(describeCallError(payload), 'Call failed.');
  assert.equal(callEndMessage({
    accepted: false,
    localHangup: false,
    error: payload,
    event: 'disconnect',
  }), 'Call failed.');
});

test('terminal statuses record local events and do not name provider outcomes', () => {
  const input = { accepted: false, localHangup: false, error: null, event: 'disconnect' as const };
  assert.equal(callEndMessage(input), 'Call ended before it connected.');
  assert.equal(nextLocalCallStatus(input), 'ended-before-connect');
  assert.equal(callEndMessage({ ...input, localHangup: true }), null);
  assert.equal(nextLocalCallStatus({ ...input, localHangup: true }), 'ended-locally');
  assert.equal(callEndMessage({ ...input, accepted: true }), null);
  assert.equal(nextLocalCallStatus({ ...input, accepted: true }), 'ended-after-accept');
  assert.equal(callEndMessage({ ...input, error: 'Call failed (31005).' }), 'Call failed (31005).');
  assert.equal(nextLocalCallStatus({ ...input, error: 'Call failed (31005).' }), 'error');
  assert.equal(callEndMessage({ ...input, event: 'reject' }), 'The call was rejected locally before it connected.');
  assert.equal(nextLocalCallStatus({ ...input, event: 'reject' }), 'rejected');
  assert.equal(callEndMessage({ ...input, event: 'cancel' }), 'The call cancel event fired before it connected.');
  assert.equal(nextLocalCallStatus({ ...input, event: 'cancel' }), 'canceled');
  for (const status of ['no-answer', 'busy', 'completed', 'failed'] as const) {
    assert.equal(Object.values({
      disconnect: nextLocalCallStatus(input),
      reject: nextLocalCallStatus({ ...input, event: 'reject' }),
      cancel: nextLocalCallStatus({ ...input, event: 'cancel' }),
      local: nextLocalCallStatus({ ...input, localHangup: true }),
      accepted: nextLocalCallStatus({ ...input, accepted: true }),
      error: nextLocalCallStatus({ ...input, error: 'Call failed.' }),
    }).includes(status), false, status);
  }
});

test('local placeholder trace can be replaced with the Twilio CallSid once ringing provides one', () => {
  const entries = [localCall('local_1791342779813'), localCall('local_other')];
  const sid = `CA${'ab'.repeat(16)}`;
  assert.equal(readTwilioCallSid({ parameters: { CallSid: sid } }), sid);
  assert.equal(readTwilioCallSid({ parameters: { CallSid: 'local_1791342779813' } }), null);
  assert.equal(readTwilioCallSid({ parameters: {} }), null);

  const ringing = mergeLocalCall(entries, 'local_1791342779813', { sid, status: 'ringing' });
  assert.equal(ringing[0].sid, sid);
  assert.equal(ringing[0].status, 'ringing');
  assert.equal(ringing[0].duration, '0');
  assert.equal(ringing[1].sid, 'local_other');
  const ended = mergeLocalCall(ringing, sid, { status: 'ended-before-connect' });
  assert.equal(ended[0].status, 'ended-before-connect');
  assert.deepEqual(mergeLocalCall(entries, 'missing', { status: 'failed' }), entries);
});

test('voice-sdk 2.18.5 connect source yields _makeCallPromise, then calls activeCall.accept, then returns the Call', async () => {
  const deviceJs = await readFile(new URL('../node_modules/@twilio/voice-sdk/esm/twilio/device.js', import.meta.url), 'utf8');
  const callJs = await readFile(new URL('../node_modules/@twilio/voice-sdk/esm/twilio/call.js', import.meta.url), 'utf8');
  const connectAt = deviceJs.indexOf('connect() {');
  const connectBody = deviceJs.slice(connectAt, deviceJs.indexOf('get calls()', connectAt));
  const yielded = connectBody.indexOf('yield this._makeCallPromise');
  const accepted = connectBody.indexOf('activeCall.accept(');
  const returned = connectBody.indexOf('return activeCall');
  assert.ok(yielded > 0 && accepted > yielded && returned > accepted);
  assert.equal(connectBody.includes("emit('ringing'"), false);
  assert.equal(connectBody.includes("emit('error'"), false);

  const makeCallAt = deviceJs.indexOf('_makeCall(twimlParams_1, options_1)');
  const constructed = deviceJs.indexOf('const call = new', makeCallAt);
  const makeCallReturn = deviceJs.indexOf('return call;', constructed);
  const afterMakeCall = deviceJs.indexOf('_maybeStopIncomingSound() {', makeCallReturn);
  assert.ok(constructed > makeCallAt && makeCallReturn > constructed && afterMakeCall > makeCallReturn);
  assert.equal(deviceJs.slice(constructed, makeCallReturn).includes("emit('ringing'"), false);

  const ringingAt = callJs.indexOf('this._onRinging = (payload) => {');
  const ringingBody = callJs.slice(ringingAt, callJs.indexOf('this._onRTCSample', ringingAt));
  assert.match(ringingBody, /this\.emit\('ringing', hasEarlyMedia\)/);
  const acceptFn = callJs.indexOf('accept(options) {');
  const acceptBody = callJs.slice(acceptFn, callJs.indexOf('Disconnect from the {@link Call}', acceptFn));
  const mediaThen = acceptBody.indexOf('promise.then(');
  const errorEmit = acceptBody.indexOf("this.emit('error', twilioError)");
  assert.ok(mediaThen > 0 && errorEmit > mediaThen);
  assert.ok(acceptBody.indexOf('this._status = Call.State.Connecting') < mediaThen);
});

test('outbound dial path surfaces SDK errors without dropping inbound listeners or changing connect params', async () => {
  const hook = await readFile(new URL('../hooks/useTwilioDevice.ts', import.meta.url), 'utf8');
  const dialpad = await readFile(new URL('../components/Dialpad.tsx', import.meta.url), 'utf8');
  assert.match(hook, /device\.on\('incoming'/);
  assert.match(hook, /call\.on\('cancel', \(\) => setIncoming\(null\)\)/);
  assert.match(hook, /call\.on\('reject', \(\) => setIncoming\(null\)\)/);
  assert.match(hook, /deviceRef\.current\.connect\(\{ params: \{ To: to \} \}\)/);
  assert.match(hook, /call\.on\('error'/);
  assert.match(hook, /catch \(error\) \{/);
  assert.match(hook, /describeCallError\(error\)/);
  assert.doesNotMatch(hook, /catch \{\s*updateDiag/);
  assert.match(hook, /call\.on\('disconnect', \(\) => endCall\(call, 'disconnect'\)\)/);
  assert.match(hook, /audioContextState: context\?\.state \|\| 'unavailable'/);
  assert.doesNotMatch(hook, /Device\.audioContext/);
  assert.doesNotMatch(hook, /constructor\?\.audioContext/);
  assert.doesNotMatch(hook, /readSdkAudioContext/);
  assert.match(dialpad, /ready && activationError/);
  assert.match(dialpad, /data-action="start-call"/);
});

test('acceptance is recorded on the Call accept event and endCall ignores a different call', async () => {
  const hook = await readFile(new URL('../hooks/useTwilioDevice.ts', import.meta.url), 'utf8');
  const acceptCallAt = hook.indexOf('const acceptCall = useCallback');
  const rejectCallAt = hook.indexOf('const rejectCall = useCallback');
  const acceptCallBody = hook.slice(acceptCallAt, rejectCallAt);
  const acceptInvoke = acceptCallBody.indexOf('call.accept()');
  assert.ok(acceptCallAt > 0 && rejectCallAt > acceptCallAt && acceptInvoke > 0);
  assert.equal(acceptCallBody.includes('callAcceptedRef.current = true'), false);
  assert.match(acceptCallBody, /onConnect\(call\)/);
  assert.match(acceptCallBody, /setIncoming\(null\)/);
  assert.match(acceptCallBody, /call\.accept\(\)/);
  assert.equal(acceptCallBody.includes("setStatus('connected')"), false);
  assert.equal(acceptCallBody.includes('startTimer()'), false);

  const onConnectAt = hook.indexOf('const onConnect = useCallback');
  const makeCallAt = hook.indexOf('const makeCall = useCallback');
  const onConnectBody = hook.slice(onConnectAt, makeCallAt);
  const acceptListener = onConnectBody.indexOf("call.on('accept'");
  const recorded = onConnectBody.indexOf('callAcceptedRef.current = true', acceptListener);
  const connected = onConnectBody.indexOf("setStatus('connected')", acceptListener);
  const timer = onConnectBody.indexOf('startTimer()', acceptListener);
  const errorListener = onConnectBody.indexOf("call.on('error'", acceptListener);
  assert.ok(acceptListener > 0 && recorded > acceptListener && connected > acceptListener && timer > acceptListener);
  assert.ok(recorded < errorListener && connected < errorListener && timer < errorListener);

  const endCallAt = hook.indexOf('const endCall = useCallback');
  const endCallBody = hook.slice(endCallAt, onConnectAt);
  assert.match(endCallBody, /if \(call !== connRef\.current\) return;/);
  assert.match(onConnectBody, /endCall\(call, 'reject'\)/);
  assert.match(onConnectBody, /endCall\(call, 'disconnect'\)/);
  assert.match(onConnectBody, /endCall\(call, 'cancel'\)/);
  assert.match(hook, /call\.on\('cancel', \(\) => setIncoming\(null\)\)/);
  assert.match(hook, /call\.on\('reject', \(\) => setIncoming\(null\)\)/);
  assert.match(hook, /incoming\?\.call\.reject\(\)/);
});

test('disconnect then error records error on that call trace and leaves a newer trace', async () => {
  const older = localCall('local_older', 'ended-before-connect');
  const newer = localCall('local_newer', 'ringing');
  const afterDisconnect = applyCallErrorToLog([older, newer], 'local_older', 'local_newer', false);
  assert.ok(afterDisconnect);
  assert.equal(afterDisconnect[0].status, 'error');
  assert.equal(afterDisconnect[1].status, 'ringing');
  assert.equal(applyCallErrorToLog([older], 'local_older', null, false)?.[0].status, 'error');
  assert.equal(applyCallErrorToLog([localCall('local_older', 'ended-locally')], 'local_older', null, false), null);
  assert.equal(applyCallErrorToLog([localCall('local_older', 'ended-after-accept')], 'local_older', null, false)?.[0].status, 'error');
  assert.equal(applyCallErrorToLog([newer], 'local_older', 'local_older', false), null);

  const callJs = await readFile(new URL('../node_modules/@twilio/voice-sdk/esm/twilio/call.js', import.meta.url), 'utf8');
  const peerJs = await readFile(new URL('../node_modules/@twilio/voice-sdk/esm/twilio/rtc/peerconnection.js', import.meta.url), 'utf8');
  const acceptFn = callJs.indexOf('accept(options) {');
  const acceptBody = callJs.slice(acceptFn, callJs.indexOf('Disconnect from the {@link Call}', acceptFn));
  const rejection = acceptBody.indexOf('}, (error) => {');
  assert.ok(rejection > 0);
  assert.ok(acceptBody.indexOf('this._disconnect()', rejection) < acceptBody.indexOf("this.emit('error', twilioError)", rejection));
  const closeFn = peerJs.indexOf('PeerConnection.prototype.close = function () {');
  const closeBody = peerJs.slice(closeFn, peerJs.indexOf('PeerConnection.prototype.reject', closeFn));
  assert.match(closeBody, /this\.onclose\(\);/);
  const onClose = callJs.indexOf('this._mediaHandler.onclose = () => {');
  const onCloseBody = callJs.slice(onClose, callJs.indexOf('this._pstream = config.pstream', onClose));
  assert.match(onCloseBody, /this\.emit\('disconnect', this\)/);

  const hook = await readFile(new URL('../hooks/useTwilioDevice.ts', import.meta.url), 'utf8');
  const errorAt = hook.indexOf("call.on('error'");
  const errorBody = hook.slice(errorAt, hook.indexOf("call.on('reject'", errorAt));
  assert.match(errorBody, /applyCallErrorToLog\(/);
  assert.match(hook, /if \(call !== connRef\.current\) return;/);
});

test('accepted calls keep an SDK error unless the hangup was local', () => {
  const acceptedError = {
    accepted: true,
    localHangup: false,
    error: 'Call failed (31005).',
    event: 'disconnect' as const,
  };
  assert.equal(callEndMessage(acceptedError), 'Call failed (31005).');
  assert.equal(nextLocalCallStatus(acceptedError), 'error');
  assert.equal(callEndMessage({ ...acceptedError, error: null }), null);
  assert.equal(nextLocalCallStatus({ ...acceptedError, error: null }), 'ended-after-accept');
  assert.equal(callEndMessage({ ...acceptedError, localHangup: true }), null);
  assert.equal(nextLocalCallStatus({ ...acceptedError, localHangup: true }), 'ended-locally');
  assert.equal(applyCallErrorToLog(
    [localCall('local_accepted', 'in-progress')],
    'local_accepted',
    'local_accepted',
    true,
  )?.[0].status, 'error');
});

test('a returned call that is already closed is a failure without an SDK error code', async () => {
  assert.equal(readCallStatus({ status: () => 'closed' }), 'closed');
  assert.equal(readCallStatus({ status: () => 'connecting' }), 'connecting');
  assert.equal(readCallStatus({ status: () => { throw new Error('status failed'); } }), undefined);
  assert.equal(readCallStatus(null), undefined);
  const closed = diagnosticForReturnedCall('closed');
  assert.deepEqual(closed, { message: 'Call failed.', traceStatus: 'error' });
  assert.equal(closed?.message.includes('('), false);
  assert.equal(diagnosticForReturnedCall('connecting'), null);
  assert.equal(diagnosticForReturnedCall('open'), null);

  const events: string[] = [];
  let status = 'pending';
  const media = Promise.reject(Object.assign(new Error('media'), { code: 31402 }));
  const call = {
    status: () => status,
    accept() {
      status = 'connecting';
      media.then(() => undefined, () => {
        status = 'closed';
        events.push('disconnect', 'error');
      });
    },
  };
  const connect = async () => {
    call.accept();
    return call;
  };
  const returned = await connect();
  assert.deepEqual(events, ['disconnect', 'error']);
  assert.equal(diagnosticForReturnedCall(readCallStatus(returned))?.message, 'Call failed.');
  assert.equal(events.includes('31402'), false);
});
