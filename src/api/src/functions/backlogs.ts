// バックログの作成と表示。作成時点の上位 10 件をスナップショットとして保存する。
import { randomUUID } from 'node:crypto';
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { getPrincipal, jsonError, logError, readJsonObject } from '../lib/http';
import { compareForBacklog } from '../lib/rice';
import {
  getBacklog,
  getProduct,
  listBacklogs,
  listScoredItems,
  listScoredItemsInRange,
  saveBacklog,
} from '../lib/store';
import type { Backlog, ScoredItem } from '../lib/types';

export const BACKLOG_SIZE = 10;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 日本時間の日付範囲（両端を含む）を、UTC の ISO 文字列の半開区間に変換する。
 * 不正な場合は undefined を返す。
 */
export function toUtcRange(
  from: unknown,
  to: unknown,
): { fromIso: string; toIso: string } | undefined {
  if (typeof from !== 'string' || typeof to !== 'string') return undefined;
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return undefined;
  const start = new Date(`${from}T00:00:00+09:00`);
  const endExclusive = new Date(new Date(`${to}T00:00:00+09:00`).getTime() + DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) return undefined;
  // 2026-02-30 のような存在しない日付を弾く
  const roundTrip = (iso: Date, offsetDays: number) =>
    new Date(iso.getTime() + 9 * 60 * 60 * 1000 - offsetDays * DAY_MS).toISOString().slice(0, 10);
  if (roundTrip(start, 0) !== from || roundTrip(endExclusive, 1) !== to) return undefined;
  if (start >= endExclusive) return undefined;
  return { fromIso: start.toISOString(), toIso: endExclusive.toISOString() };
}

export function selectTopItems(items: ScoredItem[]): Backlog['items'] {
  return [...items]
    .sort(compareForBacklog)
    .slice(0, BACKLOG_SIZE)
    .map((item, index) => ({
      scoredItemId: item.id,
      rank: index + 1,
      title: item.title,
      riceScore: item.rice.score,
      strategyFitScore: item.strategyFit.score,
    }));
}

export async function listBacklogsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId } = request.params;
  try {
    if (!(await getProduct(productId))) return jsonError(404, 'プロダクトが見つかりません。');
    return { jsonBody: await listBacklogs(productId) };
  } catch (error) {
    logError(context, 'Backlog list failed', error);
    return jsonError(500, 'バックログの読み込みに失敗しました。');
  }
}

export async function createBacklogHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId } = request.params;
  const body = await readJsonObject(request);
  const range = toUtcRange(body?.from, body?.to);
  if (!body || !range) {
    return jsonError(400, '期間は YYYY-MM-DD 形式で、開始日を終了日以前に指定してください。');
  }
  try {
    if (!(await getProduct(productId))) return jsonError(404, 'プロダクトが見つかりません。');
    const items = await listScoredItemsInRange(productId, range.fromIso, range.toIso);
    const backlog: Backlog = {
      id: randomUUID(),
      productId,
      from: body.from as string,
      to: body.to as string,
      items: selectTopItems(items),
      createdAt: new Date().toISOString(),
      createdBy: getPrincipal(request),
    };
    await saveBacklog(backlog);
    return { status: 201, jsonBody: backlog };
  } catch (error) {
    logError(context, 'Backlog create failed', error);
    return jsonError(500, 'バックログの作成に失敗しました。');
  }
}

export async function getBacklogHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId, id } = request.params;
  try {
    const backlog = await getBacklog(productId, id);
    if (!backlog) return jsonError(404, 'バックログが見つかりません。');
    const current = new Map((await listScoredItems(productId)).map((item) => [item.id, item]));
    return {
      jsonBody: {
        ...backlog,
        items: backlog.items.map((entry) => {
          const item = current.get(entry.scoredItemId);
          return {
            ...entry,
            deleted: !item,
            status: item?.status ?? null,
            issue: item?.issue ?? null,
            rice: item?.rice ?? null,
            strategyFit: item?.strategyFit ?? null,
          };
        }),
      },
    };
  } catch (error) {
    logError(context, 'Backlog read failed', error);
    return jsonError(500, 'バックログの読み込みに失敗しました。');
  }
}

app.http('listBacklogs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'products/{productId}/backlogs',
  handler: listBacklogsHandler,
});

app.http('createBacklog', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/backlogs',
  handler: createBacklogHandler,
});

app.http('getBacklog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'products/{productId}/backlogs/{id}',
  handler: getBacklogHandler,
});
