// RICE スコアの検証と計算。LLM には計算させず、ここで計算する。
import type { Rice, RiceValues, ScoredItem, StrategyFit } from './types';

export const IMPACT_VALUES: readonly number[] = [0.25, 0.5, 1, 2, 3];
export const CONFIDENCE_VALUES: readonly number[] = [0.5, 0.8, 1];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 値の範囲を検証する。範囲外なら undefined を返す。 */
export function validateRiceValues(value: unknown): RiceValues | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { reach, impact, confidence, effort } = value as Record<string, unknown>;
  if (!isFiniteNumber(reach) || !Number.isInteger(reach) || reach < 0) return undefined;
  if (!isFiniteNumber(impact) || !IMPACT_VALUES.includes(impact)) return undefined;
  if (!isFiniteNumber(confidence) || !CONFIDENCE_VALUES.includes(confidence)) return undefined;
  if (!isFiniteNumber(effort) || effort <= 0) return undefined;
  return { reach, impact, confidence, effort };
}

/** Reach × Impact × Confidence ÷ Effort を小数第 2 位で丸める。 */
export function calcRiceScore({ reach, impact, confidence, effort }: RiceValues): number {
  return Math.round(((reach * impact * confidence) / effort) * 100) / 100;
}

export function validateStrategyFitScore(value: unknown): number | undefined {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

export interface ScoringResult {
  rice: Rice;
  strategyFit: StrategyFit;
}

/** LLM の構造化出力を検証してスコアに変換する。不正な場合は undefined。 */
export function toScoringResult(raw: unknown): ScoringResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { rice: riceRaw, strategyFit: fitRaw } = raw as Record<string, unknown>;
  if (!riceRaw || typeof riceRaw !== 'object' || !fitRaw || typeof fitRaw !== 'object') {
    return undefined;
  }
  const riceRecord = riceRaw as Record<string, unknown>;
  const fitRecord = fitRaw as Record<string, unknown>;
  const rice = validateRiceValues(riceRecord);
  const fitScore = validateStrategyFitScore(fitRecord.score);
  if (!rice || fitScore === undefined) return undefined;
  if (typeof riceRecord.rationale !== 'string' || typeof fitRecord.rationale !== 'string') {
    return undefined;
  }
  return {
    rice: { ...rice, score: calcRiceScore(rice), rationale: riceRecord.rationale },
    strategyFit: { score: fitScore, rationale: fitRecord.rationale },
  };
}

/** バックログの並び順: RICE の降順、同じ値なら戦略合致度の降順。 */
export function compareForBacklog(a: ScoredItem, b: ScoredItem): number {
  return b.rice.score - a.rice.score || b.strategyFit.score - a.strategyFit.score;
}
