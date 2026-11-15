import { readString, type JsonObject } from './http';

export interface ProposalInput {
  title: string;
  body: string;
}

/** 提案の入力を検証する。不正な場合はエラーメッセージを返す。 */
export function parseProposalInput(body: JsonObject | undefined): ProposalInput | string {
  if (!body) return '有効な JSON オブジェクトを指定してください。';
  const title = readString(body, 'title', 200);
  if (!title) return 'タイトルを 200 文字以内で入力してください。';
  const text = readString(body, 'body', 8000);
  if (!text) return '内容を 8000 文字以内で入力してください。';
  return { title, body: text };
}
