// Server-Sent Events（text/event-stream）の読み取り（ADR 0005）。
// EventSource は POST できないため、fetch の本文を読みながらイベントに分解する。
// イベントの形式は docs/api.md と src/api/src/lib/sse.ts と一致させる。

export interface SseEvent {
  event: string;
  data: unknown;
}

/** 1 件分のテキスト（空行で区切られたブロック）をイベントにする。コメントだけのブロックは null。 */
function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join('\n')) as unknown };
}

/**
 * 本文を読みながら、イベントが 1 件そろうたびに返す。
 * チャンクの境目がイベントや文字の途中にあっても、つなげてから分解する。
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // 末尾の \r は次のチャンクの \n と組になるかもしれないので、次に回してから改行をそろえる
      const keep = !done && pending.endsWith('\r') ? 1 : 0;
      buffer += pending.slice(0, pending.length - keep).replace(/\r\n?/g, '\n');
      pending = pending.slice(pending.length - keep);
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const parsed = parseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (parsed) yield parsed;
      }
      if (done) {
        const parsed = buffer.trim() ? parseBlock(buffer) : null;
        if (parsed) yield parsed;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
