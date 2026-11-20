// 提案の音声入力。ブラウザーで録音し、API で文字起こしした結果を onText に渡す（ADR 0011）。
// 音声は送信後に破棄し、どこにも保存しない。
import { Loader2Icon, MicIcon, SquareIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage, transcribeAudio } from '../api/client';

/** 録音の上限（秒）。文字起こしがマネージド Functions の制限時間内に終わるように抑える。 */
export const MAX_RECORDING_SECONDS = 90;

/** 録音の形式。文字起こし API が受け付ける順（Chrome・Edge・Firefox は webm、Safari は mp4）。 */
const MIME_TYPES = ['audio/webm', 'audio/mp4'];

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

function pickMimeType(): string | undefined {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type State = 'idle' | 'recording' | 'transcribing';

export function VoiceInput({
  productId,
  disabled,
  onText,
  onBusyChange,
  onError,
}: {
  productId: string;
  disabled: boolean;
  onText: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const unmountedRef = useRef(false);

  function changeState(next: State) {
    setState(next);
    onBusyChange(next !== 'idle');
  }

  function releaseMicrophone() {
    window.clearInterval(timerRef.current);
    timerRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // 画面を離れたら録音を止め、マイクを解放する（文字起こしはしない）
  // StrictMode の開発時の再マウントに備え、マウントのたびにフラグを戻す
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      releaseMicrophone();
    };
  }, []);

  if (!isRecordingSupported()) return null;

  async function sendAudio(audio: Blob) {
    changeState('transcribing');
    try {
      const text = (await transcribeAudio(productId, audio)).trim();
      if (unmountedRef.current) return;
      if (text) onText(text);
      else onError('音声から文字を読み取れませんでした。');
    } catch (e) {
      if (!unmountedRef.current) onError(errorMessage(e));
    } finally {
      if (!unmountedRef.current) changeState('idle');
    }
  }

  async function start() {
    onError('');
    const mimeType = pickMimeType();
    if (!mimeType) {
      onError('このブラウザーの録音形式には対応していません。');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      onError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'マイクの使用が許可されていません。ブラウザーの設定でマイクを許可してください。'
          : 'マイクを使用できませんでした。',
      );
      return;
    }
    if (unmountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMicrophone();
      recorderRef.current = null;
      if (unmountedRef.current) return;
      void sendAudio(new Blob(chunks, { type: mimeType }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setSeconds(0);
    changeState('recording');
    let elapsed = 0;
    timerRef.current = window.setInterval(() => {
      elapsed += 1;
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) stop();
    }, 1000);
  }

  function stop() {
    window.clearInterval(timerRef.current);
    timerRef.current = undefined;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  if (state === 'recording') {
    return (
      <Button type="button" variant="destructive" size="sm" onClick={stop}>
        <SquareIcon />
        停止（{formatSeconds(seconds)} / {formatSeconds(MAX_RECORDING_SECONDS)}）
      </Button>
    );
  }
  if (state === 'transcribing') {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        <Loader2Icon className="animate-spin" />
        文字起こし中…
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void start()}
      disabled={disabled}
    >
      <MicIcon />
      音声で入力
    </Button>
  );
}
