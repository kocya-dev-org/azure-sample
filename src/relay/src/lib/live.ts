// Foundry の GPT-Live（全二重の音声モデル）との WebSocket（ADR 0014）。
// Node.js 組み込みの WebSocket は HTTP/2 で接続しようとして失敗するため、ws パッケージで HTTP/1.1 で接続する（ADR 0013）。
import WebSocket from 'ws';

/** ブラウザーとやりとりする音声の形式。GPT-Live の文書にあるのは 24 kHz PCM16 LE mono だけ。 */
export const AUDIO_FORMAT = 'pcm';

/** 中継が Foundry へ張る WebSocket の最小限の操作。テストでは偽物に差し替える。 */
export interface UpstreamSocket {
  send(data: string): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
  onError(listener: (error: Error) => void): void;
}

/** https://<resource>.openai.azure.com/ から GPT-Live の WebSocket の URL を作る（model は session.start で指定する）。 */
export function liveUrl(endpoint: string): string {
  return `${endpoint.replace(/^http/, 'ws').replace(/\/+$/, '')}/openai/v1/live/sessions`;
}

/**
 * セッションの開始。session は未知のフィールドを拒否するため、文書にあるフィールドだけを送る。
 * 委任（delegation）は既定の client のまま（ツールは使わない。記録は会話の後で抽出する）。
 */
export function buildSessionStart(options: {
  model: string;
  instructions: string;
  voice: string;
}): Record<string, unknown> {
  return {
    type: 'session.start',
    session: {
      model: options.model,
      instructions: options.instructions,
      audio: { output: { voice: options.voice } },
    },
  };
}

export function connectLive(url: string, apiKey: string): UpstreamSocket {
  const ws = new WebSocket(url, { headers: { 'api-key': apiKey } });
  return {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => ws.close(),
    onOpen: (listener) => ws.on('open', listener),
    onMessage: (listener) => ws.on('message', (data) => listener(data.toString())),
    onClose: (listener) => ws.on('close', () => listener()),
    onError: (listener) => ws.on('error', listener),
  };
}
