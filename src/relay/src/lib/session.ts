// 音声会話のセッション（ADR 0013）。ブラウザーとは HTTP（POST と SSE）、Foundry とは WebSocket でつなぐ。
// 音声は転送するだけで保存しない。ブラウザーから受け付けるのは音声だけで、session.update は中継だけが送る。
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { logError } from './log';
import { buildSessionUpdate, type AudioFormat, type UpstreamSocket } from './realtime';
import type { TicketPayload } from './ticket';

/** ブラウザーへ送るイベント。種類は docs/api.md と src/frontend/src/api/relay.ts と一致させる。 */
export interface RelayEvent {
  event: 'audio' | 'transcript' | 'speech_started' | 'tool_call' | 'closed';
  data: unknown;
}

export type CloseReason = 'client' | 'time_limit' | 'idle' | 'upstream_closed' | 'disconnected';

/** SSE を開く前に届いたイベントの上限。最初の応答は SSE を開いてから作るので、通常はほとんどたまらない。 */
const MAX_BACKLOG = 100;

const FUNCTION_CALL_OUTPUT = JSON.stringify({ ok: true });

export interface SessionOptions {
  audioFormat: AudioFormat;
  transcriptionModel: string | undefined;
  voice: string;
  readyTimeoutMs: number;
}

export class RelaySession {
  readonly id = randomUUID();
  readonly key = randomBytes(32).toString('base64url');
  readonly createdAt: number;
  lastActivityAt: number;
  closed = false;
  /** Foundry が session.updated を返したら解決する。失敗したら拒否する。 */
  readonly ready: Promise<void>;

  private sink: ((event: RelayEvent) => void) | undefined;
  private backlog: RelayEvent[] = [];
  private attached = false;
  private configured = false;
  private pendingCallIds: string[] = [];
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
      () => this.fail(new Error('Realtime session was not configured in time')),
      options.readyTimeoutMs,
    );
    socket.onMessage((text) => this.handleUpstream(text));
    socket.onError((error) => {
      if (this.configured) logError('Realtime socket error', error);
      else this.fail(error);
    });
    socket.onClose(() => {
      if (this.configured) this.close('upstream_closed');
      else this.fail(new Error('Realtime socket closed before configuration'));
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

  /** SSE をつなぐ。1 セッションにつき 1 本だけ。つないだときに AI の最初の発言を作らせる。 */
  attach(sink: (event: RelayEvent) => void): boolean {
    if (this.attached || this.closed) return false;
    this.attached = true;
    this.sink = sink;
    for (const event of this.backlog) sink(event);
    this.backlog = [];
    this.sendUpstream({ type: 'response.create' });
    return true;
  }

  appendAudio(audio: Buffer, now: number): void {
    this.lastActivityAt = now;
    this.sendUpstream({ type: 'input_audio_buffer.append', audio: audio.toString('base64') });
  }

  close(reason: CloseReason): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.readyTimer);
    this.emit({ event: 'closed', data: { reason } });
    this.sink = undefined;
    this.socket.close();
    this.onClosed(this);
  }

  private fail(error: Error): void {
    if (this.configured || this.closed) return;
    clearTimeout(this.readyTimer);
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
    switch (message.type) {
      case 'session.created':
        // 既定のセッション（汎用の人格、ツールなし）のまま会話させないよう、まず設定を送る
        this.sendUpstream(
          buildSessionUpdate({
            instructions: this.ticket.instructions,
            tools: this.ticket.tools,
            audioFormat: this.options.audioFormat,
            transcriptionModel: this.options.transcriptionModel,
            voice: this.options.voice,
          }),
        );
        break;
      case 'session.updated':
        if (!this.configured) {
          this.configured = true;
          clearTimeout(this.readyTimer);
          this.resolveReady();
        }
        break;
      case 'error': {
        const error = (message.error ?? {}) as Record<string, unknown>;
        const detail = { code: error.code, type: error.type };
        // 設定が拒否されたら、既定のセッションのまま続けずに失敗させる
        if (this.configured) logError('Realtime error event', detail);
        else this.fail(Object.assign(new Error('Realtime session.update was rejected'), detail));
        break;
      }
      case 'response.output_audio.delta':
        if (typeof message.delta === 'string') {
          this.emit({ event: 'audio', data: { delta: message.delta } });
        }
        break;
      case 'response.output_audio_transcript.done':
        if (typeof message.transcript === 'string') {
          this.emit({ event: 'transcript', data: { role: 'assistant', text: message.transcript } });
        }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof message.transcript === 'string') {
          this.emit({ event: 'transcript', data: { role: 'user', text: message.transcript } });
        }
        break;
      case 'input_audio_buffer.speech_started':
        this.emit({ event: 'speech_started', data: {} });
        break;
      case 'response.output_item.done': {
        const item = (message.item ?? {}) as Record<string, unknown>;
        if (item.type !== 'function_call' || typeof item.call_id !== 'string') break;
        let args: unknown = {};
        try {
          args = JSON.parse(typeof item.arguments === 'string' ? item.arguments : '{}');
        } catch {
          args = {};
        }
        this.emit({ event: 'tool_call', data: { name: item.name, arguments: args } });
        this.pendingCallIds.push(item.call_id);
        break;
      }
      case 'response.done':
        // 応答中に response.create を送るとエラーになるため、応答が終わってから結果を返して続きを作らせる
        if (this.pendingCallIds.length > 0) {
          for (const callId of this.pendingCallIds) {
            this.sendUpstream({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: callId, output: FUNCTION_CALL_OUTPUT },
            });
          }
          this.pendingCallIds = [];
          this.sendUpstream({ type: 'response.create' });
        }
        break;
      default:
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

  /** Foundry に接続し、設定が反映されるまで待つ。失敗したら例外を投げる。 */
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
