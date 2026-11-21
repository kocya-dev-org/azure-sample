// Microsoft Foundry（OpenAI 互換 API）の呼び出し。クライアントは初めて使うときに生成する。
// API キーはサーバー側でだけ使い、ブラウザーには渡さない。
import OpenAI from 'openai';
import { requiredSetting } from './settings';

let client: OpenAI | undefined;

function getClient(): OpenAI {
  client ??= new OpenAI({
    apiKey: requiredSetting('FOUNDRY_API_KEY'),
    baseURL: requiredSetting('FOUNDRY_ENDPOINT'),
    // マネージド Functions の制限時間（約 45 秒）内に収める
    timeout: 40_000,
    maxRetries: 0,
  });
  return client;
}

function getModel(): string {
  return process.env.FOUNDRY_MODEL ?? 'gpt-5-mini';
}

export interface ChatPrompt {
  system: string;
  user: string;
  maxCompletionTokens: number;
}

/** 応答テキストを差分ごとに返す。 */
export async function* streamText(prompt: ChatPrompt): AsyncGenerator<string> {
  const stream = await getClient().chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    reasoning_effort: 'low',
    max_completion_tokens: prompt.maxCompletionTokens,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** JSON Schema に従った構造化出力を返す。 */
export async function generateJson(
  prompt: ChatPrompt & { schemaName: string; schema: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await getClient().chat.completions.create(
    {
      model: getModel(),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      reasoning_effort: 'low',
      max_completion_tokens: prompt.maxCompletionTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: prompt.schemaName, schema: prompt.schema, strict: true },
      },
    },
    { signal },
  );
  const text = response.choices[0]?.message.content;
  if (!text) throw new Error('Foundry returned an empty response.');
  return JSON.parse(text) as unknown;
}
