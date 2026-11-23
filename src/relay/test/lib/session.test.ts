import { describe, expect, it, vi } from 'vitest';
import { buildSessionStart, liveUrl } from '../../src/lib/live';
import { logInfo } from '../../src/lib/log';
import { SessionManager, type RelayEvent } from '../../src/lib/session';
import { FakeSocket, makePayload, ReadySocket } from '../helpers';

vi.mock('../../src/lib/log', () => ({
  logError: vi.fn<(...args: unknown[]) => void>(),
  logInfo: vi.fn<(...args: unknown[]) => void>(),
}));

const OPTIONS = {
  maxSessions: 2,
  idleSeconds: 30,
  model: 'gpt-live-1',
  voice: 'marin',
  readyTimeoutMs: 1000,
  closeTimeoutMs: 1000,
};

function managerWith(socket: FakeSocket) {
  return new SessionManager({ ...OPTIONS, connect: () => socket });
}

async function openSession(socket: FakeSocket = new ReadySocket().start()) {
  const manager = managerWith(socket);
  const session = await manager.create(makePayload(), 0);
  const events: RelayEvent[] = [];
  session.attach((event) => events.push(event));
  return { socket, manager, session, events };
}

describe('liveUrl / buildSessionStart', () => {
  it('GPT-Live の WebSocket の URL を作る（model は URL に入れない）', () => {
    expect(liveUrl('https://voice.openai.azure.com/')).toBe(
      'wss://voice.openai.azure.com/openai/v1/live/sessions',
    );
  });

  it('session.start には文書にあるフィールドだけを入れる', () => {
    expect(
      buildSessionStart({ model: 'gpt-live-1', instructions: '指示', voice: 'marin' }),
    ).toEqual({
      type: 'session.start',
      session: { model: 'gpt-live-1', instructions: '指示', audio: { output: { voice: 'marin' } } },
    });
  });
});

describe('SessionManager', () => {
  it('接続したら session.start を送り、session.started で使えるようになる', async () => {
    const { socket, manager } = await openSession();
    const start = socket.sent[0] as { type: string; session: Record<string, unknown> };
    expect(start.type).toBe('session.start');
    expect(start.session.instructions).toBe('RICE の情報を聞き出してください。');
    expect(start.session.model).toBe('gpt-live-1');
    expect(manager.size).toBe(1);
  });

  it('`"error": null` を持つだけのイベントは、エラーとして扱わない', async () => {
    const socket = new FakeSocket();
    const manager = managerWith(socket);
    const created = manager.create(makePayload(), 0);
    socket.open();
    socket.receive({ type: 'session.started', error: null });
    const session = await created;
    const events: RelayEvent[] = [];
    session.attach((event) => events.push(event));
    session.close('client');
    socket.receive({ type: 'session.closed', error: null, usage: {} });
    expect(events).toEqual([{ event: 'closed', data: { reason: 'client' } }]);
    expect(socket.closed).toBe(true);
  });

  it('開始が拒否されたら失敗し、エラーの内容を含めない', async () => {
    const socket = new FakeSocket();
    const manager = managerWith(socket);
    const created = manager.create(makePayload(), 0);
    socket.open();
    socket.receive({ type: 'error', error: { code: 'invalid_value', message: 'secret detail' } });
    await expect(created).rejects.toThrow('rejected');
    expect(socket.closed).toBe(true);
    expect(manager.size).toBe(0);
  });

  it('開始の前に切断されたら失敗する', async () => {
    const socket = new FakeSocket();
    const created = managerWith(socket).create(makePayload(), 0);
    socket.disconnect();
    await expect(created).rejects.toThrow('before the session started');
  });

  it('時間内に始まらなければ失敗する', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const created = managerWith(socket).create(makePayload(), 0);
      vi.advanceTimersByTime(OPTIONS.readyTimeoutMs);
      await expect(created).rejects.toThrow('in time');
      expect(socket.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('音声と字幕の断片をブラウザー向けの形にして転送する', async () => {
    const { socket, events, session } = await openSession();
    expect(session.attach(() => {})).toBe(false);
    socket.receive({ type: 'session.output_audio.delta', delta: 'AAAA', start_ms: 0, end_ms: 100 });
    socket.receive({ type: 'session.output_transcript.delta', delta: '対象は', start_ms: 0 });
    socket.receive({ type: 'session.input_transcript.delta', delta: '500 社', start_ms: 0 });
    socket.receive({ type: 'session.input_transcript.delta', delta: '' });
    expect(events).toEqual([
      { event: 'audio', data: { delta: 'AAAA' } },
      { event: 'transcript', data: { role: 'assistant', delta: '対象は' } },
      { event: 'transcript', data: { role: 'user', delta: '500 社' } },
    ]);
  });

  it('委任には、会話を続けるよう応答する', async () => {
    const { socket } = await openSession();
    socket.sent = [];
    socket.receive({ type: 'session.delegation.created', id: 'del-1', target: 'client' });
    socket.receive({ type: 'session.delegation.created', delegation: { id: 'del-2' } });
    expect(socket.sent).toEqual([
      expect.objectContaining({ type: 'session.thinking.append', delegation_id: 'del-1' }),
      expect.objectContaining({ type: 'session.thinking.append', delegation_id: 'del-2' }),
    ]);
  });

  it('知らないイベントは種類名だけを 1 回記録する', async () => {
    const { socket } = await openSession();
    vi.mocked(logInfo).mockClear();
    socket.receive({ type: 'session.something', secret: 'x' });
    socket.receive({ type: 'session.something', secret: 'y' });
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logInfo).toHaveBeenCalledWith('Live event not handled', { type: 'session.something' });
  });

  it('音声を session.input_audio.append で送る', async () => {
    const { socket, session } = await openSession();
    session.appendAudio(Buffer.from([1, 2, 3]), 10);
    expect(socket.sent.at(-1)).toEqual({ type: 'session.input_audio.append', audio: 'AQID' });
    expect(session.lastActivityAt).toBe(10);
  });

  it('終了では session.close を送り、session.closed までの字幕も転送してから閉じる', async () => {
    const socket = new FakeSocket();
    queueMicrotask(() => socket.open());
    const manager = managerWith(socket);
    const created = manager.create(makePayload(), 0);
    await Promise.resolve();
    socket.receive({ type: 'session.started' });
    const session = await created;
    const events: RelayEvent[] = [];
    session.attach((event) => events.push(event));

    session.close('client');
    expect(socket.sentTypes().at(-1)).toBe('session.close');
    session.appendAudio(Buffer.from([1]), 1);
    expect(socket.sentTypes().at(-1)).toBe('session.close');
    expect(socket.closed).toBe(false);

    socket.receive({ type: 'session.output_transcript.delta', delta: 'まとめです' });
    socket.receive({ type: 'session.closed', reason: 'client', usage: {} });
    expect(events).toEqual([
      { event: 'transcript', data: { role: 'assistant', delta: 'まとめです' } },
      { event: 'closed', data: { reason: 'client' } },
    ]);
    expect(socket.closed).toBe(true);
    expect(manager.size).toBe(0);
  });

  it('session.closed が来なくても、時間がたてば閉じる', async () => {
    const socket = new FakeSocket();
    const manager = managerWith(socket);
    const created = manager.create(makePayload(), 0);
    socket.open();
    socket.receive({ type: 'session.started' });
    const session = await created;
    const events: RelayEvent[] = [];
    session.attach((event) => events.push(event));
    vi.useFakeTimers();
    try {
      session.close('time_limit');
      vi.advanceTimersByTime(OPTIONS.closeTimeoutMs);
      expect(events.at(-1)).toEqual({ event: 'closed', data: { reason: 'time_limit' } });
      expect(socket.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('上限時間と無通信で終了を始める', async () => {
    const { manager, session, socket } = await openSession();
    manager.sweep(29_000);
    expect(session.closing).toBe(false);
    manager.sweep(30_000);
    expect(session.closing).toBe(true);
    expect(socket.sentTypes().at(-1)).toBe('session.close');

    const other = await openSession();
    other.session.appendAudio(Buffer.from([0]), 299_000);
    other.manager.sweep(300_000);
    expect(other.session.closing).toBe(true);
  });

  it('GPT-Live が自分から閉じたら upstream_closed で閉じる', async () => {
    const { socket, events } = await openSession();
    socket.receive({ type: 'session.closed', reason: 'max_duration' });
    expect(events.at(-1)).toEqual({ event: 'closed', data: { reason: 'upstream_closed' } });
  });

  it('セッションキーを照合する', async () => {
    const { session } = await openSession();
    expect(session.authorize(`Bearer ${session.key}`)).toBe(true);
    expect(session.authorize('Bearer wrong')).toBe(false);
    expect(session.authorize(undefined)).toBe(false);
  });

  it('同時セッションの上限を知らせる', async () => {
    const manager = new SessionManager({ ...OPTIONS, connect: () => new ReadySocket().start() });
    await manager.create(makePayload(), 0);
    expect(manager.full).toBe(false);
    await manager.create(makePayload({ nonce: 'n2' }), 0);
    expect(manager.full).toBe(true);
  });
});
