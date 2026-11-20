// GitHub MCP サーバー（Copilot Spaces ツール）から Space の内容を取得する（ADR 0012）。
// MCP の Streamable HTTP を fetch で最小限だけ実装する（initialize → initialized → tools/call）。
// トークンはサーバー側でだけ使い、レスポンスやログにはトークンも GitHub の応答本文も含めない。
import { optionalSetting } from './settings';

export const COPILOT_SPACE = { owner: 'kocya-dev-org', name: 'spaces-azure-sample' } as const;
export const MCP_ENDPOINT = 'https://api.githubcopilot.com/mcp/x/copilot_spaces/readonly';
const TOKEN_SETTING = 'ISSUE_GITHUB_TOKEN';
const PROTOCOL_VERSION = '2025-06-18';

/** 失敗の種類だけを持つエラー。応答本文は持たない。 */
export class CopilotSpaceError extends Error {
  constructor(
    readonly reason: 'no-token' | 'http' | 'protocol' | 'tool' | 'empty',
    readonly status = 0,
  ) {
    super(`Copilot Space request failed: ${reason}${status ? ` (status ${status})` : ''}.`);
    this.name = 'CopilotSpaceError';
  }
}

interface JsonRpcResponse {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

/** 応答本文（JSON または SSE）から、指定した id の JSON-RPC 応答を取り出す。 */
export function findRpcResponse(
  contentType: string | null,
  text: string,
  id: number,
): JsonRpcResponse | undefined {
  const candidates: string[] = [];
  if (contentType?.includes('text/event-stream')) {
    for (const block of text.replace(/\r\n?/g, '\n').split('\n\n')) {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''));
      if (data.length > 0) candidates.push(data.join('\n'));
    }
  } else {
    candidates.push(text);
  }
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) {
      if (message && typeof message === 'object' && (message as JsonRpcResponse).id === id) {
        return message as JsonRpcResponse;
      }
    }
  }
  return undefined;
}

/** tools/call の結果からテキストを取り出す（text と、埋め込みリソースの text）。 */
export function extractToolText(result: unknown): string {
  if (!result || typeof result !== 'object') throw new CopilotSpaceError('protocol');
  const { content, isError } = result as { content?: unknown; isError?: unknown };
  if (isError === true) throw new CopilotSpaceError('tool');
  if (!Array.isArray(content)) throw new CopilotSpaceError('protocol');
  const texts: string[] = [];
  for (const item of content as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { type, text, resource } = item as { type?: unknown; text?: unknown; resource?: unknown };
    if (type === 'text' && typeof text === 'string') texts.push(text);
    if (type === 'resource' && resource && typeof resource === 'object') {
      const resourceText = (resource as { text?: unknown }).text;
      if (typeof resourceText === 'string') texts.push(resourceText);
    }
  }
  const joined = texts.join('\n').trim();
  if (!joined) throw new CopilotSpaceError('empty');
  return joined;
}

/** Copilot Space の内容（目次と各ドキュメント）をテキストで返す。 */
export async function fetchSpaceContext(signal: AbortSignal): Promise<string> {
  const token = optionalSetting(TOKEN_SETTING);
  if (!token) throw new CopilotSpaceError('no-token');
  let sessionId: string | undefined;

  async function post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'flyingfish',
    };
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
      headers['MCP-Protocol-Version'] = PROTOCOL_VERSION;
    }
    const response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new CopilotSpaceError('http', response.status);
    }
    return response;
  }

  async function call(id: number, method: string, params: unknown): Promise<unknown> {
    const response = await post({ jsonrpc: '2.0', id, method, params });
    sessionId ??= response.headers.get('mcp-session-id') ?? undefined;
    const message = findRpcResponse(
      response.headers.get('content-type'),
      await response.text(),
      id,
    );
    if (!message || message.error !== undefined) throw new CopilotSpaceError('protocol');
    return message.result;
  }

  await call(1, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'flyingfish', version: '1.0.0' },
  });
  const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await notified.body?.cancel().catch(() => undefined);
  const result = await call(2, 'tools/call', {
    name: 'get_copilot_space',
    arguments: { owner: COPILOT_SPACE.owner, name: COPILOT_SPACE.name },
  });
  return extractToolText(result);
}
