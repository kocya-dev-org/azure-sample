// Foundry の Realtime API（GA）との WebSocket（ADR 0013）。
// Node.js 組み込みの WebSocket は HTTP/2 で接続しようとして失敗するため、ws パッケージで HTTP/1.1 で接続する。
import WebSocket from 'ws';

export type AudioFormat = 'pcm' | 'pcmu';

/** 中継が Foundry へ張る WebSocket の最小限の操作。テストでは偽物に差し替える。 */
export interface UpstreamSocket {
  send(data: string): void;
  close(): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
  onError(listener: (error: Error) => void): void;
}

/** https://<resource>.openai.azure.com/ から v1 の WebSocket の URL を作る（api-version は付けない）。 */
export function realtimeUrl(endpoint: string, model: string): string {
  const base = endpoint.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${base}/openai/v1/realtime?model=${encodeURIComponent(model)}`;
}

export function audioFormatConfig(format: AudioFormat): Record<string, unknown> {
  return format === 'pcmu' ? { type: 'audio/pcmu' } : { type: 'audio/pcm', rate: 24000 };
}

export function buildSessionUpdate(options: {
  instructions: string;
  tools: unknown[];
  audioFormat: AudioFormat;
  transcriptionModel: string | undefined;
  voice: string;
}): Record<string, unknown> {
  const format = audioFormatConfig(options.audioFormat);
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: options.instructions,
      tools: options.tools,
      tool_choice: 'auto',
      output_modalities: ['audio'],
      audio: {
        input: {
          format,
          transcription: options.transcriptionModel
            ? { model: options.transcriptionModel, language: 'ja' }
            : null,
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { format, voice: options.voice },
      },
    },
  };
}

export function connectRealtime(url: string, apiKey: string): UpstreamSocket {
  const ws = new WebSocket(url, { headers: { 'api-key': apiKey } });
  return {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => ws.close(),
    onMessage: (listener) => ws.on('message', (data) => listener(data.toString())),
    onClose: (listener) => ws.on('close', () => listener()),
    onError: (listener) => ws.on('error', listener),
  };
}
