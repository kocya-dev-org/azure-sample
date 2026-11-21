// 提案の音声会話（ADR 0013）。AI と話しながら RICE の算出に必要な情報を聞き出してもらい、
// 終了したら記録した内容をフォームに反映する。音声と会話の記録はどこにも保存しない。
// 中継（App Service）とは HTTPS の POST と SSE だけでやりとりする（WebRTC と WebSocket は使わない）。
import { AudioLinesIcon, Loader2Icon, SquareIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createVoiceSession, errorMessage, type ProposalInput } from '../api/client';
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

/** AI が記録する項目。名前は API の record_proposal_info ツール（src/api/src/lib/prompts.ts）と一致させる。 */
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

/** ツール呼び出しの引数を記録に重ねる。空でない文字列だけを採用する。 */
export function mergeRecord(record: ProposalRecord, args: Record<string, unknown>): ProposalRecord {
  const next = { ...record };
  for (const key of RECORD_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) next[key] = value.trim();
  }
  return next;
}

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

type State = 'idle' | 'connecting' | 'talking';

export interface Caption {
  role: 'user' | 'assistant';
  text: string;
}

/** 1 回の会話で使うもの。終了時にまとめて片付ける。 */
interface Run {
  context: AudioContext;
  stream?: MediaStream;
  session?: RelaySession;
  player?: AudioPlayer;
  capture?: Capture;
  abort?: AbortController;
  timer?: number;
  sending: Promise<void>;
  closeReason?: string;
  finished: boolean;
}

/** 表示する字幕の数。古いものから消す。 */
const MAX_CAPTIONS = 6;

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
  const [record, setRecord] = useState<ProposalRecord>({});
  const recordRef = useRef<ProposalRecord>({});
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

  /** 会話を終える。記録があればフォームに反映し、message があれば表示する。何度呼んでもよい。 */
  function finish(run: Run, message?: string) {
    if (run.finished) return;
    run.finished = true;
    window.clearInterval(run.timer);
    run.capture?.stop();
    run.player?.stop();
    run.abort?.abort();
    if (run.session && !run.closeReason) closeRelaySession(run.session);
    run.stream?.getTracks().forEach((track) => track.stop());
    void run.context.close().catch(() => {});
    if (runRef.current === run) runRef.current = undefined;
    if (unmountedRef.current) return;
    changeState('idle');
    if (hasContent(recordRef.current)) propsRef.current.onFinish(recordRef.current);
    if (message) propsRef.current.onError(message);
  }

  function handleEvent(run: Run, event: RelayEvent) {
    switch (event.event) {
      case 'audio':
        run.player?.enqueue(event.data.delta);
        break;
      case 'speech_started':
        // 利用者が話し始めたら、AI の音声を止める（応答の中断はサーバー側の VAD が行う）
        run.player?.stop();
        break;
      case 'transcript':
        if (event.data.text.trim()) {
          setCaptions((current) => [...current, event.data].slice(-MAX_CAPTIONS));
        }
        break;
      case 'tool_call':
        if (event.data.name === 'record_proposal_info') {
          recordRef.current = mergeRecord(recordRef.current, event.data.arguments ?? {});
          setRecord(recordRef.current);
        }
        break;
      case 'closed':
        run.closeReason = event.data.reason;
        break;
    }
  }

  // 画面を離れたら会話を止める（フォームへの反映はしない）
  // StrictMode の開発時の再マウントに備え、マウントのたびにフラグを戻す
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (runRef.current) finish(runRef.current);
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
    const run: Run = { context, sending: Promise.resolve(), finished: false };
    runRef.current = run;
    recordRef.current = {};
    setRecord({});
    setCaptions([]);
    setSeconds(0);
    changeState('connecting');

    try {
      run.stream = await microphone;
    } catch (e) {
      finish(
        run,
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'マイクの使用が許可されていません。ブラウザーの設定でマイクを許可してください。'
          : 'マイクを使用できませんでした。',
      );
      return;
    }
    if (run.finished) {
      run.stream.getTracks().forEach((track) => track.stop());
      return;
    }

    try {
      const ticket = await createVoiceSession(productId, getDraft());
      if (run.finished) return;
      const session = await openRelaySession(ticket.relayUrl, ticket.ticket);
      if (run.finished) {
        closeRelaySession(session);
        return;
      }
      run.session = session;
      run.player = new AudioPlayer(context, session.audioFormat);
      run.abort = new AbortController();
      streamRelayEvents(session, (event) => handleEvent(run, event), run.abort.signal).then(
        () => finish(run, closeMessage(run.closeReason)),
        (e: unknown) => finish(run, errorMessage(e)),
      );
      run.capture = await startCapture(context, run.stream, session.audioFormat, (bytes) => {
        // 順番が入れ替わらないよう、1 チャンクずつ送る
        run.sending = run.sending.then(async () => {
          if (run.finished) return;
          try {
            await sendRelayAudio(session, bytes);
          } catch {
            finish(run, '音声を送れなかったため、音声会話を終了しました。');
          }
        });
      });
      if (run.finished) {
        run.capture.stop();
        return;
      }
      setMaxSeconds(session.maxSeconds);
      changeState('talking');
      let elapsed = 0;
      run.timer = window.setInterval(() => {
        elapsed += 1;
        setSeconds(elapsed);
        if (elapsed >= session.maxSeconds) finish(run);
      }, 1000);
    } catch (e) {
      finish(run, errorMessage(e));
    }
  }

  function stop() {
    if (runRef.current) finish(runRef.current);
  }

  return { state, seconds, maxSeconds, captions, record, start, stop };
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
  const { captions, record } = conversation;
  return (
    <div
      className="grid gap-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm"
      data-testid="voice-conversation"
    >
      <div className="grid gap-1" aria-live="polite">
        <span className="font-medium">会話</span>
        {captions.length === 0 ? (
          <p className="text-muted-foreground">
            {conversation.state === 'connecting'
              ? '接続しています。しばらく使われていなかった場合は、1 分ほどかかることがあります。'
              : 'AI が話しかけます。答えると、内容を記録していきます。'}
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
      <div className="grid gap-1">
        <span className="font-medium">記録した内容（終了するとフォームに反映します）</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {[['title', 'タイトル'] as const, ...RECORD_FIELDS].map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-wrap">{record[key] ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
