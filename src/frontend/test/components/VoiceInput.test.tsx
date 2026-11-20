import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { json, mockFetch, PRODUCT, selectProductInStorage } from '../fetchMock';

/** 録音の代わり。stop すると 1 チャンク分のデータを渡して onstop を呼ぶ。 */
class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn<() => void>();

function stubMicrophone(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

function openForm({ strict = false } = {}) {
  window.history.replaceState(null, '', '/proposals/new');
  render(
    strict ? (
      <StrictMode>
        <App />
      </StrictMode>
    ) : (
      <App />
    ),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  selectProductInStorage('p1');
  stopTrack.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('音声入力', () => {
  it('録音を止めると文字起こしの結果を内容の末尾に追記し、マイクを解放する', async () => {
    stubMicrophone(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    const fetchMock = mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/transcriptions': () => json({ text: '月次の帳票を CSV で出したい' }),
    });
    openForm();

    fireEvent.change(await screen.findByLabelText('内容'), { target: { value: '顧客 A の要望' } });
    fireEvent.click(screen.getByRole('button', { name: '音声で入力' }));
    const stop = await screen.findByRole('button', { name: /停止/ });
    expect(screen.getByRole('button', { name: '判定' })).toBeDisabled();
    fireEvent.click(stop);

    await waitFor(() =>
      expect(screen.getByLabelText('内容')).toHaveValue(
        '顧客 A の要望\n月次の帳票を CSV で出したい',
      ),
    );
    expect(stopTrack).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls.find(([url]) => url.endsWith('/transcriptions'))!;
    expect(init?.headers).toEqual({ 'content-type': 'audio/webm' });
    expect(init?.body).toBeInstanceOf(Blob);
    expect(screen.getByRole('button', { name: '音声で入力' })).toBeEnabled();
  });

  it('StrictMode（開発時の再マウント）でも録音して追記できる', async () => {
    stubMicrophone(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/transcriptions': () => json({ text: '音声の内容' }),
    });
    openForm({ strict: true });

    fireEvent.click(await screen.findByRole('button', { name: '音声で入力' }));
    fireEvent.click(await screen.findByRole('button', { name: /停止/ }));

    await waitFor(() => expect(screen.getByLabelText('内容')).toHaveValue('音声の内容'));
  });

  it('マイクの使用が拒否されたらその旨を表示する', async () => {
    stubMicrophone(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    mockFetch({ 'GET /api/products': [PRODUCT] });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声で入力' }));

    expect(await screen.findByText(/マイクの使用が許可されていません/)).toBeInTheDocument();
  });

  it('文字起こしに失敗したら API のメッセージを表示する', async () => {
    stubMicrophone(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/transcriptions': () =>
        json({ error: '音声の文字起こしに失敗しました。もう一度お試しください。' }, 502),
    });
    openForm();

    fireEvent.click(await screen.findByRole('button', { name: '音声で入力' }));
    fireEvent.click(await screen.findByRole('button', { name: /停止/ }));

    expect(await screen.findByText(/音声の文字起こしに失敗しました/)).toBeInTheDocument();
  });

  it('録音に対応していないブラウザーではボタンを表示しない', async () => {
    mockFetch({ 'GET /api/products': [PRODUCT] });
    openForm();

    await screen.findByLabelText('内容');
    expect(screen.queryByRole('button', { name: '音声で入力' })).not.toBeInTheDocument();
  });
});
