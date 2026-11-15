// スコア付き項目の実装状況の変更（Phase 2）。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { jsonError, logError, readJsonObject } from '../lib/http';
import { getScoredItem, saveScoredItem } from '../lib/store';
import type { ItemStatus, ScoredItem } from '../lib/types';

function isStatus(value: unknown): value is ItemStatus {
  return value === 'open' || value === 'done';
}

export async function updateItemStatusHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId, id } = request.params;
  const status = (await readJsonObject(request))?.status;
  if (!isStatus(status)) return jsonError(400, 'status には open か done を指定してください。');
  try {
    const item = await getScoredItem(productId, id);
    if (!item) return jsonError(404, '項目が見つかりません。');
    const { doneAt: _doneAt, ...rest } = item;
    const updated: ScoredItem =
      status === 'done'
        ? {
            ...rest,
            status,
            doneAt: item.status === 'done' && item.doneAt ? item.doneAt : new Date().toISOString(),
          }
        : // 未対応に戻したら実装日時を消す
          { ...rest, status };
    await saveScoredItem(updated);
    return { jsonBody: { id, status: updated.status, doneAt: updated.doneAt ?? null } };
  } catch (error) {
    logError(context, 'Item status update failed', error);
    return jsonError(500, '実装状況の更新に失敗しました。');
  }
}

app.http('updateItemStatus', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'products/{productId}/items/{id}',
  handler: updateItemStatusHandler,
});
