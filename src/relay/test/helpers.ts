// 中継のテスト用ヘルパー（デプロイ対象外）。
import { createHmac } from 'node:crypto';
import type { UpstreamSocket } from '../src/lib/live';
import type { TicketPayload } from '../src/lib/ticket';

export const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

export function makePayload(overrides: Partial<TicketPayload> = {}): TicketPayload {
  return {
    v: 2,
    nonce: 'nonce-1',
    exp: 2_000_000_000,
    productId: 'p1',
    userId: 'user-1',
    instructions: 'RICE の情報を聞き出してください。',
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

/** Foundry の WebSocket の代わり。送った内容を記録し、接続・受信・切断を起こせる。 */
export class FakeSocket implements UpstreamSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  private openListener: (() => void) | undefined;
  private messageListener: ((text: string) => void) | undefined;
  private closeListener: (() => void) | undefined;
  private errorListener: ((error: Error) => void) | undefined;

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
  onOpen(listener: () => void) {
    this.openListener = listener;
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

  open() {
    this.openListener?.();
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

/** session.start に session.started、session.close に session.closed を返す、正常な GPT-Live の代わり。 */
export class ReadySocket extends FakeSocket {
  override send(data: string) {
    super.send(data);
    const message = JSON.parse(data) as Record<string, unknown>;
    if (message.type === 'session.start') {
      queueMicrotask(() => this.receive({ type: 'session.started' }));
    } else if (message.type === 'session.close') {
      queueMicrotask(() =>
        this.receive({ type: 'session.closed', reason: 'client', usage: { audio_seconds: 1 } }),
      );
    }
  }
  start() {
    queueMicrotask(() => this.open());
    return this;
  }
}
