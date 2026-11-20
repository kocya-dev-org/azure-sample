// 音声の文字起こし。スコアリング用とは別の Foundry リソース（文字起こしモデルのデプロイ）を API キーで呼ぶ（ADR 0011）。
// クライアントは初めて使うときに生成する。キーはサーバー側でだけ使い、ブラウザーには渡さない。
import OpenAI, { toFile } from 'openai';
import { requiredSetting } from './settings';

let client: OpenAI | undefined;

function getClient(): OpenAI {
  client ??= new OpenAI({
    apiKey: requiredSetting('FOUNDRY_TRANSCRIBE_API_KEY'),
    baseURL: requiredSetting('FOUNDRY_TRANSCRIBE_ENDPOINT'),
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
