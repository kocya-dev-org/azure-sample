// ストリーミング検証用の一時エンドポイント（ADR 0005）。検証が終わったら削除する。
// SWA の経路でチャンクが逐次届かない原因を切り分けるため、形式・パディング・件数・間隔・
// ストリームの実装・content-encoding をクエリで切り替えられるようにしている。
import { Readable } from 'node:stream';
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { SSE_HEADERS, sseEvent } from '../lib/sse';

export interface DiagOptions {
  format: 'plain' | 'sse';
  pad: number;
  count: number;
  interval: number;
  impl: 'web' | 'node';
  identity: boolean;
}

/** 整数として読み、範囲外や不正な値は既定値にする。 */
function readInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return number >= min && number <= max ? number : fallback;
}

/** クエリを解釈する。検証用なので、不正な値は 400 にせず既定値に丸める。 */
export function parseDiagOptions(query: URLSearchParams): DiagOptions {
  const format = query.get('format') === 'sse' ? 'sse' : 'plain';
  return {
    format,
    pad: readInt(query.get('pad'), format === 'sse' ? 2048 : 0, 0, 65536),
    count: readInt(query.get('count'), 5, 1, 50),
    interval: readInt(query.get('interval'), 1000, 100, 5000),
    impl: query.get('impl') === 'node' ? 'node' : 'web',
    identity: query.get('identity') === '1',
  };
}

/** 指定したバイト数のパディング。SSE はコメント行、plain は空白と改行にする。 */
export function padding(format: DiagOptions['format'], bytes: number): string {
  if (bytes === 0) return '';
  if (format === 'sse') return `: ${' '.repeat(Math.max(0, bytes - 4))}\n\n`;
  return `${' '.repeat(Math.max(0, bytes - 1))}\n`;
}

/** 1 件分のチャンク。本文にはサーバーで送った時点の経過ミリ秒を入れる。 */
function chunk(format: DiagOptions['format'], index: number, elapsedMs: number): string {
  const text = `${index + 1} 件目（サーバー ${elapsedMs} ms）\n`;
  return format === 'sse' ? sseEvent('delta', { text }) : text;
}

/** チャンクを interval ごとに返す。最初のチャンクの前にパディング、SSE なら最後に done を付ける。 */
export async function* diagChunks(
  options: DiagOptions,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = Date.now,
): AsyncGenerator<string> {
  const start = now();
  for (let index = 0; index < options.count; index += 1) {
    if (index > 0) await sleep(options.interval);
    const body = chunk(options.format, index, now() - start);
    yield index === 0 ? padding(options.format, options.pad) + body : body;
  }
  if (options.format === 'sse') {
    await sleep(options.interval);
    yield sseEvent('done', {});
  }
}

/** 文字列の列を Web 標準の ReadableStream にする。 */
function toWebStream(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

/** 文字列の列を Node.js の Readable にする（記事などの例と同じ実装）。 */
function toNodeStream(chunks: AsyncGenerator<string>): Readable {
  return Readable.from(
    (async function* () {
      for await (const value of chunks) yield Buffer.from(value, 'utf8');
    })(),
  );
}

export function diagHeaders(options: DiagOptions): Record<string, string> {
  const headers: Record<string, string> =
    options.format === 'sse'
      ? { ...SSE_HEADERS }
      : { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
  return options.identity ? { ...headers, 'content-encoding': 'identity' } : headers;
}

export async function diagStream(request: HttpRequest): Promise<HttpResponseInit> {
  const options = parseDiagOptions(request.query);
  const chunks = diagChunks(options);
  return {
    headers: diagHeaders(options),
    body: options.impl === 'node' ? toNodeStream(chunks) : toWebStream(chunks),
  };
}

app.http('diagStream', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'diag/stream',
  handler: diagStream,
});
