// HTTP ハンドラー共通の処理。
// エラーレスポンスには固定メッセージだけを返し、外部サービスのエラー内容は含めない。
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { displayName } from './person';
import type { Person } from './types';

export function jsonError(status: number, message: string): HttpResponseInit {
  return { status, jsonBody: { error: message } };
}

/**
 * エラーを記録する。SDK のエラーオブジェクトには要求ヘッダーなどが含まれ得るため、
 * 名前・コード・状態・メッセージ（先頭 300 文字）だけを記録する。
 */
export function logError(context: InvocationContext, message: string, error: unknown): void {
  const detail: Record<string, unknown> = {};
  if (error instanceof Error) {
    detail.name = error.name;
    detail.message = error.message.slice(0, 300);
  }
  if (typeof error === 'object' && error !== null) {
    const { code, status, statusCode } = error as Record<string, unknown>;
    if (typeof code === 'string' || typeof code === 'number') detail.code = code;
    if (typeof status === 'number') detail.status = status;
    if (typeof statusCode === 'number') detail.statusCode = statusCode;
  }
  context.error(message, detail);
}

/**
 * SWA が付与する x-ms-client-principal からユーザーを取得する。
 * 表示名は name クレームがあればそれを使い、なければ userId から生成する（userDetails のメールアドレスは使わない）。
 */
export function getPrincipal(request: HttpRequest): Person {
  const header = request.headers.get('x-ms-client-principal');
  if (header) {
    try {
      const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (typeof principal.userId === 'string' && principal.userId !== '') {
        return {
          userId: principal.userId,
          name: displayName(principal.userId, principal.claims),
        };
      }
    } catch {
      // 不正なヘッダーは匿名として扱う
    }
  }
  return { userId: 'anonymous', name: '不明' };
}

export type JsonObject = Record<string, unknown>;

/** 本文を JSON オブジェクトとして読む。オブジェクトでなければ undefined。 */
export async function readJsonObject(request: HttpRequest): Promise<JsonObject | undefined> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 前後の空白を除いた文字列を返す。空・型違い・長すぎる場合は undefined。 */
export function readString(body: JsonObject, key: string, maxLength: number): string | undefined {
  const value = body[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}
