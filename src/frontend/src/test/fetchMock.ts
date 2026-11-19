// テスト用の fetch モック。"GET /api/products" のようなキーで応答を定義する。
import { vi } from 'vitest';

export type RouteHandler = (body: unknown) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** 文字列の配列を、そのままのチャンクに分けて返す SSE 応答。境目を指定したいテストで使う。 */
export function rawStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
}

/** 判定 API と同じ形式の SSE 応答。パディングのコメント行から始まり、イベントごとに 1 チャンクで返す。 */
export function eventStream(events: { event: string; data: unknown }[]): Response {
  return rawStream([
    ': padding\n\n',
    ...events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  ]);
}

/** delta イベントの列と、最後の done を返す SSE 応答。 */
export function deltaStream(texts: string[]): Response {
  return eventStream([
    ...texts.map((text) => ({ event: 'delta', data: { text } })),
    { event: 'done', data: {} },
  ]);
}

export function mockFetch(routes: Record<string, RouteHandler | unknown>) {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
    async (input, init) => {
      const method = init?.method ?? 'GET';
      const key = `${method} ${input}`;
      if (!(key in routes)) return json({ error: `未定義のルート: ${key}` }, 404);
      const route = routes[key];
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      return typeof route === 'function' ? (route as RouteHandler)(body) : json(route);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const PRODUCT = {
  id: 'p1',
  name: '製品A',
  strategy: '中小企業の業務効率化',
  repository: 'org/repo',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

export function selectProductInStorage(id: string): void {
  window.localStorage.setItem('flyingfish.selectedProductId', id);
}
