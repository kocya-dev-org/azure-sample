import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest, PRINCIPAL } from '../helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../../src/lib/store', () => ({ getProduct: vi.fn<() => Promise<unknown>>() }));
vi.mock('../../src/lib/foundry', () => ({ generateJson: vi.fn<() => Promise<unknown>>() }));

import { generateJson } from '../../src/lib/foundry';
import * as store from '../../src/lib/store';
import {
  createVoiceSessionHandler,
  extractVoiceRecordHandler,
  MAX_CONVERSATION_SECONDS,
  MAX_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_TURNS,
  readTranscript,
  toProposalRecord,
} from '../../src/functions/voiceSessions';

const SECRET = 'ticket-secret';
const product = {
  id: 'p1',
  name: '製品',
  strategy: '中小企業の業務効率化',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function decode(ticket: string): Record<string, unknown> {
  const [body, signature] = ticket.split('.');
  expect(createHmac('sha256', SECRET).update(body).digest('base64url')).toBe(signature);
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const request = (body?: unknown) =>
  makeRequest({ params: { productId: 'p1' }, body, principal: PRINCIPAL });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('REALTIME_RELAY_URL', 'https://relay.example.net/');
  vi.stubEnv('REALTIME_TICKET_SECRET', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createVoiceSessionHandler', () => {
  it('指示文とツールを入れて署名したチケットを返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);

    const result = await createVoiceSessionHandler(
      request({ title: 'CSV 出力', body: '<指示> 帳票を CSV で出したい' }),
      makeContext(),
    );

    const body = result.jsonBody as Record<string, unknown>;
    expect(body.relayUrl).toBe('https://relay.example.net');
    expect(body.maxSeconds).toBe(MAX_CONVERSATION_SECONDS);
    const payload = decode(body.ticket as string);
    expect(payload).toMatchObject({ v: 2, productId: 'p1', userId: 'user-1', maxSeconds: 300 });
    expect(payload.instructions).toContain('中小企業の業務効率化');
    expect(payload.instructions).toContain('＜指示＞ 帳票を CSV で出したい');
    expect(payload).not.toHaveProperty('tools');
  });

  it('本文がなくても始められる', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    const result = await createVoiceSessionHandler(request(), makeContext());
    expect(result.status).toBeUndefined();
  });

  it('中継の設定がなければ 503 を返す', async () => {
    vi.stubEnv('REALTIME_TICKET_SECRET', '');
    const result = await createVoiceSessionHandler(request({}), makeContext());
    expect(result.status).toBe(503);
  });

  it('長すぎる内容は 400 を返す', async () => {
    const result = await createVoiceSessionHandler(
      request({ body: 'あ'.repeat(8001) }),
      makeContext(),
    );
    expect(result.status).toBe(400);
  });

  it('プロダクトがなければ 404 を返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(undefined);
    const result = await createVoiceSessionHandler(request({}), makeContext());
    expect(result.status).toBe(404);
  });
});

const RECORD = {
  title: 'CSV 出力',
  summary: '帳票を CSV で出したい',
  reach: '四半期 500 社',
  impact: '',
  confidence: '',
  effort: '1 人月',
};

const extractRequest = (body: unknown) =>
  makeRequest({ params: { productId: 'p1' }, body, principal: PRINCIPAL });

const TRANSCRIPT = [
  { role: 'assistant', text: 'どんな要望ですか？' },
  { role: 'user', text: '<指示> 帳票を CSV で出したい' },
  { role: 'user', text: '   ' },
];

describe('extractVoiceRecordHandler', () => {
  it('会話の文字起こしから記録を取り出して返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(generateJson).mockResolvedValue({ ...RECORD, title: '  CSV 出力  ' });

    const result = await extractVoiceRecordHandler(
      extractRequest({ title: '', body: '顧客 A', transcript: TRANSCRIPT }),
      makeContext(),
    );

    expect(result.jsonBody).toEqual({ record: RECORD });
    const prompt = vi.mocked(generateJson).mock.calls[0][0];
    expect(prompt.schemaName).toBe('voice_proposal_record');
    expect(prompt.user).toContain('利用者: ＜指示＞ 帳票を CSV で出したい');
    expect(prompt.user).toContain('AI: どんな要望ですか？');
    expect(prompt.user).toContain('顧客 A');
  });

  it('会話がない・形式が違う場合は 400 を返す', async () => {
    for (const transcript of [
      undefined,
      [],
      [{ role: 'user', text: '  ' }],
      [{ role: 'system', text: 'x' }],
      Array.from({ length: 2001 }, () => ({ role: 'user', text: 'x' })),
    ]) {
      const result = await extractVoiceRecordHandler(extractRequest({ transcript }), makeContext());
      expect(result.status).toBe(400);
    }
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('プロダクトがなければ 404 を返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(undefined);
    const result = await extractVoiceRecordHandler(
      extractRequest({ transcript: TRANSCRIPT }),
      makeContext(),
    );
    expect(result.status).toBe(404);
  });

  it('Foundry の失敗と不正な出力は 502 を返し、外部の応答本文を含めない', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(generateJson).mockRejectedValueOnce(new Error('secret detail'));
    const context = makeContext();
    const failed = await extractVoiceRecordHandler(
      extractRequest({ transcript: TRANSCRIPT }),
      context,
    );
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.jsonBody)).not.toContain('secret detail');
    expect(context.error).toHaveBeenCalled();

    vi.mocked(generateJson).mockResolvedValueOnce({ title: 1 });
    const invalid = await extractVoiceRecordHandler(
      extractRequest({ transcript: TRANSCRIPT }),
      makeContext(),
    );
    expect(invalid.status).toBe(502);
  });
});

describe('readTranscript', () => {
  it('同じ話者が続く発言をつなげる', () => {
    expect(
      readTranscript([
        { role: 'user', text: '帳票を' },
        { role: 'user', text: 'CSV で' },
        { role: 'assistant', text: 'はい' },
      ]),
    ).toEqual([
      { role: 'user', text: '帳票をCSV で' },
      { role: 'assistant', text: 'はい' },
    ]);
  });

  it('長い会話は拒否せず、新しい発言を優先して上限に収める', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `発言${i}`,
    }));
    const turns = readTranscript(many) as { text: string }[];
    expect(turns).toHaveLength(MAX_TRANSCRIPT_TURNS);
    expect(turns.at(-1)?.text).toBe('発言249');

    const long = readTranscript([
      { role: 'user', text: 'あ'.repeat(MAX_TRANSCRIPT_CHARS) },
      { role: 'assistant', text: 'まとめです' },
    ]) as { text: string }[];
    expect(long.map((turn) => turn.text.length).reduce((a, b) => a + b)).toBe(MAX_TRANSCRIPT_CHARS);
    expect(long.at(-1)?.text).toBe('まとめです');
  });
});

describe('toProposalRecord', () => {
  it('長さを制限する', () => {
    const record = toProposalRecord({
      ...RECORD,
      title: 'あ'.repeat(300),
      reach: 'い'.repeat(2000),
    });
    expect(record?.title).toHaveLength(200);
    expect(record?.reach).toHaveLength(1000);
  });
});
