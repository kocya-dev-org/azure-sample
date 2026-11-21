// 提案の音声会話の開始。中継（App Service、ADR 0013）を使うためのチケットを発行する。
// 指示文とツールはここで組み立ててチケットに入れ、署名する（中継はプロンプトを持たない）。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { getPrincipal, jsonError, logError, readJsonObject, type JsonObject } from '../lib/http';
import { buildConversationPrompt, RECORD_PROPOSAL_TOOL } from '../lib/prompts';
import { newTicketPayload, signTicket } from '../lib/relayTicket';
import { optionalSetting } from '../lib/settings';
import { getProduct } from '../lib/store';

/** 会話の長さの上限（秒）。中継の帯域（App Service F1 は 1 日 165 MB）を考えて短めにする。 */
export const MAX_CONVERSATION_SECONDS = 300;

/** フォームの現在値。空でもよいので、型と長さだけを確かめる。 */
function readDraft(body: JsonObject | undefined): { title: string; body: string } | string {
  const title = body?.title ?? '';
  const text = body?.body ?? '';
  if (typeof title !== 'string' || title.length > 200)
    return 'タイトルは 200 文字以内にしてください。';
  if (typeof text !== 'string' || text.length > 8000) return '内容は 8000 文字以内にしてください。';
  return { title: title.trim(), body: text.trim() };
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

  let product;
  try {
    product = await getProduct(request.params.productId);
  } catch (error) {
    logError(context, 'Product read failed', error);
    return jsonError(500, 'プロダクトの読み込みに失敗しました。');
  }
  if (!product) return jsonError(404, 'プロダクトが見つかりません。');

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
      tools: [RECORD_PROPOSAL_TOOL],
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

app.http('createVoiceSession', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/voice-sessions',
  handler: createVoiceSessionHandler,
});
