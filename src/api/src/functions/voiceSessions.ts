// 提案の音声会話（ADR 0013・0014）。
// - 開始: 中継（App Service）を使うためのチケットを発行する。指示文はここで組み立ててチケットに入れ、署名する（中継はプロンプトを持たない）。
// - 抽出: 会話の文字起こしから、提案の記録（タイトルと RICE の項目）を取り出す。会話の記録は保存しない。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { generateJson } from '../lib/foundry';
import { withAuth } from '../lib/auth';
import { getPrincipal, jsonError, logError, readJsonObject, type JsonObject } from '../lib/http';
import {
  buildConversationPrompt,
  buildRecordExtractionPrompt,
  RECORD_EXTRACTION_SCHEMA,
  type ConversationTurn,
} from '../lib/prompts';
import { newTicketPayload, signTicket } from '../lib/relayTicket';
import { optionalSetting } from '../lib/settings';
import { getProduct } from '../lib/store';
import type { Product } from '../lib/types';

/** 会話の長さの上限（秒）。中継の帯域（App Service F1 は 1 日 165 MB）を考えて短めにする。 */
export const MAX_CONVERSATION_SECONDS = 300;
/** 抽出に渡す会話の上限。5 分の会話の文字起こしに余裕を持たせた値。 */
export const MAX_TRANSCRIPT_CHARS = 20_000;
/** 抽出に使う発言の数の上限。超えた分は古いものから捨てる（全二重では話者が細かく入れ替わるため）。 */
export const MAX_TRANSCRIPT_TURNS = 200;
/** 受け付ける要素の数の上限。これを超える本文は不正として拒否する。 */
const MAX_TRANSCRIPT_ITEMS = 2000;
/** 抽出結果の各項目の上限（文字数）。 */
const RECORD_FIELD_MAX = 1000;
const RECORD_TITLE_MAX = 200;

const RECORD_KEYS = ['title', 'summary', 'reach', 'impact', 'confidence', 'effort'] as const;
export type ProposalRecord = Record<(typeof RECORD_KEYS)[number], string>;

/** フォームの現在値。空でもよいので、型と長さだけを確かめる。 */
function readDraft(body: JsonObject | undefined): { title: string; body: string } | string {
  const title = body?.title ?? '';
  const text = body?.body ?? '';
  if (typeof title !== 'string' || title.length > 200)
    return 'タイトルは 200 文字以内にしてください。';
  if (typeof text !== 'string' || text.length > 8000) return '内容は 8000 文字以内にしてください。';
  return { title: title.trim(), body: text.trim() };
}

/**
 * 会話の文字起こしを検証し、抽出に使える形にそろえる。
 * 空の発言は捨て、同じ話者が続く発言はつなげる。長すぎる会話は拒否せず、新しい発言を優先して上限に収める
 * （終了の直前に AI が 4 要素を読み上げるため、後ろの発言ほど大事）。
 */
export function readTranscript(value: unknown): ConversationTurn[] | string {
  if (!Array.isArray(value)) return '会話の記録がありません。';
  if (value.length > MAX_TRANSCRIPT_ITEMS) return '会話の記録の形式が正しくありません。';
  const turns: ConversationTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return '会話の記録の形式が正しくありません。';
    const { role, text } = item as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') {
      return '会話の記録の形式が正しくありません。';
    }
    const trimmed = text.trim();
    if (!trimmed) continue;
    const last = turns.at(-1);
    if (last?.role === role) last.text = `${last.text}${trimmed}`;
    else turns.push({ role, text: trimmed });
  }
  if (turns.length === 0) return '会話の記録がありません。';
  const kept: ConversationTurn[] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0 && kept.length < MAX_TRANSCRIPT_TURNS; i -= 1) {
    const room = MAX_TRANSCRIPT_CHARS - total;
    if (room <= 0) break;
    const text = turns[i].text.length > room ? turns[i].text.slice(-room) : turns[i].text;
    kept.unshift({ role: turns[i].role, text });
    total += text.length;
  }
  return kept;
}

/** 抽出結果を検証する。前後の空白を除いて長さを制限する。形が違えば undefined。 */
export function toProposalRecord(raw: unknown): ProposalRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const fields = raw as Record<string, unknown>;
  const record = {} as ProposalRecord;
  for (const key of RECORD_KEYS) {
    const value = fields[key];
    if (typeof value !== 'string') return undefined;
    record[key] = value.trim().slice(0, key === 'title' ? RECORD_TITLE_MAX : RECORD_FIELD_MAX);
  }
  return record;
}

async function readProduct(
  request: HttpRequest,
  context: InvocationContext,
): Promise<Product | HttpResponseInit> {
  try {
    const product = await getProduct(request.params.productId);
    return product ?? jsonError(404, 'プロダクトが見つかりません。');
  } catch (error) {
    logError(context, 'Product read failed', error);
    return jsonError(500, 'プロダクトの読み込みに失敗しました。');
  }
}

function isProduct(value: Product | HttpResponseInit): value is Product {
  return 'id' in value && 'strategy' in value;
}

export async function createVoiceSessionHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const relayUrl = optionalSetting('REALTIME_RELAY_URL');
  const secret = optionalSetting('REALTIME_TICKET_SECRET');
  if (!relayUrl || !secret) return jsonError(503, '音声会話は現在利用できません。');

  const draft = readDraft(await readJsonObject(request));
  if (typeof draft === 'string') return jsonError(400, draft);

  const product = await readProduct(request, context);
  if (!isProduct(product)) return product;

  const payload = newTicketPayload(
    {
      productId: product.id,
      userId: getPrincipal(request).userId,
      instructions: buildConversationPrompt({
        productName: product.name,
        strategy: product.strategy,
        title: draft.title,
        body: draft.body,
      }),
      maxSeconds: MAX_CONVERSATION_SECONDS,
    },
    Math.floor(Date.now() / 1000),
  );
  return {
    jsonBody: {
      relayUrl: relayUrl.replace(/\/+$/, ''),
      ticket: signTicket(payload, secret),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      maxSeconds: MAX_CONVERSATION_SECONDS,
    },
  };
}

export async function extractVoiceRecordHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const body = await readJsonObject(request);
  const draft = readDraft(body);
  if (typeof draft === 'string') return jsonError(400, draft);
  const transcript = readTranscript(body?.transcript);
  if (typeof transcript === 'string') return jsonError(400, transcript);

  const product = await readProduct(request, context);
  if (!isProduct(product)) return product;

  let record: ProposalRecord | undefined;
  try {
    const raw = await generateJson({
      ...buildRecordExtractionPrompt(
        {
          productName: product.name,
          strategy: product.strategy,
          title: draft.title,
          body: draft.body,
        },
        transcript,
      ),
      schemaName: 'voice_proposal_record',
      schema: RECORD_EXTRACTION_SCHEMA,
    });
    record = toProposalRecord(raw);
  } catch (error) {
    logError(context, 'Voice record extraction failed', error);
    return jsonError(502, '会話の内容をまとめられませんでした。もう一度お試しください。');
  }
  if (!record) {
    context.warn('Voice record extraction returned an invalid result');
    return jsonError(502, '会話の内容をまとめられませんでした。もう一度お試しください。');
  }
  return { jsonBody: { record } };
}

app.http('createVoiceSession', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/voice-sessions',
  handler: withAuth(createVoiceSessionHandler),
});

app.http('extractVoiceRecord', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/voice-sessions/extract',
  handler: withAuth(extractVoiceRecordHandler),
});
