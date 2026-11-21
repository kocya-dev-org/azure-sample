// 音声会話の中継のエントリーポイント（App Service F1、ADR 0013）。
// 設定は起動時に検査する。足りなければ起動を失敗させ、App Service のログに残す。
import { createServer } from 'node:http';
import { createRelayHandler } from './app';
import { connectRealtime, realtimeUrl } from './lib/realtime';
import { SessionManager } from './lib/session';
import { loadConfig } from './lib/settings';

const SWEEP_INTERVAL_MS = 5_000;
const READY_TIMEOUT_MS = 10_000;

const config = loadConfig();
const url = realtimeUrl(config.endpoint, config.model);
const manager = new SessionManager({
  maxSessions: config.maxSessions,
  idleSeconds: config.idleSeconds,
  audioFormat: config.audioFormat,
  transcriptionModel: config.transcriptionModel,
  voice: config.voice,
  readyTimeoutMs: READY_TIMEOUT_MS,
  connect: () => connectRealtime(url, config.apiKey),
});

const server = createServer(createRelayHandler(config, manager));
const sweeper = setInterval(() => manager.sweep(Date.now()), SWEEP_INTERVAL_MS);

server.listen(config.port, () => {
  console.log(`Relay listening on port ${config.port}`);
});

process.on('SIGTERM', () => {
  clearInterval(sweeper);
  manager.closeAll();
  server.close();
});
