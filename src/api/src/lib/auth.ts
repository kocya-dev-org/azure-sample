// 利用者の認可。SWA の組み込み認証（Entra ID）でサインインしたうえで、
// Cosmos DB の users コンテナーに登録された利用者だけに API の利用を許可する（ADR 0015）。
// 照合には x-ms-client-principal の userDetails（Entra では UPN）を小文字にした値を使う。
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getContainer, isCosmosStatus } from './cosmos';
import { jsonError, logError } from './http';

/** 照合結果を保持する時間。users への登録・削除は最大でこの時間だけ遅れて反映される。 */
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { allowed: boolean; expiresAt: number }>();

/** テスト用。照合結果のキャッシュを消す。 */
export function clearAuthCache(): void {
  cache.clear();
}

/** x-ms-client-principal から照合用の値（userDetails を小文字にした値）を取り出す。なければ undefined。 */
export function principalKey(request: HttpRequest): string | undefined {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return undefined;
  try {
    const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    const details = principal.userDetails;
    if (typeof details !== 'string') return undefined;
    const key = details.trim().toLowerCase();
    return key === '' ? undefined : key;
  } catch {
    return undefined;
  }
}

/** users コンテナーに登録されているか。Cosmos DB の読み取りに失敗した場合は例外を投げる。 */
export async function isAllowedUser(key: string, now: number = Date.now()): Promise<boolean> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.allowed;
  const container = await getContainer('users');
  let allowed: boolean;
  try {
    const { resource } = await container.item(key, key).read();
    allowed = resource !== undefined;
  } catch (error) {
    if (!isCosmosStatus(error, 404)) throw error;
    allowed = false;
  }
  cache.set(key, { allowed, expiresAt: now + CACHE_TTL_MS });
  return allowed;
}

export type AuthResult = 'authorized' | 'unauthorized';

/** 要求元の利用者を照合する。Cosmos DB の読み取りに失敗した場合は例外を投げる。 */
export async function checkUser(request: HttpRequest): Promise<AuthResult> {
  const key = principalKey(request);
  if (!key) return 'unauthorized';
  return (await isAllowedUser(key)) ? 'authorized' : 'unauthorized';
}

/**
 * 許可されていなければエラーレスポンスを返し、許可されていれば undefined を返す。
 * 401 は staticwebapp.config.json でサインイン画面へのリダイレクトに置き換えられるため、403 を返す。
 * 照合できない場合は利用を許可しない。
 */
export async function authorize(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit | undefined> {
  try {
    return (await checkUser(request)) === 'authorized'
      ? undefined
      : jsonError(403, '利用権限がありません。');
  } catch (error) {
    logError(context, 'User authorization failed', error);
    return jsonError(503, '利用権限を確認できませんでした。');
  }
}

type Handler<T> = (request: HttpRequest, context: InvocationContext) => Promise<T>;

/** 認可を通った要求だけを元のハンドラーに渡す。app.http に登録するハンドラーはすべてこれで包む。 */
export function withAuth<T>(handler: Handler<T>): Handler<T | HttpResponseInit> {
  return async (request, context) =>
    (await authorize(request, context)) ?? handler(request, context);
}
