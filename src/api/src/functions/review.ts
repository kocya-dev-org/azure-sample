// 提案の判定。RICE に必要な情報がそろっているかの AI コメントを SSE（text/event-stream）で返す（ADR 0005）。
// 並行して提案が実装済みかを確認し、コメントの後に implementation イベントで返す（ADR 0012）。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { streamText } from '../lib/foundry';
import { jsonError, logError, readJsonObject } from '../lib/http';
import { checkImplementation, type ImplementationResult } from '../lib/implementationCheck';
import { buildReviewPrompt } from '../lib/prompts';
import { parseProposalInput } from '../lib/proposal-input';
import { SSE_HEADERS, sseEvent } from '../lib/sse';
import { getProduct } from '../lib/store';

export const STREAM_ERROR_MESSAGE = '判定の途中でエラーが発生しました。もう一度お試しください。';

/**
 * 差分テキストの列を SSE（text/event-stream）の ReadableStream に変換する。
 * 差分ごとに delta、終わったら（implementation があればその結果を待って implementation を送ってから）done を送る。
 * 応答を返した後に失敗した場合は状態コードを変えられないため、error イベントで知らせて閉じる。
 * implementation は失敗しない Promise とする（失敗時は unknown の結果になる）。
 */
export function toEventStream(
  first: string,
  rest: AsyncIterator<string>,
  onError: (error: unknown) => void,
  implementation?: { result: Promise<ImplementationResult>; abort: () => void },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) =>
    controller.enqueue(encoder.encode(text));
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        send(controller, sseEvent('delta', { text: first }));
        return;
      }
      try {
        const { done, value } = await rest.next();
        if (done) {
          if (implementation) {
            send(controller, sseEvent('implementation', await implementation.result));
          }
          send(controller, sseEvent('done', {}));
          controller.close();
          return;
        }
        send(controller, sseEvent('delta', { text: value }));
      } catch (error) {
        implementation?.abort();
        onError(error);
        send(controller, sseEvent('error', { message: STREAM_ERROR_MESSAGE }));
        controller.close();
      }
    },
    async cancel() {
      implementation?.abort();
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

  const promptInput = {
    productName: product.name,
    strategy: product.strategy,
    title: input.title,
    body: input.body,
  };
  // 実装状況の確認は、コメントの生成と並行して始める
  const checkController = new AbortController();
  const implementation = {
    result: checkImplementation(promptInput, checkController.signal, (error) =>
      logError(context, 'Implementation check failed', error),
    ),
    abort: () => checkController.abort(),
  };
  const iterator = streamText(buildReviewPrompt(promptInput));
  // 最初の差分を受け取るまでに失敗した場合は、状態コードで失敗を返せる
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (error) {
    implementation.abort();
    logError(context, 'Foundry review failed', error);
    return jsonError(502, '生成 AI による判定に失敗しました。');
  }
  // 推論だけで出力上限に達するなど、コメントが 1 文字も返らなかった場合も失敗として扱う
  if (first.done) {
    implementation.abort();
    context.warn('Foundry review returned no text');
    return jsonError(502, '生成 AI による判定に失敗しました。');
  }

  return {
    headers: SSE_HEADERS,
    body: toEventStream(
      first.value,
      iterator,
      (error) => logError(context, 'Foundry review stream failed', error),
      implementation,
    ),
  };
}

app.http('reviewProposal', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/proposals/review',
  handler: reviewProposalHandler,
});
