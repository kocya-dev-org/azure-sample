// 提案の判定。RICE に必要な情報がそろっているかの AI コメントをストリームで返す（ADR 0005）。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { streamText } from '../lib/foundry';
import { jsonError, logError, readJsonObject } from '../lib/http';
import { buildReviewPrompt } from '../lib/prompts';
import { parseProposalInput } from '../lib/proposal-input';
import { getProduct } from '../lib/store';

export const STREAM_ERROR_MARKER =
  '\n\n[判定の途中でエラーが発生しました。もう一度お試しください。]';

/**
 * 差分テキストの列を ReadableStream に変換する。
 * 応答を返した後に失敗した場合は状態コードを変えられないため、本文の末尾に固定の文言を付ける。
 */
export function toTextStream(
  first: string,
  rest: AsyncIterator<string>,
  onError: (error: unknown) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        controller.enqueue(encoder.encode(first));
        return;
      }
      try {
        const { done, value } = await rest.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (error) {
        onError(error);
        controller.enqueue(encoder.encode(STREAM_ERROR_MARKER));
        controller.close();
      }
    },
    async cancel() {
      await rest.return?.();
    },
  });
}

export async function reviewProposalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const input = parseProposalInput(await readJsonObject(request));
  if (typeof input === 'string') return jsonError(400, input);

  let product;
  try {
    product = await getProduct(request.params.productId);
  } catch (error) {
    logError(context, 'Product read failed', error);
    return jsonError(500, 'プロダクトの読み込みに失敗しました。');
  }
  if (!product) return jsonError(404, 'プロダクトが見つかりません。');

  const iterator = streamText(
    buildReviewPrompt({
      productName: product.name,
      strategy: product.strategy,
      title: input.title,
      body: input.body,
    }),
  );
  // 最初の差分を受け取るまでに失敗した場合は、状態コードで失敗を返せる
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (error) {
    logError(context, 'Foundry review failed', error);
    return jsonError(502, '生成 AI による判定に失敗しました。');
  }

  return {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
    body: toTextStream(first.done ? '' : first.value, iterator, (error) =>
      logError(context, 'Foundry review stream failed', error),
    ),
  };
}

app.http('reviewProposal', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/proposals/review',
  handler: reviewProposalHandler,
});
