// エラーの記録。外部サービスの応答本文やキーを出さないよう、名前・コード・メッセージ（先頭 300 文字）だけを記録する。
// 方針は src/api/src/lib/http.ts の logError と同じ。

export function logError(message: string, error: unknown): void {
  const detail: Record<string, unknown> = {};
  if (error instanceof Error) {
    detail.name = error.name;
    detail.message = error.message.slice(0, 300);
  }
  if (typeof error === 'object' && error !== null) {
    const { code, type } = error as Record<string, unknown>;
    if (typeof code === 'string' || typeof code === 'number') detail.code = code;
    if (typeof type === 'string') detail.type = type;
  }
  console.error(message, detail);
}
