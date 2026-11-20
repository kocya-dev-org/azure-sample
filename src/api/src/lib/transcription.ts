// 音声の文字起こし。スコアリング用とは別の Foundry リソース（文字起こしモデルのデプロイ）を API キーで呼ぶ（ADR 0011）。
// クライアントは初めて使うときに生成する。キーはサーバー側でだけ使い、ブラウザーには渡さない。
import { AzureOpenAI, toFile } from 'openai';
import { requiredSetting } from './settings';

/**
 * Azure OpenAI の API バージョン。v1 エンドポイント（/openai/v1/audio/transcriptions）は
 * gpt-4o-transcribe のデプロイに対して DeploymentNotFound を返すため、デプロイ名を指定する従来のパスで呼ぶ。
 */
const API_VERSION = '2025-03-01-preview';

let client: AzureOpenAI | undefined;

function getClient(): AzureOpenAI {
  client ??= new AzureOpenAI({
    apiKey: requiredSetting('FOUNDRY_TRANSCRIBE_API_KEY'),
    // リソースのエンドポイント（例: https://voice-stt-foundary.openai.azure.com/）
    endpoint: requiredSetting('FOUNDRY_TRANSCRIBE_ENDPOINT'),
    deployment: requiredSetting('FOUNDRY_TRANSCRIBE_MODEL'),
    apiVersion: API_VERSION,
    // マネージド Functions の制限時間（約 45 秒）内に収める
    timeout: 40_000,
    maxRetries: 0,
  });
  return client;
}

/** 音声を日本語として文字起こしする。fileName の拡張子はサービス側の形式判定に使われる。 */
export async function transcribe(audio: Buffer, fileName: string): Promise<string> {
  const result = await getClient().audio.transcriptions.create({
    model: requiredSetting('FOUNDRY_TRANSCRIBE_MODEL'),
    file: await toFile(audio, fileName),
    language: 'ja',
  });
  return result.text;
}
