import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest } from '../helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../../src/lib/store', () => ({ getProduct: vi.fn<() => Promise<unknown>>() }));
vi.mock('../../src/lib/transcription', () => ({
  transcribe: vi.fn<(audio: Buffer, fileName: string) => Promise<string>>(),
}));

import * as store from '../../src/lib/store';
import { transcribe } from '../../src/lib/transcription';
import {
  audioFileName,
  MAX_AUDIO_BYTES,
  transcribeHandler,
} from '../../src/functions/transcriptions';

const product = {
  id: 'p1',
  name: '製品',
  strategy: '戦略',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const audioRequest = (contentType: string, rawBody = new Uint8Array([1, 2, 3])) =>
  makeRequest({ params: { productId: 'p1' }, headers: { 'content-type': contentType }, rawBody });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('audioFileName', () => {
  it('Content-Type のパラメーターを無視して拡張子を決める', () => {
    expect(audioFileName('audio/webm;codecs=opus')).toBe('audio.webm');
    expect(audioFileName('Audio/MP4')).toBe('audio.mp4');
  });

  it('対象外の形式なら undefined を返す', () => {
    expect(audioFileName('application/json')).toBeUndefined();
    expect(audioFileName(null)).toBeUndefined();
  });
});

describe('transcribeHandler', () => {
  it('文字起こしの結果を返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(transcribe).mockResolvedValue('  顧客から CSV 出力の要望がありました。 \n');

    const result = await transcribeHandler(audioRequest('audio/webm;codecs=opus'), makeContext());

    expect(result.jsonBody).toEqual({ text: '顧客から CSV 出力の要望がありました。' });
    const [audio, fileName] = vi.mocked(transcribe).mock.calls[0];
    expect([...audio]).toEqual([1, 2, 3]);
    expect(fileName).toBe('audio.webm');
  });

  it('対象外の形式は 415 を返す', async () => {
    const result = await transcribeHandler(audioRequest('audio/wav'), makeContext());
    expect(result.status).toBe(415);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('空の音声は 400 を返す', async () => {
    const result = await transcribeHandler(
      audioRequest('audio/mp4', new Uint8Array()),
      makeContext(),
    );
    expect(result.status).toBe(400);
  });

  it('上限を超える音声は 413 を返す', async () => {
    const result = await transcribeHandler(
      audioRequest('audio/webm', new Uint8Array(MAX_AUDIO_BYTES + 1)),
      makeContext(),
    );
    expect(result.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('プロダクトがなければ 404 を返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(undefined);
    const result = await transcribeHandler(audioRequest('audio/webm'), makeContext());
    expect(result.status).toBe(404);
  });

  it('文字起こしに失敗したら 502 を返し、外部の応答本文を含めない', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(transcribe).mockRejectedValue(new Error('401 secret detail'));
    const context = makeContext();

    const result = await transcribeHandler(audioRequest('audio/webm'), context);

    expect(result.status).toBe(502);
    expect(JSON.stringify(result.jsonBody)).not.toContain('secret detail');
    expect(context.error).toHaveBeenCalled();
  });
});
