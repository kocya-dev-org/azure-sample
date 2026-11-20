import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CopilotSpaceError,
  extractToolText,
  fetchSpaceContext,
  findRpcResponse,
  MCP_ENDPOINT,
} from '../../src/lib/copilotSpace';

const TOKEN = 'github_pat_test_token_value';

function sse(message: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv('ISSUE_GITHUB_TOKEN', TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('findRpcResponse', () => {
  it('SSE と JSON の両方から id の一致する応答を取り出す', () => {
    const text = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"a":1}}\n\n';
    expect(findRpcResponse('text/event-stream', text, 2)).toMatchObject({ result: { a: 1 } });
    expect(findRpcResponse('text/event-stream', text, 3)).toBeUndefined();
    expect(findRpcResponse('application/json', '{"id":1,"result":{}}', 1)).toEqual({
      id: 1,
      result: {},
    });
    expect(findRpcResponse('application/json', 'not json', 1)).toBeUndefined();
  });
});

describe('extractToolText', () => {
  it('text と埋め込みリソースのテキストをつなげる', () => {
    expect(
      extractToolText({
        content: [
          { type: 'resource', resource: { uri: 'space://x', text: '目次' } },
          { type: 'text', text: '本文' },
          { type: 'image', data: '...' },
        ],
      }),
    ).toBe('目次\n本文');
  });

  it('ツールのエラーやテキストなしは失敗にする', () => {
    expect(() => extractToolText({ isError: true, content: [] })).toThrow(CopilotSpaceError);
    expect(() => extractToolText({ content: [] })).toThrow(CopilotSpaceError);
    expect(() => extractToolText(undefined)).toThrow(CopilotSpaceError);
  });
});

describe('fetchSpaceContext', () => {
  it('initialize の後に get_copilot_space を呼び、Space の内容を返す', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (body.method === 'initialize') {
        return sse({ jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': 's1' });
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return sse({
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'resource', resource: { text: 'Space の内容' } }] },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const text = await fetchSpaceContext(new AbortController().signal);

    expect(text).toBe('Space の内容');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe(MCP_ENDPOINT);
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Mcp-Session-Id': 's1',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'get_copilot_space',
        arguments: { owner: 'kocya-dev-org', name: 'spaces-azure-sample' },
      },
    });
  });

  it('トークンが未設定なら呼び出さない', async () => {
    vi.stubEnv('ISSUE_GITHUB_TOKEN', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const error = await fetchSpaceContext(new AbortController().signal).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CopilotSpaceError);
    expect((error as CopilotSpaceError).reason).toBe('no-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP の失敗は状態コードだけを持つエラーにする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response('{"message":"Bad credentials"}', { status: 401 }),
      ),
    );

    const error = await fetchSpaceContext(new AbortController().signal).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CopilotSpaceError);
    expect((error as CopilotSpaceError).status).toBe(401);
    expect(String(error)).not.toContain('Bad credentials');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('JSON-RPC のエラー応答は失敗にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        sse({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } }),
      ),
    );

    const error = await fetchSpaceContext(new AbortController().signal).catch((e: unknown) => e);

    expect((error as CopilotSpaceError).reason).toBe('protocol');
  });
});
