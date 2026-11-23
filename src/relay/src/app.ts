// 中継の HTTP ハンドラー（ADR 0013・0014）。ブラウザーとは HTTPS の POST と SSE だけでやりとりする。
// エラーレスポンスには固定メッセージだけを返し、Foundry の応答内容は含めない。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { originMatcher } from './lib/cors';
import { AUDIO_FORMAT } from './lib/live';
import { logError } from './lib/log';
import type { RelayEvent, SessionManager } from './lib/session';
import type { RelayConfig } from './lib/settings';
import { NonceStore, verifyTicket } from './lib/ticket';

/** チケットの本文の上限。指示文にはフォームの内容（最大 8000 文字）が入る。 */
export const MAX_TICKET_BYTES = 128 * 1024;
/** 音声 1 チャンクの上限。200 ms の PCM16・24 kHz は 9.6 KB。 */
export const MAX_AUDIO_BYTES = 64 * 1024;
/** 会話の長さの上限（秒）。チケットの値をこの範囲に収める。 */
const MAX_SECONDS_RANGE = { min: 30, max: 600 };
const HEARTBEAT_MS = 15_000;

/**
 * SSE の応答ヘッダー。src/api/src/lib/sse.ts と同じく、Azure の前段のプロキシが逐次転送するよう
 * Content-Type は `text/event-stream` だけにする（charset を付けない）。
 */
const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'x-accel-buffering': 'no',
};

class BodyTooLargeError extends Error {}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length']);
    if (declared > limit) {
      reject(new BodyTooLargeError());
      request.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLargeError());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

function sseEvent({ event, data }: RelayEvent): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createRelayHandler(
  config: RelayConfig,
  manager: SessionManager,
  clock: () => number = Date.now,
) {
  const isAllowedOrigin = originMatcher(config.allowedOrigins);
  const nonces = new NonceStore();

  async function createSession(request: IncomingMessage, response: ServerResponse) {
    let ticket: unknown;
    try {
      ticket = (
        JSON.parse((await readBody(request, MAX_TICKET_BYTES)).toString('utf8')) as {
          ticket?: unknown;
        }
      ).ticket;
    } catch (error) {
      if (error instanceof BodyTooLargeError)
        return sendError(response, 413, '本文が大きすぎます。');
      return sendError(response, 400, '有効な JSON を指定してください。');
    }
    if (typeof ticket !== 'string') return sendError(response, 400, 'チケットがありません。');
    const result = verifyTicket(ticket, config.ticketSecret, Math.floor(clock() / 1000), nonces);
    if (!result.ok) {
      return sendError(response, 401, 'チケットが無効です。画面を開き直してください。');
    }
    if (manager.full) {
      return sendError(
        response,
        429,
        '音声会話が混み合っています。しばらくしてからお試しください。',
      );
    }
    const maxSeconds = Math.min(
      Math.max(result.payload.maxSeconds, MAX_SECONDS_RANGE.min),
      MAX_SECONDS_RANGE.max,
    );
    try {
      const session = await manager.create({ ...result.payload, maxSeconds }, clock());
      sendJson(response, 201, {
        sessionId: session.id,
        sessionKey: session.key,
        audioFormat: AUDIO_FORMAT,
        maxSeconds,
      });
    } catch (error) {
      logError('Realtime session setup failed', error);
      sendError(response, 502, '音声会話を開始できませんでした。もう一度お試しください。');
    }
  }

  function streamEvents(
    request: IncomingMessage,
    response: ServerResponse,
    session: NonNullable<ReturnType<SessionManager['get']>>,
  ) {
    response.writeHead(200, SSE_HEADERS);
    // ヘッダーをすぐに送り出すため、最初にコメント行を書く
    response.write(': ok\n\n');
    const heartbeat = setInterval(() => response.write(': ping\n\n'), HEARTBEAT_MS);
    const finish = () => {
      clearInterval(heartbeat);
      if (!response.writableEnded) response.end();
    };
    const attached = session.attach((event) => {
      response.write(sseEvent(event));
      if (event.event === 'closed') finish();
    });
    if (!attached) {
      response.write(sseEvent({ event: 'closed', data: { reason: 'client' } }));
      finish();
      return;
    }
    // ブラウザーが SSE を切ったら、セッションも閉じる
    request.on('close', () => {
      clearInterval(heartbeat);
      session.close('disconnected');
    });
  }

  async function appendAudio(
    request: IncomingMessage,
    response: ServerResponse,
    session: NonNullable<ReturnType<SessionManager['get']>>,
  ) {
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/octet-stream') {
      return sendError(response, 415, '音声は application/octet-stream で送ってください。');
    }
    let audio: Buffer;
    try {
      audio = await readBody(request, MAX_AUDIO_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError)
        return sendError(response, 413, '音声が大きすぎます。');
      return sendError(response, 400, '音声を読み込めませんでした。');
    }
    if (audio.length === 0) return sendError(response, 400, '音声が空です。');
    if (session.closed) return sendError(response, 410, '音声会話は終了しました。');
    session.appendAudio(audio, clock());
    response.writeHead(204);
    response.end();
  }

  return async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://relay');
    const origin = request.headers.origin;
    if (origin) {
      if (!isAllowedOrigin(origin))
        return sendError(response, 403, '許可されていないオリジンです。');
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, DELETE',
        'access-control-allow-headers': 'authorization, content-type',
        // 音声の POST ごとにプリフライトが走らないよう、Chrome の上限（2 時間）までキャッシュさせる
        'access-control-max-age': '7200',
      });
      response.end();
      return;
    }

    try {
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return sendJson(response, 200, { status: 'ok' });
      }
      if (url.pathname === '/sessions' && request.method === 'POST') {
        return await createSession(request, response);
      }
      const match = /^\/sessions\/([0-9a-f-]{36})(\/events|\/audio)?$/.exec(url.pathname);
      if (!match) return sendError(response, 404, '見つかりません。');
      const session = manager.get(match[1]);
      if (!session) return sendError(response, 404, '音声会話が見つかりません。');
      if (!session.authorize(request.headers.authorization)) {
        return sendError(response, 401, '認証に失敗しました。');
      }
      const action = `${request.method} ${match[2] ?? ''}`;
      if (action === 'GET /events') return streamEvents(request, response, session);
      if (action === 'POST /audio') return await appendAudio(request, response, session);
      if (action === 'DELETE ') {
        session.close('client');
        response.writeHead(204);
        response.end();
        return;
      }
      return sendError(response, 405, '対応していない操作です。');
    } catch (error) {
      logError('Relay request failed', error);
      if (!response.headersSent) sendError(response, 500, '中継でエラーが発生しました。');
      else response.end();
    }
  };
}
