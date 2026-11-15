// ストリーミング検証用の一時エンドポイント（ADR 0005）。検証が終わったら削除する。
import { app, type HttpResponseInit } from '@azure/functions';

const CHUNKS = ['1 秒目\n', '2 秒目\n', '3 秒目\n', '4 秒目\n', '5 秒目\n'];

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

export async function diagStream(): Promise<HttpResponseInit> {
  return {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    body: createChunkStream(CHUNKS, 1000),
  };
}

app.http('diagStream', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'diag/stream',
  handler: diagStream,
});
