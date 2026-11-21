// 中継を使うためのチケットの検証（ADR 0013）。
// 発行は SWA API（src/api/src/lib/relayTicket.ts）で、形式は base64url(payload).base64url(HMAC-SHA256(payload 部分))。
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TicketPayload {
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

export type TicketResult =
  | { ok: true; payload: TicketPayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'reused' };

/** 使用済みの nonce。期限が過ぎたものは捨てる（インスタンスは 1 つなのでメモリーで足りる）。 */
export class NonceStore {
  private readonly used = new Map<string, number>();

  /** 未使用なら記録して true を返す。 */
  claim(nonce: string, exp: number, nowSeconds: number): boolean {
    for (const [key, keyExp] of this.used) {
      if (keyExp < nowSeconds) this.used.delete(key);
    }
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, exp);
    return true;
  }
}

function isPayload(value: unknown): value is TicketPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.nonce === 'string' &&
    p.nonce !== '' &&
    typeof p.exp === 'number' &&
    typeof p.productId === 'string' &&
    typeof p.userId === 'string' &&
    typeof p.instructions === 'string' &&
    Array.isArray(p.tools) &&
    typeof p.maxSeconds === 'number'
  );
}

export function verifyTicket(
  ticket: string,
  secret: string,
  nowSeconds: number,
  nonces: NonceStore,
): TicketResult {
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, signature] = parts;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: 'signature' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isPayload(payload)) return { ok: false, reason: 'malformed' };
  if (payload.exp < nowSeconds) return { ok: false, reason: 'expired' };
  if (!nonces.claim(payload.nonce, payload.exp, nowSeconds)) return { ok: false, reason: 'reused' };
  return { ok: true, payload };
}
