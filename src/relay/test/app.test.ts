import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRelayHandler, MAX_AUDIO_BYTES } from '../src/app';
import { SessionManager } from '../src/lib/session';
import { loadConfig } from '../src/lib/settings';
import { FakeSocket, makePayload, ReadySocket, SECRET, signTicket } from './helpers';

vi.mock('../src/lib/log', () => ({
  logError: vi.fn<(...args: unknown[]) => void>(),
  logInfo: vi.fn<(...args: unknown[]) => void>(),
}));

const ORIGIN = 'https://orange-field-0a2258e00.5.azurestaticapps.net';
const NOW = 1_900_000_000_000;

let server: Server;
let baseUrl: string;
let sockets: FakeSocket[];
let manager: SessionManager;
let makeSocket: () => FakeSocket;

beforeEach(async () => {
  sockets = [];
  makeSocket = () => new ReadySocket().start();
  const config = loadConfig({
    FOUNDRY_REALTIME_ENDPOINT: 'https://voice.openai.azure.com/',
    FOUNDRY_REALTIME_API_KEY: 'key',
    FOUNDRY_LIVE_MODEL: 'gpt-live-1',
    REALTIME_TICKET_SECRET: SECRET,
    RELAY_ALLOWED_ORIGINS: `${ORIGIN},https://orange-field-0a2258e00-*.*.5.azurestaticapps.net`,
  });
  manager = new SessionManager({
    maxSessions: 1,
    idleSeconds: 30,
    model: config.model,
    voice: config.voice,
    readyTimeoutMs: 1000,
    closeTimeoutMs: 1000,
    connect: () => {
      const socket = makeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  server = createServer(createRelayHandler(config, manager, () => NOW));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  manager.closeAll();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function post(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, ...headers },
    body,
  });
}

async function openSession(nonce = 'nonce-1') {
  const response = await post(
    '/sessions',
    JSON.stringify({ ticket: signTicket(makePayload({ nonce })) }),
    {
      'content-type': 'application/json',
    },
  );
  return { response, body: (await response.json()) as Record<string, string> };
}

describe('中継の HTTP ハンドラー', () => {
  it('チケットからセッションを開き、許可したオリジンを返す', async () => {
    const { response, body } = await openSession();
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(body).toMatchObject({ audioFormat: 'pcm', maxSeconds: 300 });
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('無効なチケットは 401、使い回しも 401', async () => {
    const bad = await post('/sessions', JSON.stringify({ ticket: 'a.b' }));
    expect(bad.status).toBe(401);
    expect((await openSession()).response.status).toBe(201);
    manager.closeAll();
    expect((await openSession()).response.status).toBe(401);
  });

  it('同時セッションの上限を超えたら 429', async () => {
    await openSession('n1');
    expect((await openSession('n2')).response.status).toBe(429);
  });

  it('GPT-Live が開始を拒否したら 502 を返し、応答内容を含めない', async () => {
    makeSocket = () => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        socket.open();
        socket.receive({ type: 'error', error: { message: 'secret detail' } });
      });
      return socket;
    };
    const { response, body } = await openSession();
    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('許可していないオリジンは 403、プリフライトにはキャッシュの期間を返す', async () => {
    const denied = await fetch(`${baseUrl}/healthz`, { headers: { origin: 'https://evil.com' } });
    expect(denied.status).toBe(403);
    const preflight = await fetch(`${baseUrl}/sessions`, {
      method: 'OPTIONS',
      headers: { origin: `https://orange-field-0a2258e00-7.eastasia.5.azurestaticapps.net` },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-max-age')).toBe('7200');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('音声を受け取り、セッションキーと形式と大きさを検査する', async () => {
    const { body } = await openSession();
    const path = `/sessions/${body.sessionId}/audio`;
    const auth = { authorization: `Bearer ${body.sessionKey}` };
    const octet = { 'content-type': 'application/octet-stream' };

    expect((await post(path, new Uint8Array([1, 2]), { ...auth, ...octet })).status).toBe(204);
    expect(sockets[0].sent.at(-1)).toEqual({ type: 'session.input_audio.append', audio: 'AQI=' });

    expect(
      (await post(path, new Uint8Array([1]), { ...octet, authorization: 'Bearer x' })).status,
    ).toBe(401);
    expect(
      (await post(path, new Uint8Array([1]), { ...auth, 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect(
      (await post(path, new Uint8Array(MAX_AUDIO_BYTES + 1), { ...auth, ...octet })).status,
    ).toBe(413);
    expect((await post(path, new Uint8Array(), { ...auth, ...octet })).status).toBe(400);
    expect(
      (
        await post('/sessions/00000000-0000-0000-0000-000000000000/audio', new Uint8Array([1]), {
          ...auth,
          ...octet,
        })
      ).status,
    ).toBe(404);
  });

  it('SSE でイベントを送り、終了したら closed を送って閉じる', async () => {
    const { body } = await openSession();
    const response = await fetch(`${baseUrl}/sessions/${body.sessionId}/events`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${body.sessionKey}` },
    });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toBe(': ok\n\n');

    sockets[0].receive({ type: 'session.output_audio.delta', delta: 'AAAA' });
    const deleted = await fetch(`${baseUrl}/sessions/${body.sessionId}`, {
      method: 'DELETE',
      headers: { origin: ORIGIN, authorization: `Bearer ${body.sessionKey}` },
    });
    expect(deleted.status).toBe(204);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toContain('event: audio\ndata: {"delta":"AAAA"}\n\n');
    expect(text).toContain('event: closed\ndata: {"reason":"client"}\n\n');
    expect(sockets[0].sentTypes()).toContain('session.close');
    expect(manager.size).toBe(0);
  });
});
