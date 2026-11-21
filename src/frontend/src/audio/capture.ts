// 音声会話のマイク入力（ADR 0013）。AudioWorklet でマイクのサンプルを集め、
// 送信用の周波数に変換して 200 ms ごとのバイト列にする。
// Firefox はマイクと周波数の違う AudioContext をつなげないため、AudioContext はマイクと同じ周波数のまま使う。
import { encodeSamples, Resampler, sampleRateOf, type AudioFormat } from './pcm';

/** 1 回の送信の長さ（ms）。 */
export const CHUNK_MS = 200;

/** マイクのサンプルを 2048 個ずつ main スレッドへ渡すだけの処理。 */
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

export interface Capture {
  stop(): void;
}

export async function startCapture(
  context: AudioContext,
  stream: MediaStream,
  format: AudioFormat,
  onChunk: (bytes: Uint8Array) => void,
): Promise<Capture> {
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const outputRate = sampleRateOf(format);
  const chunkSamples = (outputRate * CHUNK_MS) / 1000;
  const resampler = new Resampler(context.sampleRate, outputRate);
  let pending: number[] = [];

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'pcm-capture');
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    for (const sample of resampler.process(event.data)) pending.push(sample);
    while (pending.length >= chunkSamples) {
      onChunk(encodeSamples(Float32Array.from(pending.slice(0, chunkSamples)), format));
      pending = pending.slice(chunkSamples);
    }
  };
  source.connect(node);
  // 出力先につながっていないノードを処理しないブラウザーがあるため、出力先にもつなぐ（出力は無音）
  node.connect(context.destination);
  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
    },
  };
}
