import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: requiredSetting('FOUNDRY_API_KEY'),
  baseURL: requiredSetting('FOUNDRY_ENDPOINT'),
});
const model = process.env.FOUNDRY_MODEL ?? 'gpt-5-mini';

export async function generateText(prompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.choices[0]?.message.content;
  if (!text) throw new Error('Foundry returned an empty response.');
  return text;
}

function requiredSetting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required application setting is missing: ${name}`);
  return value;
}
