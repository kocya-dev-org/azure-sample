// 音声会話の音声の変換（ADR 0013）。Realtime API とは PCM16（24 kHz）か G.711 μ-law（8 kHz）でやりとりする。

export type AudioFormat = 'pcm' | 'pcmu';

export function sampleRateOf(format: AudioFormat): number {
  return format === 'pcmu' ? 8000 : 24000;
}

/** マイクの周波数から送信用の周波数へ、線形補間で変換する。チャンクの境目をまたいで位置を保つ。 */
export class Resampler {
  private readonly step: number;
  private position = 0;
  private last = 0;

  constructor(inputRate: number, outputRate: number) {
    this.step = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array<ArrayBuffer> {
    const output: number[] = [];
    // position は「直前のチャンクの最後のサンプル（last）」を -1 とした位置
    while (this.position < input.length - 1) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const a = index < 0 ? this.last : input[index];
      const b = input[index + 1];
      output.push(a + (b - a) * fraction);
      this.position += this.step;
    }
    this.position -= input.length;
    if (input.length > 0) this.last = input[input.length - 1];
    return Float32Array.from(output);
  }
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function muLawEncodeSample(pcm: number): number {
  const sign = pcm < 0 ? 0x80 : 0;
  let magnitude = Math.min(Math.abs(pcm), MULAW_CLIP) + MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; mask >>= 1) exponent -= 1;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function muLawDecodeSample(byte: number): number {
  const value = ~byte & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  const magnitude = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
  return sign ? -magnitude : magnitude;
}

/** -1〜1 のサンプルを送信用のバイト列にする（PCM16 はリトルエンディアン）。 */
export function encodeSamples(samples: Float32Array, format: AudioFormat): Uint8Array {
  if (format === 'pcmu') return Uint8Array.from(samples, (s) => muLawEncodeSample(toInt16(s)));
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, toInt16(s), true));
  return bytes;
}

/** 受信したバイト列を -1〜1 のサンプルにする。 */
export function decodeSamples(bytes: Uint8Array, format: AudioFormat): Float32Array<ArrayBuffer> {
  if (format === 'pcmu') return Float32Array.from(bytes, (b) => muLawDecodeSample(b) / 0x8000);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 0x8000;
  return samples;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
