// 中継のテスト用ヘルパー（デプロイ対象外）。
import { createHmac } from 'node:crypto';
import type { UpstreamSocket } from '../src/lib/realtime';
import type { TicketPayload } from '../src/lib/ticket';

export const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

export function makePayload(overrides: Partial<TicketPayload> = {}): TicketPayload {
  return {
    v: 1,
    nonce: 'nonce-1',
    exp: 2_000_000_000,
    productId: 'p1',
    userId: 'user-1',
    instructions: 'RICE の情報を聞き出してください。',
    tools: [{ type: 'function', name: 'record_proposal_info', parameters: {} }],
    maxSeconds: 300,
    ...overrides,
  };
}

/** SWA API（src/api/src/lib/relayTicket.ts）と同じ形式でチケットを作る。 */
export function signTicket(payload: TicketPayload, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/** Foundry の WebSocket の代わり。送った内容を記録し、受信や切断を起こせる。 */
export class FakeSocket implements UpstreamSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  private messageListener: ((text: string) => void) | undefined;
  private closeListener: (() => void) | undefined;
  private errorListener: ((error: Error) => void) | undefined;

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
  onMessage(listener: (text: string) => void) {
    this.messageListener = listener;
  }
  onClose(listener: () => void) {
    this.closeListener = listener;
  }
  onError(listener: (error: Error) => void) {
    this.errorListener = listener;
  }

  receive(message: Record<string, unknown>) {
    this.messageListener?.(JSON.stringify(message));
  }
  disconnect() {
    this.closeListener?.();
  }
  fail(error: Error) {
    this.errorListener?.(error);
  }
  sentTypes(): unknown[] {
    return this.sent.map((message) => message.type);
  }
}

/** session.created に session.updated を返す、正常な Foundry の代わり。 */
export class ReadySocket extends FakeSocket {
  override send(data: string) {
    super.send(data);
    const message = JSON.parse(data) as Record<string, unknown>;
    if (message.type === 'session.update') {
      queueMicrotask(() => this.receive({ type: 'session.updated' }));
    }
  }
  start() {
    queueMicrotask(() => this.receive({ type: 'session.created' }));
    return this;
  }
}
