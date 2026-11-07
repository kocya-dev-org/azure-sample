import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getCosmosContainer } from './data';

type RecordValue = Record<string, unknown> & { id: string };
type ParsedRecord = { record: RecordValue } | { error: HttpResponseInit };

function jsonError(status: number, message: string): HttpResponseInit {
  return { status, jsonBody: { error: message } };
}

async function parseRecord(request: HttpRequest): Promise<ParsedRecord> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: jsonError(400, 'JSON オブジェクトを指定してください。') };
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.trim()) {
      return { error: jsonError(400, 'id は空でない文字列で指定してください。') };
    }
    return { record: record as RecordValue };
  } catch {
    return { error: jsonError(400, '有効な JSON を指定してください。') };
  }
}

app.http('listItems', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'items',
  handler: async (_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { resources } = await getCosmosContainer().items
        .query<RecordValue>('SELECT * FROM c')
        .fetchAll();
      return { jsonBody: resources };
    } catch (error) {
      context.error('Cosmos DB list failed', error);
      return jsonError(500, 'Cosmos DB の読み込みに失敗しました。');
    }
  },
});

app.http('createItem', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'items',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const parsed = await parseRecord(request);
    if ('error' in parsed) return parsed.error;
    const { record } = parsed;
    try {
      const { resource } = await getCosmosContainer().items.create(record);
      return { status: 201, jsonBody: resource };
    } catch (error) {
      context.error('Cosmos DB create failed', error);
      const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 409 ? 409 : 500;
      return jsonError(status, status === 409 ? '同じ id のレコードがすでにあります。' : 'Cosmos DB の作成に失敗しました。');
    }
  },
});

app.http('getItem', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'items/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const id = request.params.id;
    if (!id) return jsonError(400, 'id が必要です。');
    try {
      const { resource } = await getCosmosContainer().item(id, id).read<RecordValue>();
      return resource ? { jsonBody: resource } : jsonError(404, 'レコードが見つかりません。');
    } catch (error) {
      context.error('Cosmos DB read failed', error);
      const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 404 ? 404 : 500;
      return jsonError(status, status === 404 ? 'レコードが見つかりません。' : 'Cosmos DB の読み込みに失敗しました。');
    }
  },
});

app.http('replaceItem', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'items/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const id = request.params.id;
    const parsed = await parseRecord(request);
    if ('error' in parsed) return parsed.error;
    const { record } = parsed;
    if (!id || record.id !== id) return jsonError(400, 'URL の id と JSON の id を一致させてください。');
    try {
      const { resource } = await getCosmosContainer().item(id, id).replace(record);
      return { jsonBody: resource };
    } catch (error) {
      context.error('Cosmos DB update failed', error);
      const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 404 ? 404 : 500;
      return jsonError(status, status === 404 ? '更新するレコードが見つかりません。' : 'Cosmos DB の更新に失敗しました。');
    }
  },
});

app.http('deleteItem', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'items/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const id = request.params.id;
    if (!id) return jsonError(400, 'id が必要です。');
    try {
      await getCosmosContainer().item(id, id).delete();
      return { status: 204 };
    } catch (error) {
      context.error('Cosmos DB delete failed', error);
      const status = typeof error === 'object' && error !== null && 'code' in error && error.code === 404 ? 404 : 500;
      return jsonError(status, status === 404 ? '削除するレコードが見つかりません。' : 'Cosmos DB の削除に失敗しました。');
    }
  },
});
