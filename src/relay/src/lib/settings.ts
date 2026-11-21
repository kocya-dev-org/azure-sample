// 中継のアプリケーション設定（App Service のアプリ設定、ADR 0013）。値はログやレスポンスに出さない。
import type { AudioFormat } from './realtime';

export interface RelayConfig {
  port: number;
  /** Foundry リソースのエンドポイント（例: https://voice-stt-foundary.openai.azure.com/）。 */
  endpoint: string;
  apiKey: string;
  /** Realtime モデルのデプロイ名。 */
  model: string;
  ticketSecret: string;
  audioFormat: AudioFormat;
  /** 利用者の発話の文字起こしに使うモデル。undefined なら文字起こししない。 */
  transcriptionModel: string | undefined;
  voice: string;
  /** 許可するオリジン。ホスト名の `*` は英数字とハイフンの並びに一致する。 */
  allowedOrigins: string[];
  maxSessions: number;
  idleSeconds: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Required application setting is missing: ${name}`);
  return value;
}

export function loadConfig(env: Env = process.env): RelayConfig {
  const audioFormat = env.REALTIME_AUDIO_FORMAT ?? 'pcm';
  if (audioFormat !== 'pcm' && audioFormat !== 'pcmu') {
    throw new Error('REALTIME_AUDIO_FORMAT must be pcm or pcmu');
  }
  const transcription = env.REALTIME_TRANSCRIPTION_MODEL ?? 'whisper-1';
  return {
    port: Number(env.PORT ?? 8080),
    endpoint: required(env, 'FOUNDRY_REALTIME_ENDPOINT'),
    apiKey: required(env, 'FOUNDRY_REALTIME_API_KEY'),
    model: required(env, 'FOUNDRY_REALTIME_MODEL'),
    ticketSecret: required(env, 'REALTIME_TICKET_SECRET'),
    audioFormat,
    transcriptionModel: transcription === 'off' ? undefined : transcription,
    voice: env.REALTIME_VOICE ?? 'marin',
    allowedOrigins: (env.RELAY_ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxSessions: 4,
    idleSeconds: 30,
  };
}
