import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AUTH_REQUEST_TIMEOUT_MS } from '../lib/auth-request';
import LoginPage from '../app/login/page';

async function mountLogin(pushes: string[] = []) {
  const router = { push: (path: string) => pushes.push(path) } as any;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(LoginPage),
    ));
  });
  return renderer;
}

async function submitPhone(renderer: ReactTestRenderer) {
  const input = renderer.root.findAllByType('input')[0];
  await act(async () => {
    input.props.onChange({ target: { value: '3125550100' } });
  });
  const form = renderer.root.findByType('form');
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} });
  });
}

function visibleText(renderer: ReactTestRenderer) {
  return JSON.stringify(renderer.toJSON());
}

test('ambiguous 502 offers explicit code entry and never auto-resends or bypasses verify', async () => {
  const originalFetch = globalThis.fetch;
  const pushes: string[] = [];
  let sendCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/send-otp') {
      sendCalls += 1;
      return new Response('private provider details', { status: 502 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 401 });
  }) as typeof fetch;

  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await mountLogin(pushes);
    await submitPhone(renderer);

    assert.match(visibleText(renderer), /Could not confirm delivery/);
    assert.match(visibleText(renderer), /I already have a code/);
    assert.match(visibleText(renderer), /A new request invalidates the previous code/);
    assert.equal(sendCalls, 1);

    await act(async () => {
      renderer!.root.findByProps({ 'data-action': 'login-enter-received-code' }).props.onClick();
    });
    assert.equal(renderer.root.findAllByType('input').length, 1);
    assert.equal(renderer.root.findByProps({ placeholder: '000000' }).type, 'input');
    assert.match(visibleText(renderer), /\(312\) 555-0100/);
    assert.equal(renderer.root.findByProps({ 'data-action': 'login-verify-code' }).props.disabled, true);
    assert.equal(sendCalls, 1);
    assert.deepEqual(pushes, []);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('client timeout clears Sending and offers explicit code entry without a resend', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const pushes: string[] = [];
  let sendCalls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sendCalls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  }) as typeof fetch;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
    originalSetTimeout(handler, timeout === AUTH_REQUEST_TIMEOUT_MS ? 0 : timeout, ...args)) as typeof setTimeout;

  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await mountLogin(pushes);
    await submitPhone(renderer);

    assert.match(visibleText(renderer), /Request timed out/);
    assert.match(visibleText(renderer), /I already have a code/);
    assert.equal(sendCalls, 1);
    assert.equal(renderer.root.findByProps({ 'data-action': 'login-send-code' }).props.disabled, false);

    await act(async () => {
      renderer!.root.findByProps({ 'data-action': 'login-enter-received-code' }).props.onClick();
    });
    assert.equal(renderer.root.findAllByType('input').length, 1);
    assert.equal(renderer.root.findByProps({ placeholder: '000000' }).type, 'input');
    assert.match(visibleText(renderer), /\(312\) 555-0100/);
    assert.equal(sendCalls, 1);
    assert.deepEqual(pushes, []);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('503 sign-in failure does not offer code entry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/send-otp') return new Response('{}', { status: 503 });
    return new Response('{}', { status: 401 });
  }) as typeof fetch;
  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await mountLogin();
    await submitPhone(renderer);
    const text = visibleText(renderer);
    assert.match(text, /Sign-in service is temporarily unavailable/);
    assert.doesNotMatch(text, /I already have a code/);
    assert.equal(renderer.root.findAllByProps({ 'data-action': 'login-enter-received-code' }).length, 0);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('429 code request tells the user to wait', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/send-otp') return new Response('{}', { status: 429 });
    return new Response('{}', { status: 401 });
  }) as typeof fetch;
  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await mountLogin();
    await submitPhone(renderer);
    const text = visibleText(renderer);
    assert.match(text, /Too many code requests/);
    assert.doesNotMatch(text, /I already have a code/);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('429 verification tells the user to request a new code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/send-otp') {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(input) === '/api/auth/verify-otp') return new Response('{}', { status: 429 });
    return new Response('{}', { status: 500 });
  }) as typeof fetch;
  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await mountLogin();
    await submitPhone(renderer);
    const input = renderer.root.findByProps({ placeholder: '000000' });
    await act(async () => {
      input.props.onChange({ target: { value: '123456' } });
    });
    const form = renderer.root.findByType('form');
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });
    assert.match(visibleText(renderer), /Too many attempts\. Request a new code\./);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = originalFetch;
  }
});
