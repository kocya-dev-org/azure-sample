// 提案が現在のアプリに実装済みかの確認（ADR 0012）。
// Copilot Space の内容を根拠に生成 AI に判断させる。失敗しても判定全体は止めず、unknown を返す。
import { CopilotSpaceError, fetchSpaceContext } from './copilotSpace';
import { generateJson } from './foundry';
import { buildImplementationPrompt, IMPLEMENTATION_SCHEMA, type PromptInput } from './prompts';

export type ImplementationStatus = 'implemented' | 'partial' | 'not_implemented' | 'unknown';

export interface ImplementationResult {
  status: ImplementationStatus;
  explanation: string;
}

const STATUSES: readonly string[] = ['implemented', 'partial', 'not_implemented', 'unknown'];
const EXPLANATION_MAX_LENGTH = 1000;

/** 確認の制限時間。判定のコメント（Foundry の 40 秒）と実行上限（約 45 秒）の内側に収める。 */
export const IMPLEMENTATION_CHECK_TIMEOUT_MS = 30_000;

export const UNKNOWN_RESULT: ImplementationResult = {
  status: 'unknown',
  explanation: '実装状況を確認できませんでした。',
};

/** LLM の構造化出力を検証する。不正な場合は undefined。 */
export function toImplementationResult(raw: unknown): ImplementationResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { status, explanation } = raw as Record<string, unknown>;
  if (typeof status !== 'string' || !STATUSES.includes(status)) return undefined;
  if (typeof explanation !== 'string' || !explanation.trim()) return undefined;
  return {
    status: status as ImplementationStatus,
    explanation: explanation.trim().slice(0, EXPLANATION_MAX_LENGTH),
  };
}

/**
 * 実装状況を確認する。例外は投げず、失敗時は onError に渡して UNKNOWN_RESULT を返す。
 * signal で中断した場合も UNKNOWN_RESULT を返す。
 */
export async function checkImplementation(
  input: PromptInput,
  signal: AbortSignal,
  onError: (error: unknown) => void,
): Promise<ImplementationResult> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(IMPLEMENTATION_CHECK_TIMEOUT_MS)]);
  try {
    const spaceContext = await fetchSpaceContext(combined);
    const raw = await generateJson(
      {
        ...buildImplementationPrompt(input, spaceContext),
        schemaName: 'implementation_check',
        schema: IMPLEMENTATION_SCHEMA,
      },
      combined,
    );
    const result = toImplementationResult(raw);
    if (!result) throw new Error('Foundry returned an invalid implementation check result.');
    return result;
  } catch (error) {
    // 呼び出し側の中断（クライアントの切断など）と、トークン未設定（任意の設定）は記録しない
    const noToken = error instanceof CopilotSpaceError && error.reason === 'no-token';
    if (!signal.aborted && !noToken) onError(error);
    return UNKNOWN_RESULT;
  }
}
