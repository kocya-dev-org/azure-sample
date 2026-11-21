import { describe, expect, it } from 'vitest';
import {
  decodeSamples,
  encodeSamples,
  muLawDecodeSample,
  muLawEncodeSample,
  Resampler,
} from '@/audio/pcm';

describe('μ-law', () => {
  it('既知の値に変換する', () => {
    expect(muLawEncodeSample(0)).toBe(0xff);
    expect(muLawEncodeSample(32767)).toBe(0x80);
    expect(muLawEncodeSample(-32768)).toBe(0x00);
  });

  it('往復しても誤差が小さい', () => {
    for (const value of [-30000, -1000, -10, 0, 10, 1000, 30000]) {
      const decoded = muLawDecodeSample(muLawEncodeSample(value));
      expect(Math.abs(decoded - value)).toBeLessThanOrEqual(Math.max(8, Math.abs(value) * 0.07));
    }
  });
});

describe('encodeSamples / decodeSamples', () => {
  it('PCM16 はリトルエンディアンで 2 バイトずつにする', () => {
    const bytes = encodeSamples(Float32Array.from([0, 1, -1]), 'pcm');
    expect([...bytes]).toEqual([0, 0, 0xff, 0x7f, 0x00, 0x80]);
    expect([...decodeSamples(bytes, 'pcm')]).toEqual([0, 32767 / 32768, -1]);
  });

  it('μ-law は 1 サンプル 1 バイトにする', () => {
    const samples = Float32Array.from([0.5, -0.25]);
    const decoded = decodeSamples(encodeSamples(samples, 'pcmu'), 'pcmu');
    expect(decoded[0]).toBeCloseTo(0.5, 1);
    expect(decoded[1]).toBeCloseTo(-0.25, 1);
  });
});

describe('Resampler', () => {
  it('48 kHz を 24 kHz にすると、チャンクをまたいでもサンプル数が半分になる', () => {
    const resampler = new Resampler(48000, 24000);
    const input = Float32Array.from({ length: 2048 }, (_, i) => i);
    const first = resampler.process(input);
    const second = resampler.process(Float32Array.from({ length: 2048 }, (_, i) => i + 2048));
    expect(first.length + second.length).toBeGreaterThanOrEqual(2047);
    expect(first.length + second.length).toBeLessThanOrEqual(2048);
    // 線形な入力は、変換後も一定の間隔で増える
    const joined = [...first, ...second];
    joined.slice(1).forEach((value, i) => expect(value - joined[i]).toBeCloseTo(2));
  });
});
