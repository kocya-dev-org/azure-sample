import { describe, expect, it, vi } from 'vitest';
import { buildSessionUpdate, realtimeUrl } from '../../src/lib/realtime';
import { SessionManager, type RelayEvent } from '../../src/lib/session';
import { FakeSocket, makePayload, ReadySocket } from '../helpers';

vi.mock('../../src/lib/log', () => ({ logError: vi.fn<(...args: unknown[]) => void>() }));

const OPTIONS = {
  maxSessions: 2,
  idleSeconds: 30,
  audioFormat: 'pcm' as const,
  transcriptionModel: 'whisper-1',
  voice: 'marin',
  readyTimeoutMs: 1000,
};

function managerWith(socket: FakeSocket) {
  return new SessionManager({ ...OPTIONS, connect: () => socket });
}

async function openSession() {
  const socket = new ReadySocket().start();
  const manager = managerWith(socket);
  const session = await manager.create(makePayload(), 0);
  const events: RelayEvent[] = [];
  session.attach((event) => events.push(event));
  return { socket, manager, session, events };
}

describe('realtimeUrl', () => {
  it('v1 の WebSocket の URL を作る', () => {
    expect(realtimeUrl('https://voice.openai.azure.com/', 'gpt-realtime-2.1-mini')).toBe(
      'wss://voice.openai.azure.com/openai/v1/realtime?model=gpt-realtime-2.1-mini',
    );
  });
});

describe('buildSessionUpdate', () => {
  it('μ-law では rate を付けず、文字起こしを無効にできる', () => {
    const update = buildSessionUpdate({
      instructions: '指示',
      tools: [],
      audioFormat: 'pcmu',
      transcriptionModel: undefined,
      voice: 'marin',
    }) as { session: { audio: { input: Record<string, unknown> } } };
    expect(update.session.audio.input.format).toEqual({ type: 'audio/pcmu' });
    expect(update.session.audio.input.transcription).toBeNull();
  });
});

describe('SessionManager', () => {
  it('session.created に設定を送り、session.updated で使えるようになる', async () => {
    const { socket, manager } = await openSession();
    const update = socket.sent[0] as { type: string; session: Record<string, unknown> };
    expect(update.type).toBe('session.update');
    expect(update.session.instructions).toBe('RICE の情報を聞き出してください。');
    expect(update.session.tools).toEqual(makePayload().tools);
    expect(manager.size).toBe(1);
  });

  it('設定が拒否されたら失敗し、既定のセッションのまま使わない', async () => {
    const socket = new FakeSocket();
    const manager = managerWith(socket);
    const created = manager.create(makePayload(), 0);
    socket.receive({ type: 'session.created' });
    socket.receive({ type: 'error', error: { code: 'invalid_value', message: 'secret detail' } });
    await expect(created).rejects.toThrow('rejected');
    expect(socket.closed).toBe(true);
    expect(manager.size).toBe(0);
  });

  it('設定が時間内に終わらなければ失敗する', async () => {
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

  it('SSE をつないだら最初の発言を作らせ、2 本目は拒否する', async () => {
    const { socket, session } = await openSession();
    expect(socket.sentTypes()).toEqual(['session.update', 'response.create']);
    expect(session.attach(() => {})).toBe(false);
  });

  it('必要なイベントだけをブラウザー向けの形にして転送する', async () => {
    const { socket, events } = await openSession();
    socket.receive({ type: 'response.output_audio.delta', delta: 'AAAA' });
    socket.receive({
      type: 'response.output_audio_transcript.done',
      transcript: '対象は何人ですか？',
    });
    socket.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '500 社です',
    });
    socket.receive({ type: 'input_audio_buffer.speech_started' });
    socket.receive({ type: 'rate_limits.updated' });
    expect(events).toEqual([
      { event: 'audio', data: { delta: 'AAAA' } },
      { event: 'transcript', data: { role: 'assistant', text: '対象は何人ですか？' } },
      { event: 'transcript', data: { role: 'user', text: '500 社です' } },
      { event: 'speech_started', data: {} },
    ]);
  });

  it('ツール呼び出しを転送し、応答が終わってから結果と続きの応答を送る', async () => {
    const { socket, events } = await openSession();
    socket.sent = [];
    socket.receive({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        name: 'record_proposal_info',
        call_id: 'call-1',
        arguments: '{"reach":"四半期 500 社"}',
      },
    });
    expect(events).toEqual([
      {
        event: 'tool_call',
        data: { name: 'record_proposal_info', arguments: { reach: '四半期 500 社' } },
      },
    ]);
    expect(socket.sent).toEqual([]);

    socket.receive({ type: 'response.done' });
    expect(socket.sent).toEqual([
      {
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: 'call-1', output: '{"ok":true}' },
      },
      { type: 'response.create' },
    ]);
  });

  it('音声を base64 で Foundry に送る', async () => {
    const { socket, session } = await openSession();
    session.appendAudio(Buffer.from([1, 2, 3]), 10);
    expect(socket.sent.at(-1)).toEqual({ type: 'input_audio_buffer.append', audio: 'AQID' });
    expect(session.lastActivityAt).toBe(10);
  });

  it('上限時間と無通信でセッションを閉じる', async () => {
    const { manager, session, events, socket } = await openSession();
    manager.sweep(29_000);
    expect(session.closed).toBe(false);
    manager.sweep(30_000);
    expect(events.at(-1)).toEqual({ event: 'closed', data: { reason: 'idle' } });
    expect(socket.closed).toBe(true);
    expect(manager.size).toBe(0);

    const other = await openSession();
    other.session.appendAudio(Buffer.from([0]), 299_000);
    other.manager.sweep(300_000);
    expect(other.events.at(-1)).toEqual({ event: 'closed', data: { reason: 'time_limit' } });
  });

  it('Foundry が切断したらセッションを閉じる', async () => {
    const { socket, events } = await openSession();
    socket.disconnect();
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
