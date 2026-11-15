// 提案のスコアリング（RICE と戦略合致度）。LLM の出力はサーバーで検証してから使う。
import { generateJson } from './foundry';
import { buildScoringPrompt, SCORING_SCHEMA } from './prompts';
import { toScoringResult, type ScoringResult } from './rice';
import type { Product } from './types';

export class InvalidScoringError extends Error {
  constructor() {
    super('Foundry returned an invalid scoring result.');
    this.name = 'InvalidScoringError';
  }
}

export async function scoreProposal(
  product: Product,
  title: string,
  body: string,
): Promise<ScoringResult> {
  const raw = await generateJson({
    ...buildScoringPrompt({ productName: product.name, strategy: product.strategy, title, body }),
    schemaName: 'proposal_scoring',
    schema: SCORING_SCHEMA,
  });
  const result = toScoringResult(raw);
  if (!result) throw new InvalidScoringError();
  return result;
}
