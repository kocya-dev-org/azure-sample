import { randomUUID } from 'node:crypto';
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { REPOSITORY_PATTERN } from '../lib/github';
import { jsonError, logError, readJsonObject, readString, type JsonObject } from '../lib/http';
import { deleteProductCascade, getProduct, listProducts, saveProduct } from '../lib/store';
import type { Product } from '../lib/types';

type ProductInput = Pick<Product, 'name' | 'strategy' | 'repository'>;

export function parseProductInput(body: JsonObject | undefined): ProductInput | string {
  if (!body) return '有効な JSON オブジェクトを指定してください。';
  const name = readString(body, 'name', 100);
  if (!name) return '名前を 100 文字以内で入力してください。';
  const strategy = readString(body, 'strategy', 4000);
  if (!strategy) return '戦略を 4000 文字以内で入力してください。';
  const rawRepository = body.repository;
  if (rawRepository === undefined || rawRepository === null || rawRepository === '') {
    return { name, strategy };
  }
  const repository = typeof rawRepository === 'string' ? rawRepository.trim() : '';
  if (!REPOSITORY_PATTERN.test(repository) || repository.length > 140) {
    return 'リポジトリは org/repository の形式で入力してください。';
  }
  return { name, strategy, repository };
}

export async function listProductsHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    return { jsonBody: await listProducts() };
  } catch (error) {
    logError(context, 'Product list failed', error);
    return jsonError(500, 'プロダクトの読み込みに失敗しました。');
  }
}

export async function createProductHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const input = parseProductInput(await readJsonObject(request));
  if (typeof input === 'string') return jsonError(400, input);
  const now = new Date().toISOString();
  const product: Product = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
  try {
    await saveProduct(product);
    return { status: 201, jsonBody: product };
  } catch (error) {
    logError(context, 'Product create failed', error);
    return jsonError(500, 'プロダクトの登録に失敗しました。');
  }
}

export async function updateProductHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const id = request.params.productId;
  const input = parseProductInput(await readJsonObject(request));
  if (typeof input === 'string') return jsonError(400, input);
  try {
    const existing = await getProduct(id);
    if (!existing) return jsonError(404, 'プロダクトが見つかりません。');
    const product: Product = {
      id,
      ...input,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await saveProduct(product);
    return { jsonBody: product };
  } catch (error) {
    logError(context, 'Product update failed', error);
    return jsonError(500, 'プロダクトの更新に失敗しました。');
  }
}

export async function deleteProductHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const deleted = await deleteProductCascade(request.params.productId);
    return deleted ? { status: 204 } : jsonError(404, 'プロダクトが見つかりません。');
  } catch (error) {
    logError(context, 'Product delete failed', error);
    return jsonError(500, 'プロダクトの削除に失敗しました。');
  }
}

app.http('listProducts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'products',
  handler: listProductsHandler,
});

app.http('createProduct', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products',
  handler: createProductHandler,
});

app.http('updateProduct', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'products/{productId}',
  handler: updateProductHandler,
});

app.http('deleteProduct', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'products/{productId}',
  handler: deleteProductHandler,
});
