// ストリーミング検証用の一時エンドポイント（ADR 0005）。検証が終わったら削除する。
// 既定は text/plain、?format=sse なら同じ内容を SSE（text/event-stream）で返し、SWA 上での届き方を比べる。
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { SSE_HEADERS, SSE_PADDING, sseEvent } from '../lib/sse';

const LINES = ['1 秒目\n', '2 秒目\n', '3 秒目\n', '4 秒目\n', '5 秒目\n'];

export function createChunkStream(
  chunks: readonly string[],
  intervalMs: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

/** SSE 形式のチャンク列。最初のチャンクにパディングを付け、最後に done を送る。 */
export function sseChunks(lines: readonly string[]): string[] {
  const events = lines.map((text) => sseEvent('delta', { text }));
  events[0] = SSE_PADDING + events[0];
  return [...events, sseEvent('done', {})];
}

export async function diagStream(request: HttpRequest): Promise<HttpResponseInit> {
  if (request.query.get('format') === 'sse') {
    return { headers: SSE_HEADERS, body: createChunkStream(sseChunks(LINES), 1000) };
  }
  return {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    body: createChunkStream(LINES, 1000),
  };
}

app.http('diagStream', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'diag/stream',
  handler: diagStream,
});
