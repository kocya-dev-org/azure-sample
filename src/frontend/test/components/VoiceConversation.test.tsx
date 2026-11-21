import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { formatRecord, mergeRecord } from '@/components/VoiceConversation';
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

/** 中継の SSE。release を呼ぶまで、渡したイベントのあと閉じずに待つ。 */
function heldStream(events: { event: string; data: unknown }[]) {
  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const { event, data } of events) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }
        await closed;
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  return { response, release };
}

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

describe('mergeRecord / formatRecord', () => {
  it('空でない値だけを重ね、内容に追記する文にする', () => {
    const record = mergeRecord(
      mergeRecord({}, { summary: '帳票を CSV で出したい', reach: '四半期 500 社' }),
      { reach: '  ', effort: '1 人月', unknown: 'x' },
    );
    expect(record).toEqual({
      summary: '帳票を CSV で出したい',
      reach: '四半期 500 社',
      effort: '1 人月',
    });
    expect(formatRecord(record)).toBe(
      '帳票を CSV で出したい\n【Reach（対象ユーザー数）】四半期 500 社\n【Effort（工数）】1 人月',
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

  it('会話で記録した内容を、終了したらフォームに反映する', async () => {
    stubAudio(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    const events = heldStream([
      { event: 'audio', data: { delta: 'AAAA' } },
      { event: 'transcript', data: { role: 'assistant', text: 'どんな要望ですか？' } },
      { event: 'transcript', data: { role: 'user', text: '帳票を CSV で出したいです' } },
      {
        event: 'tool_call',
        data: {
          name: 'record_proposal_info',
          arguments: {
            title: 'CSV 出力',
            summary: '帳票を CSV で出したい',
            reach: '四半期 500 社',
          },
        },
      },
      { event: 'speech_started', data: {} },
    ]);
    const fetchMock = mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/voice-sessions': () =>
        json({ relayUrl: RELAY, ticket: 't', expiresAt: '', maxSeconds: 300 }),
      [`POST ${RELAY}/sessions`]: () => json(SESSION, 201),
      [`GET ${RELAY}/sessions/s1/events`]: () => events.response,
      [`POST ${RELAY}/sessions/s1/audio`]: () => new Response(null, { status: 204 }),
      [`DELETE ${RELAY}/sessions/s1`]: () => new Response(null, { status: 204 }),
    });
    openForm();

    fireEvent.change(await screen.findByLabelText('内容'), { target: { value: '顧客 A の要望' } });
    fireEvent.click(screen.getByRole('button', { name: '音声会話' }));

    const stop = await screen.findByRole('button', { name: /終了/ });
    expect(screen.getByRole('button', { name: '判定' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '音声で入力' })).toBeDisabled();
    expect(await screen.findByText('帳票を CSV で出したいです')).toBeInTheDocument();
    expect(screen.getByTestId('voice-conversation')).toHaveTextContent('四半期 500 社');
    expect(player.enqueue).toHaveBeenCalledWith('AAAA');
    expect(player.stop).toHaveBeenCalled();

    // フォームの現在値を渡して、聞き直しを避ける
    const [, ticketInit] = fetchMock.mock.calls.find(([url]) => url.endsWith('/voice-sessions'))!;
    expect(JSON.parse(ticketInit?.body as string)).toEqual({ title: '', body: '顧客 A の要望' });

    capture.onChunk?.(new Uint8Array([1, 2]));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === `${RELAY}/sessions/s1/audio`)).toBe(true),
    );
    const [, audioInit] = fetchMock.mock.calls.find(([url]) => url.endsWith('/s1/audio'))!;
    expect(audioInit?.headers).toEqual({
      authorization: 'Bearer key',
      'content-type': 'application/octet-stream',
    });

    fireEvent.click(stop);
    await waitFor(() =>
      expect(screen.getByLabelText('内容')).toHaveValue(
        '顧客 A の要望\n帳票を CSV で出したい\n【Reach（対象ユーザー数）】四半期 500 社',
      ),
    );
    expect(screen.getByLabelText('タイトル')).toHaveValue('CSV 出力');
    expect(stopTrack).toHaveBeenCalled();
    expect(capture.stop).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === `${RELAY}/sessions/s1` && init?.method === 'DELETE',
      ),
    ).toBe(true);
    expect(screen.queryByTestId('voice-conversation')).not.toBeInTheDocument();
    events.release();
  });

  it('中継がセッションを閉じたら、理由を表示して記録を反映する', async () => {
    stubAudio(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/voice-sessions': () =>
        json({ relayUrl: RELAY, ticket: 't', expiresAt: '', maxSeconds: 300 }),
      [`POST ${RELAY}/sessions`]: () => json(SESSION, 201),
      [`GET ${RELAY}/sessions/s1/events`]: () =>
        eventStream([
          {
            event: 'tool_call',
            data: { name: 'record_proposal_info', arguments: { effort: '2 人月' } },
          },
          { event: 'closed', data: { reason: 'idle' } },
        ]),
    });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声会話' }));

    expect(await screen.findByText(/音声が届かなくなったため/)).toBeInTheDocument();
    expect(screen.getByLabelText('内容')).toHaveValue('【Effort（工数）】2 人月');
    expect(screen.getByRole('button', { name: '音声会話' })).toBeEnabled();
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
    stubAudio(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
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
