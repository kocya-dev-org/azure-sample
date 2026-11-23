// 音声会話のセッション（ADR 0013・0014）。ブラウザーとは HTTP（POST と SSE）、Foundry の GPT-Live とは WebSocket でつなぐ。
// 音声は転送するだけで保存しない。ブラウザーから受け付けるのは音声だけで、session.start は中継だけが送る。
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { buildSessionStart, type UpstreamSocket } from './live';
import { logError, logInfo } from './log';
import type { TicketPayload } from './ticket';

/** ブラウザーへ送るイベント。種類は docs/api.md と src/frontend/src/api/relay.ts と一致させる。 */
export interface RelayEvent {
  event: 'audio' | 'transcript' | 'closed';
  data: unknown;
}

export type CloseReason = 'client' | 'time_limit' | 'idle' | 'upstream_closed' | 'disconnected';

/** SSE を開く前に届いたイベントの上限。 */
const MAX_BACKLOG = 200;

/**
 * 委任（delegation）への応答。この中継は外部の処理をしないので、会話を続けるよう伝える。
 * 委任を待ったまま会話が止まらないようにするため（ADR 0014）。
 */
const DELEGATION_REPLY =
  'この会話では外部の処理や検索はできません。利用者への質問と、聞き取った内容の確認を続けてください。';

/** 中継が扱う必要のない、既知のイベント。知らないイベントとしてログに出さない。 */
const IGNORED_EVENTS = new Set([
  'session.updated',
  'session.thinking.appended',
  'session.commentary.appended',
  'session.instructions.appended',
]);

export interface SessionOptions {
  model: string;
  voice: string;
  readyTimeoutMs: number;
  /** session.close を送ってから session.closed を待つ時間。 */
  closeTimeoutMs: number;
}

/** エラーのイベントか。`"error": null` を持つだけの通常のイベントは、エラーとして扱わない。 */
function isErrorEvent(message: Record<string, unknown>): boolean {
  const type = typeof message.type === 'string' ? message.type : '';
  return (
    type === 'error' ||
    type.endsWith('.error') ||
    (message.error !== null && typeof message.error === 'object')
  );
}

/** 委任の id。文書では位置が明確でないため、最上位と delegation の中の両方を見る。 */
function delegationId(message: Record<string, unknown>): string | undefined {
  if (typeof message.id === 'string') return message.id;
  const nested = message.delegation;
  if (nested && typeof nested === 'object') {
    const { id } = nested as Record<string, unknown>;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

export class RelaySession {
  readonly id = randomUUID();
  readonly key = randomBytes(32).toString('base64url');
  readonly createdAt: number;
  lastActivityAt: number;
  /** close を始めたら true。以降は音声を受け付けない。 */
  closing = false;
  /** 片付けが終わったら true。 */
  closed = false;
  /** Foundry が session.started を返したら解決する。失敗したら拒否する。 */
  readonly ready: Promise<void>;

  private sink: ((event: RelayEvent) => void) | undefined;
  private backlog: RelayEvent[] = [];
  private attached = false;
  private started = false;
  private closeReason: CloseReason = 'client';
  private closeTimer: NodeJS.Timeout | undefined;
  private readonly unknownTypes = new Set<string>();
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly readyTimer: NodeJS.Timeout;

  constructor(
    private readonly socket: UpstreamSocket,
    private readonly ticket: TicketPayload,
    private readonly options: SessionOptions,
    now: number,
    private readonly onClosed: (session: RelaySession) => void,
  ) {
    this.createdAt = now;
    this.lastActivityAt = now;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // 拒否を誰も待っていない場合に、未処理の拒否にしない
    this.ready.catch(() => {});
    this.readyTimer = setTimeout(
      () => this.fail(new Error('Live session did not start in time')),
      options.readyTimeoutMs,
    );
    socket.onOpen(() =>
      this.sendUpstream(
        buildSessionStart({
          model: options.model,
          instructions: ticket.instructions,
          voice: options.voice,
        }),
      ),
    );
    socket.onMessage((text) => this.handleUpstream(text));
    socket.onError((error) => {
      if (this.started) logError('Live socket error', error);
      else this.fail(error);
    });
    socket.onClose(() => {
      if (!this.started) this.fail(new Error('Live socket closed before the session started'));
      else this.finish(this.closing ? this.closeReason : 'upstream_closed');
    });
  }

  get maxSeconds(): number {
    return this.ticket.maxSeconds;
  }

  /** Authorization ヘッダーのセッションキーを、時間に依存しない方法で比べる。 */
  authorize(header: string | undefined): boolean {
    const match = /^Bearer (.+)$/.exec(header ?? '');
    if (!match) return false;
    const actual = Buffer.from(match[1]);
    const expected = Buffer.from(this.key);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  /** SSE をつなぐ。1 セッションにつき 1 本だけ。 */
  attach(sink: (event: RelayEvent) => void): boolean {
    if (this.attached || this.closed) return false;
    this.attached = true;
    this.sink = sink;
    for (const event of this.backlog) sink(event);
    this.backlog = [];
    return true;
  }

  appendAudio(audio: Buffer, now: number): void {
    if (this.closing) return;
    this.lastActivityAt = now;
    this.sendUpstream({ type: 'session.input_audio.append', audio: audio.toString('base64') });
  }

  /**
   * 会話を終える。session.close を送り、session.closed（最後の字幕と usage）を待ってから閉じる。
   * その間に届いた字幕もブラウザーへ送る（終了の直前の AI のまとめを、抽出に含めるため）。
   */
  close(reason: CloseReason): void {
    if (this.closing || this.closed) return;
    this.closing = true;
    this.closeReason = reason;
    if (!this.started) {
      this.finish(reason);
      return;
    }
    this.sendUpstream({ type: 'session.close' });
    this.closeTimer = setTimeout(() => this.finish(reason), this.options.closeTimeoutMs);
  }

  /** 片付けて、ブラウザーに closed を送る。 */
  private finish(reason: CloseReason): void {
    if (this.closed) return;
    this.closing = true;
    this.closed = true;
    clearTimeout(this.readyTimer);
    clearTimeout(this.closeTimer);
    this.emit({ event: 'closed', data: { reason } });
    this.sink = undefined;
    this.socket.close();
    this.onClosed(this);
  }

  private fail(error: Error): void {
    if (this.started || this.closed) return;
    clearTimeout(this.readyTimer);
    this.closing = true;
    this.closed = true;
    this.rejectReady(error);
    this.socket.close();
    this.onClosed(this);
  }

  private sendUpstream(message: Record<string, unknown>): void {
    if (!this.closed) this.socket.send(JSON.stringify(message));
  }

  private emit(event: RelayEvent): void {
    if (this.sink) this.sink(event);
    else if (this.backlog.length < MAX_BACKLOG) this.backlog.push(event);
  }

  private handleUpstream(text: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof message.type === 'string' ? message.type : '';
    if (isErrorEvent(message)) {
      const error = (typeof message.error === 'object' && message.error) || {};
      const detail = {
        type,
        code: (error as Record<string, unknown>).code,
      };
      // 開始が拒否されたら、ブラウザーに失敗を返す
      if (this.started) logError('Live error event', detail);
      else this.fail(Object.assign(new Error('Live session.start was rejected'), detail));
      return;
    }
    switch (type) {
      case 'session.started':
        if (!this.started) {
          this.started = true;
          clearTimeout(this.readyTimer);
          this.resolveReady();
        }
        break;
      case 'session.output_audio.delta':
        if (typeof message.delta === 'string' || typeof message.audio === 'string') {
          this.emit({ event: 'audio', data: { delta: message.delta ?? message.audio } });
        }
        break;
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta':
        if (typeof message.delta === 'string' && message.delta !== '') {
          this.emit({
            event: 'transcript',
            data: {
              role: type === 'session.input_transcript.delta' ? 'user' : 'assistant',
              delta: message.delta,
            },
          });
        }
        break;
      case 'session.delegation.created': {
        const id = delegationId(message);
        if (id) {
          this.sendUpstream({
            type: 'session.thinking.append',
            delegation_id: id,
            content: DELEGATION_REPLY,
          });
        } else if (!this.unknownTypes.has('delegation without id')) {
          this.unknownTypes.add('delegation without id');
          logInfo('Live delegation without id', { keys: Object.keys(message) });
        }
        break;
      }
      case 'session.closed':
        logInfo('Live session closed', {
          reason: message.reason,
          usage: message.usage,
        });
        this.finish(this.closing ? this.closeReason : 'upstream_closed');
        break;
      default:
        // エラーや割り込みのイベント名は文書にないため、種類名だけを 1 回ずつ記録して調べられるようにする
        if (!IGNORED_EVENTS.has(type) && !this.unknownTypes.has(type)) {
          this.unknownTypes.add(type);
          logInfo('Live event not handled', { type });
        }
        break;
    }
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, RelaySession>();

  constructor(
    private readonly options: SessionOptions & {
      maxSessions: number;
      idleSeconds: number;
      connect: () => UpstreamSocket;
    },
  ) {}

  get size(): number {
    return this.sessions.size;
  }

  get full(): boolean {
    return this.sessions.size >= this.options.maxSessions;
  }

  get(id: string): RelaySession | undefined {
    return this.sessions.get(id);
  }

  /** Foundry に接続し、セッションが始まるまで待つ。失敗したら例外を投げる。 */
  async create(ticket: TicketPayload, now: number): Promise<RelaySession> {
    const session = new RelaySession(this.options.connect(), ticket, this.options, now, (closed) =>
      this.sessions.delete(closed.id),
    );
    this.sessions.set(session.id, session);
    await session.ready;
    return session;
  }

  /** 上限時間を過ぎたセッションと、音声が届かなくなったセッションを閉じる。 */
  sweep(now: number): void {
    // Map は反復中に削除しても安全
    for (const session of this.sessions.values()) {
      if (session.closing) continue;
      if (now - session.createdAt >= session.maxSeconds * 1000) {
        session.close('time_limit');
      } else if (now - session.lastActivityAt >= this.options.idleSeconds * 1000) {
        session.close('idle');
      }
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close('client');
  }
}
