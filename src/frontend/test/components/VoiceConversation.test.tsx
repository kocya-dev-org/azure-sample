import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { appendTranscript, formatRecord } from '@/components/VoiceConversation';
import { eventStream, json, mockFetch, PRODUCT, selectProductInStorage } from '../fetchMock';

const capture = vi.hoisted(() => ({
  onChunk: undefined as ((bytes: Uint8Array) => void) | undefined,
  stop: vi.fn<() => void>(),
}));
const player = vi.hoisted(() => ({
  enqueue: vi.fn<(base64: string) => void>(),
  stop: vi.fn<() => void>(),
}));

vi.mock('@/audio/capture', () => ({
  startCapture: vi.fn<
    (
      context: unknown,
      stream: unknown,
      format: unknown,
      onChunk: (b: Uint8Array) => void,
    ) => Promise<{ stop: () => void }>
  >(async (_context, _stream, _format, onChunk) => {
    capture.onChunk = onChunk;
    return { stop: capture.stop };
  }),
}));
vi.mock('@/audio/player', () => ({
  AudioPlayer: class {
    enqueue = player.enqueue;
    stop = player.stop;
  },
}));

const RELAY = 'https://relay.example.net';
const SESSION = { sessionId: 's1', sessionKey: 'key', audioFormat: 'pcm', maxSeconds: 300 };
const TICKET = { relayUrl: RELAY, ticket: 't', expiresAt: '', maxSeconds: 300 };
const RECORD = {
  title: 'CSV 出力',
  summary: '帳票を CSV で出したい',
  reach: '四半期 500 社',
  impact: '',
  confidence: '',
  effort: '',
};
const stopTrack = vi.fn<() => void>();
const closeContext = vi.fn<() => Promise<void>>(async () => {});

function stubAudio(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = async () => {};
      close = closeContext;
    },
  );
  vi.stubGlobal('AudioWorkletNode', class {});
  // 「音声で入力」も表示させ、会話中に無効になることを確かめる
  vi.stubGlobal('MediaRecorder', class {});
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

const microphone = async () => ({ getTracks: () => [{ stop: stopTrack }] });

type SseEvent = { event: string; data: unknown };

/** 中継の SSE。push でイベントを足し、end で閉じる。 */
function liveStream(events: SseEvent[]) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encode = ({ event, data }: SseEvent) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        for (const event of events) c.enqueue(encode(event));
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  return {
    response,
    push: (event: SseEvent) => controller.enqueue(encode(event)),
    end: () => controller.close(),
  };
}

const transcript = (role: 'user' | 'assistant', delta: string) => ({
  event: 'transcript',
  data: { role, delta },
});

function openForm() {
  window.history.replaceState(null, '', '/proposals/new');
  render(<App />);
}

beforeEach(() => {
  window.localStorage.clear();
  selectProductInStorage('p1');
  stopTrack.mockReset();
  closeContext.mockClear();
  capture.stop.mockReset();
  player.enqueue.mockReset();
  player.stop.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('appendTranscript / formatRecord', () => {
  it('同じ話者の断片は直前の発言につなげ、上限を超えた分は捨てる', () => {
    let turns = appendTranscript([], 'assistant', 'どんな');
    turns = appendTranscript(turns, 'assistant', '要望ですか？');
    turns = appendTranscript(turns, 'user', '帳票を');
    turns = appendTranscript(turns, 'user', 'CSV で');
    expect(turns).toEqual([
      { role: 'assistant', text: 'どんな要望ですか？' },
      { role: 'user', text: '帳票をCSV で' },
    ]);
    expect(appendTranscript(turns, 'assistant', 'あいうえお', 19)).toEqual([
      ...turns,
      { role: 'assistant', text: 'あい' },
    ]);
    expect(appendTranscript(turns, 'assistant', 'x', 17)).toBe(turns);
  });

  it('発言の数が上限を超えたら、古い発言から捨てる', () => {
    let turns: ReturnType<typeof appendTranscript> = [];
    for (let i = 0; i < 250; i += 1) {
      turns = appendTranscript(turns, i % 2 === 0 ? 'user' : 'assistant', `発言${i}`);
    }
    expect(turns).toHaveLength(200);
    expect(turns.at(-1)?.text).toBe('発言249');
  });

  it('記録を内容に追記する文にし、空の項目は出さない', () => {
    expect(formatRecord(RECORD)).toBe(
      '帳票を CSV で出したい\n【Reach（対象ユーザー数）】四半期 500 社',
    );
  });
});

describe('音声会話', () => {
  it('対応していないブラウザーでは、ボタンを表示しない', async () => {
    mockFetch({ 'GET /api/products': [PRODUCT] });
    openForm();
    await screen.findByLabelText('内容');
    expect(screen.queryByRole('button', { name: '音声会話' })).not.toBeInTheDocument();
  });

  it('終了すると、終了直前の字幕まで含めて記録を取り出し、フォームに反映する', async () => {
    stubAudio(microphone);
    const stream = liveStream([
      { event: 'audio', data: { delta: 'AAAA' } },
      transcript('assistant', 'どんな'),
      transcript('assistant', '要望ですか？'),
      transcript('user', '帳票を CSV で'),
      transcript('user', '出したいです'),
    ]);
    const fetchMock = mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/voice-sessions': () => json(TICKET),
      [`POST ${RELAY}/sessions`]: () => json(SESSION, 201),
      [`GET ${RELAY}/sessions/s1/events`]: () => stream.response,
      [`POST ${RELAY}/sessions/s1/audio`]: () => new Response(null, { status: 204 }),
      [`DELETE ${RELAY}/sessions/s1`]: () => {
        // 中継は session.closed までの字幕を送ってから閉じる
        setTimeout(() => {
          stream.push(transcript('assistant', 'まとめると四半期 500 社ですね。'));
          stream.push({ event: 'closed', data: { reason: 'client' } });
          stream.end();
        }, 0);
        return new Response(null, { status: 204 });
      },
      'POST /api/products/p1/voice-sessions/extract': () => json({ record: RECORD }),
    });
    openForm();

    fireEvent.change(await screen.findByLabelText('内容'), { target: { value: '顧客 A の要望' } });
    fireEvent.click(screen.getByRole('button', { name: '音声会話' }));

    const stop = await screen.findByRole('button', { name: /終了/ });
    expect(screen.getByRole('button', { name: '判定' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '音声で入力' })).toBeDisabled();
    expect(screen.getByText(/ヘッドセットの利用をおすすめします/)).toBeInTheDocument();
    expect(await screen.findByText('帳票を CSV で出したいです')).toBeInTheDocument();
    expect(screen.getByText('どんな要望ですか？')).toBeInTheDocument();
    expect(player.enqueue).toHaveBeenCalledWith('AAAA');

    // フォームの現在値を渡して、聞き直しを避ける
    const [, ticketInit] = fetchMock.mock.calls.find(([url]) => url.endsWith('/voice-sessions'))!;
    expect(JSON.parse(ticketInit?.body as string)).toEqual({ title: '', body: '顧客 A の要望' });

    capture.onChunk?.(new Uint8Array([1, 2]));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === `${RELAY}/sessions/s1/audio`)).toBe(true),
    );

    fireEvent.click(stop);
    await waitFor(() =>
      expect(screen.getByLabelText('内容')).toHaveValue(
        '顧客 A の要望\n帳票を CSV で出したい\n【Reach（対象ユーザー数）】四半期 500 社',
      ),
    );
    expect(screen.getByLabelText('タイトル')).toHaveValue('CSV 出力');
    const [, extractInit] = fetchMock.mock.calls.find(([url]) => url.endsWith('/extract'))!;
    expect(JSON.parse(extractInit?.body as string)).toEqual({
      title: '',
      body: '顧客 A の要望',
      transcript: [
        { role: 'assistant', text: 'どんな要望ですか？' },
        { role: 'user', text: '帳票を CSV で出したいです' },
        { role: 'assistant', text: 'まとめると四半期 500 社ですね。' },
      ],
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(capture.stop).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
    expect(screen.queryByTestId('voice-conversation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '音声会話' })).toBeEnabled();
  });

  it('中継がセッションを閉じたら、理由を表示して記録を反映する', async () => {
    stubAudio(microphone);
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/voice-sessions': () => json(TICKET),
      [`POST ${RELAY}/sessions`]: () => json(SESSION, 201),
      [`GET ${RELAY}/sessions/s1/events`]: () =>
        eventStream([
          transcript('user', '工数は 2 人月です'),
          { event: 'closed', data: { reason: 'idle' } },
        ]),
      'POST /api/products/p1/voice-sessions/extract': () =>
        json({ record: { ...RECORD, title: '', summary: '', reach: '', effort: '2 人月' } }),
    });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声会話' }));

    expect(await screen.findByText(/音声が届かなくなったため/)).toBeInTheDocument();
    expect(screen.getByLabelText('内容')).toHaveValue('【Effort（工数）】2 人月');
    expect(screen.getByRole('button', { name: '音声会話' })).toBeEnabled();
  });

  it('記録の取り出しに失敗したら、エラーを表示してフォームを変えない', async () => {
    stubAudio(microphone);
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/voice-sessions': () => json(TICKET),
      [`POST ${RELAY}/sessions`]: () => json(SESSION, 201),
      [`GET ${RELAY}/sessions/s1/events`]: () =>
        eventStream([
          transcript('user', '帳票を CSV で出したい'),
          { event: 'closed', data: { reason: 'time_limit' } },
        ]),
      'POST /api/products/p1/voice-sessions/extract': () =>
        json({ error: '会話の内容をまとめられませんでした。もう一度お試しください。' }, 502),
    });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声会話' }));

    expect(await screen.findByText(/会話の内容をまとめられませんでした/)).toBeInTheDocument();
    expect(screen.getByLabelText('内容')).toHaveValue('');
    expect(screen.getByRole('button', { name: '音声会話' })).toBeEnabled();
  });

  it('記録できる内容がなければ、その旨を表示する', async () => {
    stubAudio(microphone);
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/voice-sessions': () => json(TICKET),
      [`POST ${RELAY}/sessions`]: () => json(SESSION, 201),
      [`GET ${RELAY}/sessions/s1/events`]: () =>
        eventStream([
          transcript('user', 'こんにちは'),
          { event: 'closed', data: { reason: 'time_limit' } },
        ]),
      'POST /api/products/p1/voice-sessions/extract': () =>
        json({
          record: { title: '', summary: '', reach: '', impact: '', confidence: '', effort: '' },
        }),
    });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声会話' }));

    expect(
      await screen.findByText('会話から記録できる内容が見つかりませんでした。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('内容')).toHaveValue('');
  });

  it('マイクの使用が拒否されたら、その旨を表示する', async () => {
    stubAudio(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    mockFetch({ 'GET /api/products': [PRODUCT] });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声会話' }));

    expect(await screen.findByText(/マイクの使用が許可されていません/)).toBeInTheDocument();
    expect(closeContext).toHaveBeenCalled();
  });

  it('音声会話が使えないときは、API のエラーを表示する', async () => {
    stubAudio(microphone);
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/voice-sessions': () =>
        json({ error: '音声会話は現在利用できません。' }, 503),
    });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声会話' }));

    expect(await screen.findByText('音声会話は現在利用できません。')).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });
});
