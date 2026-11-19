// Server-Sent Events（text/event-stream）の組み立て（ADR 0005）。
// イベントの形式は docs/api.md と src/frontend/src/api/sse.ts と一致させる。

/**
 * SSE の応答ヘッダー。
 * Azure の前段のプロキシは Content-Type が `text/event-stream` と完全に一致するときだけ
 * 逐次転送するとみられるため、charset などは付けない（SSE は仕様上 UTF-8 固定）。
 * ほかのヘッダーも、逐次届いた事例（ADR 0005）と同じものだけにする。
 */
export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'x-accel-buffering': 'no',
};

/** 1 件のイベントを作る。data は JSON にするので、改行を含む値でも 1 行に収まる。 */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
