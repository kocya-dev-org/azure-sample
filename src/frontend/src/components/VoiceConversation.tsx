// 提案の音声会話（ADR 0013・0014）。GPT-Live（全二重）と話しながら RICE の算出に必要な情報を聞き出してもらい、
// 終了したら会話の文字起こしから記録を取り出して（API の抽出）、フォームに反映する。音声と会話の記録はどこにも保存しない。
// 中継（App Service）とは HTTPS の POST と SSE だけでやりとりする（WebRTC と WebSocket は使わない）。
import { AudioLinesIcon, HeadphonesIcon, Loader2Icon, SquareIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createVoiceSession,
  errorMessage,
  extractVoiceRecord,
  type ProposalInput,
} from '../api/client';
import {
  closeRelaySession,
  openRelaySession,
  sendRelayAudio,
  streamRelayEvents,
  type RelayEvent,
  type RelaySession,
} from '../api/relay';
import { startCapture, type Capture } from '../audio/capture';
import { AudioPlayer } from '../audio/player';

/** 会話から取り出す記録。名前は API の抽出結果（src/api/src/functions/voiceSessions.ts）と一致させる。 */
export interface ProposalRecord {
  title?: string;
  summary?: string;
  reach?: string;
  impact?: string;
  confidence?: string;
  effort?: string;
}

const RECORD_FIELDS = [
  ['summary', '概要'],
  ['reach', 'Reach（対象ユーザー数）'],
  ['impact', 'Impact（効果）'],
  ['confidence', 'Confidence（確度）'],
  ['effort', 'Effort（工数）'],
] as const;

const RECORD_KEYS = ['title', ...RECORD_FIELDS.map(([key]) => key)] as const;

/** 記録を「内容」に追記する文にする。タイトルは含めない。 */
export function formatRecord(record: ProposalRecord): string {
  return RECORD_FIELDS.filter(([key]) => record[key])
    .map(([key, label]) => (key === 'summary' ? record[key]! : `【${label}】${record[key]}`))
    .join('\n');
}

function hasContent(record: ProposalRecord): boolean {
  return RECORD_KEYS.some((key) => record[key]);
}

export function isConversationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.AudioContext === 'function' &&
    typeof window.AudioWorkletNode === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** 中継がセッションを閉じた理由ごとの表示。undefined なら何も表示しない。 */
function closeMessage(reason: string | undefined): string | undefined {
  if (reason === 'client' || reason === 'time_limit') return undefined;
  if (reason === 'idle') return '音声が届かなくなったため、音声会話を終了しました。';
  if (reason === 'upstream_closed') return 'AI との接続が切れたため、音声会話を終了しました。';
  return '音声会話が切断されました。';
}

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type State = 'idle' | 'connecting' | 'talking' | 'extracting';

export interface Caption {
  role: 'user' | 'assistant';
  text: string;
}

/** 表示する字幕の数。古いものから消す。 */
const MAX_CAPTIONS = 6;
/** 抽出に送る会話の上限（文字数と発言の数）。API の上限と同じ。 */
export const MAX_TRANSCRIPT_CHARS = 20_000;
export const MAX_TRANSCRIPT_TURNS = 200;
/** 「終了」を押してから、中継の closed（終了直前の字幕）を待つ時間。 */
const CLOSE_WAIT_MS = 3000;

/**
 * 字幕の断片を会話に足す。同じ話者の断片は直前の発言につなげる。
 * 文字数の上限を超えた分は捨てる。発言の数が上限を超えたら、古い発言から捨てる（終了の直前のまとめを残すため）。
 */
export function appendTranscript(
  turns: Caption[],
  role: Caption['role'],
  delta: string,
  limit = MAX_TRANSCRIPT_CHARS,
): Caption[] {
  const total = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  const text = delta.slice(0, Math.max(0, limit - total));
  if (!text) return turns;
  const last = turns.at(-1);
  if (last?.role === role) return [...turns.slice(0, -1), { role, text: last.text + text }];
  return [...turns, { role, text }].slice(-MAX_TRANSCRIPT_TURNS);
}

/** 1 回の会話で使うもの。終了時にまとめて片付ける。 */
interface Run {
  context: AudioContext;
  stream?: MediaStream;
  session?: RelaySession;
  player?: AudioPlayer;
  capture?: Capture;
  abort?: AbortController;
  /** 中継の SSE が終わったら解決する。 */
  events?: Promise<void>;
  timer?: number;
  sending: Promise<void>;
  closeReason?: string;
  /** 終了を始めたら true。 */
  stopping: boolean;
  /** 片付けが終わったら true。 */
  finished: boolean;
}

export function useVoiceConversation(props: {
  productId: string;
  getDraft: () => ProposalInput;
  onFinish: (record: ProposalRecord) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  const [maxSeconds, setMaxSeconds] = useState(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const transcriptRef = useRef<Caption[]>([]);
  const runRef = useRef<Run | undefined>(undefined);
  const unmountedRef = useRef(false);
  // 親の再描画で変わる関数は、最新のものを参照する
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  function changeState(next: State) {
    setState(next);
    propsRef.current.onBusyChange(next !== 'idle');
  }

  /** マイク・再生・タイマーを止める。 */
  function stopMedia(run: Run) {
    window.clearInterval(run.timer);
    run.capture?.stop();
    run.player?.stop();
    run.stream?.getTracks().forEach((track) => track.stop());
  }

  /** 片付けて、会話があれば記録を取り出してフォームに反映する。何度呼んでもよい。 */
  async function complete(run: Run, message?: string) {
    if (run.finished) return;
    run.finished = true;
    run.stopping = true;
    stopMedia(run);
    run.abort?.abort();
    if (run.session && !run.closeReason) closeRelaySession(run.session);
    void run.context.close().catch(() => {});
    if (runRef.current === run) runRef.current = undefined;
    if (unmountedRef.current) return;

    const transcript = transcriptRef.current;
    if (transcript.length > 0) {
      changeState('extracting');
      const { productId, getDraft, onFinish, onError } = propsRef.current;
      try {
        const record = await extractVoiceRecord(productId, { ...getDraft(), transcript });
        if (unmountedRef.current) return;
        if (hasContent(record)) onFinish(record);
        else message ??= '会話から記録できる内容が見つかりませんでした。';
      } catch (e) {
        if (!unmountedRef.current) {
          onError(errorMessage(e));
          changeState('idle');
          return;
        }
      }
    }
    if (unmountedRef.current) return;
    changeState('idle');
    if (message) propsRef.current.onError(message);
  }

  /**
   * 利用者の操作や上限時間で会話を終える。マイクと再生を止めて中継に終了を伝え、
   * 終了の直前の字幕（AI のまとめなど）が届くよう、中継の closed を少し待ってから記録を取り出す。
   */
  async function stopRun(run: Run, message?: string) {
    if (run.stopping) return;
    run.stopping = true;
    stopMedia(run);
    if (run.session && run.events) {
      closeRelaySession(run.session);
      run.closeReason = 'client';
      await Promise.race([
        run.events,
        new Promise<void>((resolve) => window.setTimeout(resolve, CLOSE_WAIT_MS)),
      ]);
    }
    await complete(run, message);
  }

  function handleEvent(run: Run, event: RelayEvent) {
    switch (event.event) {
      case 'audio':
        if (!run.stopping) run.player?.enqueue(event.data.delta);
        break;
      case 'transcript':
        transcriptRef.current = appendTranscript(
          transcriptRef.current,
          event.data.role,
          event.data.delta,
        );
        setCaptions(transcriptRef.current.slice(-MAX_CAPTIONS));
        break;
      case 'closed':
        if (!run.stopping) run.closeReason = event.data.reason;
        break;
    }
  }

  // 画面を離れたら会話を止める（記録の取り出しとフォームへの反映はしない）
  // StrictMode の開発時の再マウントに備え、マウントのたびにフラグを戻す
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (runRef.current) void complete(runRef.current);
    };
  }, []);

  /** クリックの処理の中で呼ぶ。iOS Safari で音を出せるよう、AudioContext とマイクの要求は await の前に行う。 */
  async function start() {
    if (runRef.current) return;
    const { onError, productId, getDraft } = propsRef.current;
    onError('');
    const context = new AudioContext();
    void context.resume().catch(() => {});
    const microphone = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const run: Run = { context, sending: Promise.resolve(), stopping: false, finished: false };
    runRef.current = run;
    transcriptRef.current = [];
    setCaptions([]);
    setSeconds(0);
    changeState('connecting');

    try {
      run.stream = await microphone;
    } catch (e) {
      await complete(
        run,
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'マイクの使用が許可されていません。ブラウザーの設定でマイクを許可してください。'
          : 'マイクを使用できませんでした。',
      );
      return;
    }
    if (run.stopping) {
      run.stream.getTracks().forEach((track) => track.stop());
      return;
    }

    try {
      const ticket = await createVoiceSession(productId, getDraft());
      if (run.stopping) return;
      const session = await openRelaySession(ticket.relayUrl, ticket.ticket);
      if (run.stopping) {
        closeRelaySession(session);
        return;
      }
      run.session = session;
      run.player = new AudioPlayer(context, session.audioFormat);
      run.abort = new AbortController();
      run.events = streamRelayEvents(
        session,
        (event) => handleEvent(run, event),
        run.abort.signal,
      ).then(
        () => {
          // 中継が自分から閉じた場合（上限・切断など）は、ここで会話を終える
          if (!run.stopping) void complete(run, closeMessage(run.closeReason));
        },
        (e: unknown) => {
          if (!run.stopping) void complete(run, errorMessage(e));
        },
      );
      run.capture = await startCapture(context, run.stream, session.audioFormat, (bytes) => {
        // 順番が入れ替わらないよう、1 チャンクずつ送る。AI が話している間も送り続ける（全二重）
        run.sending = run.sending.then(async () => {
          if (run.stopping) return;
          try {
            await sendRelayAudio(session, bytes);
          } catch {
            void stopRun(run, '音声を送れなかったため、音声会話を終了しました。');
          }
        });
      });
      if (run.stopping) {
        run.capture.stop();
        return;
      }
      setMaxSeconds(session.maxSeconds);
      changeState('talking');
      let elapsed = 0;
      run.timer = window.setInterval(() => {
        elapsed += 1;
        setSeconds(elapsed);
        if (elapsed >= session.maxSeconds) void stopRun(run);
      }, 1000);
    } catch (e) {
      await complete(run, errorMessage(e));
    }
  }

  function stop() {
    const run = runRef.current;
    if (!run) return;
    // 接続中に中止したときは、会話がないので待たずに片付ける
    if (state === 'connecting') void complete(run);
    else void stopRun(run);
  }

  return { state, seconds, maxSeconds, captions, start, stop };
}

export type VoiceConversation = ReturnType<typeof useVoiceConversation>;

export function VoiceConversationButton({
  conversation,
  disabled,
}: {
  conversation: VoiceConversation;
  disabled: boolean;
}) {
  if (!isConversationSupported()) return null;
  if (conversation.state === 'connecting') {
    return (
      <Button type="button" variant="outline" size="sm" onClick={conversation.stop}>
        <Loader2Icon className="animate-spin" />
        接続中…（中止）
      </Button>
    );
  }
  if (conversation.state === 'talking') {
    return (
      <Button type="button" variant="destructive" size="sm" onClick={conversation.stop}>
        <SquareIcon />
        終了（{formatSeconds(conversation.seconds)} / {formatSeconds(conversation.maxSeconds)}）
      </Button>
    );
  }
  if (conversation.state === 'extracting') {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        <Loader2Icon className="animate-spin" />
        記録をまとめています…
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void conversation.start()}
      disabled={disabled}
    >
      <AudioLinesIcon />
      音声会話
    </Button>
  );
}

export function VoiceConversationPanel({ conversation }: { conversation: VoiceConversation }) {
  if (conversation.state === 'idle') return null;
  const { captions } = conversation;
  return (
    <div
      className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm"
      data-testid="voice-conversation"
    >
      <p className="flex items-center gap-2 text-muted-foreground">
        <HeadphonesIcon className="size-4" aria-hidden="true" />
        AI
        の声をマイクが拾わないよう、ヘッドセットの利用をおすすめします。話している途中でも、話しかけて割り込めます。
      </p>
      <div className="grid gap-1" aria-live="polite">
        <span className="font-medium">会話</span>
        {captions.length === 0 ? (
          <p className="text-muted-foreground">
            {conversation.state === 'connecting'
              ? '接続しています。しばらく使われていなかった場合は、1 分ほどかかることがあります。'
              : 'AI が話しかけます。聞こえないときは、話しかけてください。'}
          </p>
        ) : (
          captions.map((caption, index) => (
            <p key={index} className="leading-relaxed">
              <span className="font-medium">{caption.role === 'user' ? 'あなた' : 'AI'}: </span>
              {caption.text}
            </p>
          ))
        )}
      </div>
      {conversation.state === 'extracting' ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          会話の内容から、タイトルと RICE の情報をまとめています…
        </p>
      ) : (
        <p className="text-muted-foreground">
          「終了」を押すと、会話の内容をまとめてフォームに反映します。
        </p>
      )}
    </div>
  );
}
