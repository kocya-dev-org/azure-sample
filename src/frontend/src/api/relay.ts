// 音声会話の中継（App Service、ADR 0013）のクライアント。
// WebRTC と WebSocket は使わず、HTTPS の POST と SSE だけでやりとりする。
// イベントの種類は src/relay/src/lib/session.ts と docs/api.md と一致させる。
import type { AudioFormat } from '../audio/pcm';
import { ApiError, toApiError } from './client';
import { readEvents } from './sse';

export interface RelaySession {
  url: string;
  sessionId: string;
  sessionKey: string;
  audioFormat: AudioFormat;
  maxSeconds: number;
}

export type RelayEvent =
  | { event: 'audio'; data: { delta: string } }
  | { event: 'transcript'; data: { role: 'user' | 'assistant'; text: string } }
  | { event: 'speech_started'; data: Record<string, never> }
  | { event: 'tool_call'; data: { name: string; arguments: Record<string, unknown> } }
  | { event: 'closed'; data: { reason: string } };

const CONNECT_ERROR = '音声会話の中継に接続できませんでした。もう一度お試しください。';

async function relayFetch(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(CONNECT_ERROR, 0);
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

const auth = (session: RelaySession) => ({ authorization: `Bearer ${session.sessionKey}` });
const sessionUrl = (session: RelaySession) =>
  `${session.url}/sessions/${encodeURIComponent(session.sessionId)}`;

export async function openRelaySession(url: string, ticket: string): Promise<RelaySession> {
  const response = await relayFetch(`${url}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  const body = (await response.json()) as Omit<RelaySession, 'url'>;
  return { url, ...body };
}

/** 中継のイベントを受け取る。中継が SSE を閉じたら戻る。 */
export async function streamRelayEvents(
  session: RelaySession,
  onEvent: (event: RelayEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await relayFetch(`${sessionUrl(session)}/events`, {
    headers: auth(session),
    signal,
  });
  if (!response.body) throw new ApiError(CONNECT_ERROR, response.status);
  for await (const event of readEvents(response.body)) onEvent(event as RelayEvent);
}

export async function sendRelayAudio(session: RelaySession, bytes: Uint8Array): Promise<void> {
  await relayFetch(`${sessionUrl(session)}/audio`, {
    method: 'POST',
    headers: { ...auth(session), 'content-type': 'application/octet-stream' },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
}

/** セッションを閉じる。画面を離れるときにも届くよう keepalive を付け、失敗は無視する。 */
export function closeRelaySession(session: RelaySession): void {
  fetch(sessionUrl(session), { method: 'DELETE', headers: auth(session), keepalive: true }).catch(
    () => {},
  );
}
