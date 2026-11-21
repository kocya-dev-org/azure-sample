// 音声会話の AI の音声の再生（ADR 0013）。届いた差分を順につなげて再生する。
// 利用者が話し始めたら stop で止める（割り込み）。
import { base64ToBytes, decodeSamples, sampleRateOf, type AudioFormat } from './pcm';

export class AudioPlayer {
  private nextTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly format: AudioFormat,
  ) {}

  enqueue(base64: string): void {
    const samples = decodeSamples(base64ToBytes(base64), this.format);
    if (samples.length === 0) return;
    // 送られてきた周波数のまま AudioBuffer を作り、出力の周波数への変換はブラウザーに任せる
    const buffer = this.context.createBuffer(1, samples.length, sampleRateOf(this.format));
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // まだ始まっていない、または終わった音声は無視する
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }
}
