import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getBlobContainer } from './data';

interface BlobPayload {
  content: string;
}

function jsonError(status: number, message: string): HttpResponseInit {
  return { status, jsonBody: { error: message } };
}

async function parsePayload(request: HttpRequest): Promise<BlobPayload | HttpResponseInit> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as Record<string, unknown>).content !== 'string') {
      return jsonError(400, 'content に文字列を指定してください。');
    }
    return { content: (value as BlobPayload).content };
  } catch {
    return jsonError(400, '有効な JSON を指定してください。');
  }
}

function isResponse(value: BlobPayload | HttpResponseInit): value is HttpResponseInit {
  return 'status' in value && typeof value.status === 'number';
}

function getBlobName(request: HttpRequest): string | undefined {
  const name = request.params.name;
  return name && name.trim() ? name : undefined;
}

app.http('createBlob', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'blobs/{name}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const name = getBlobName(request);
    const payload = await parsePayload(request);
    if (!name) return jsonError(400, 'オブジェクト名が必要です。');
    if (isResponse(payload)) return payload;
    try {
      await getBlobContainer().getBlockBlobClient(name).uploadData(Buffer.from(payload.content, 'utf8'), {
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'text/plain; charset=utf-8' },
      });
      return { status: 201, jsonBody: { name, content: payload.content } };
    } catch (error) {
      context.error('Blob create failed', error);
      const status = typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 412 ? 409 : 500;
      return jsonError(status, status === 409 ? '同じ名前のオブジェクトがすでにあります。' : 'Blob の作成に失敗しました。');
    }
  },
});

app.http('getBlob', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'blobs/{name}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const name = getBlobName(request);
    if (!name) return jsonError(400, 'オブジェクト名が必要です。');
    try {
      const download = await getBlobContainer().getBlobClient(name).downloadToBuffer();
      return { jsonBody: { name, content: download.toString('utf8') } };
    } catch (error) {
      context.error('Blob read failed', error);
      const status = typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404 ? 404 : 500;
      return jsonError(status, status === 404 ? 'オブジェクトが見つかりません。' : 'Blob の読み込みに失敗しました。');
    }
  },
});

app.http('replaceBlob', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'blobs/{name}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const name = getBlobName(request);
    const payload = await parsePayload(request);
    if (!name) return jsonError(400, 'オブジェクト名が必要です。');
    if (isResponse(payload)) return payload;
    try {
      await getBlobContainer().getBlockBlobClient(name).uploadData(Buffer.from(payload.content, 'utf8'), {
        blobHTTPHeaders: { blobContentType: 'text/plain; charset=utf-8' },
      });
      return { jsonBody: { name, content: payload.content } };
    } catch (error) {
      context.error('Blob update failed', error);
      return jsonError(500, 'Blob の更新に失敗しました。');
    }
  },
});

app.http('deleteBlob', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'blobs/{name}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const name = getBlobName(request);
    if (!name) return jsonError(400, 'オブジェクト名が必要です。');
    try {
      const result = await getBlobContainer().getBlobClient(name).deleteIfExists();
      return result.succeeded ? { status: 204 } : jsonError(404, '削除するオブジェクトが見つかりません。');
    } catch (error) {
      context.error('Blob delete failed', error);
      return jsonError(500, 'Blob の削除に失敗しました。');
    }
  },
});
