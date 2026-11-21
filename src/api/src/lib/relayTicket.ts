// 音声会話の中継（App Service、ADR 0013）を使うためのチケットの署名。
// 形式は base64url(payload).base64url(HMAC-SHA256(payload 部分))。検証は src/relay/src/lib/ticket.ts。
// 形式を変えるときは、両方のテストのテストベクターを合わせて変える。
import { createHmac, randomUUID } from 'node:crypto';

export interface RelayTicketPayload {
  v: 1;
  nonce: string;
  /** 有効期限（UNIX 秒）。 */
  exp: number;
  productId: string;
  userId: string;
  instructions: string;
  tools: unknown[];
  maxSeconds: number;
}

/**
 * チケットの有効期間（秒）。中継（App Service F1）はアイドル時にアンロードされ、
 * コールドスタートに時間がかかるため、余裕を持たせる。使い回しは nonce で防ぐ。
 */
export const TICKET_TTL_SECONDS = 300;

export function signTicket(payload: RelayTicketPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function newTicketPayload(
  fields: Omit<RelayTicketPayload, 'v' | 'nonce' | 'exp'>,
  nowSeconds: number,
): RelayTicketPayload {
  return { v: 1, nonce: randomUUID(), exp: nowSeconds + TICKET_TTL_SECONDS, ...fields };
}
