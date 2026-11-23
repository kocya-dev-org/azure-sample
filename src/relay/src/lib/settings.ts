// 中継のアプリケーション設定（App Service のアプリ設定、ADR 0013・0014）。値はログやレスポンスに出さない。

export interface RelayConfig {
  port: number;
  /** Foundry リソースのエンドポイント（例: https://voice-stt-foundary.openai.azure.com/）。 */
  endpoint: string;
  apiKey: string;
  /** GPT-Live のモデル（デプロイ）名。 */
  model: string;
  ticketSecret: string;
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
  return {
    port: Number(env.PORT ?? 8080),
    endpoint: required(env, 'FOUNDRY_REALTIME_ENDPOINT'),
    apiKey: required(env, 'FOUNDRY_REALTIME_API_KEY'),
    model: env.FOUNDRY_LIVE_MODEL ?? 'gpt-live-1',
    ticketSecret: required(env, 'REALTIME_TICKET_SECRET'),
    voice: env.REALTIME_VOICE ?? 'marin',
    allowedOrigins: (env.RELAY_ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxSessions: 4,
    idleSeconds: 30,
  };
}
