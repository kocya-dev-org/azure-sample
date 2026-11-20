// API ハンドラーのテスト用ヘルパー（デプロイ対象外）。
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { vi } from 'vitest';

export function makeRequest(
  options: {
    params?: Record<string, string>;
    body?: unknown;
    principal?: object;
    headers?: Record<string, string>;
    rawBody?: Uint8Array;
  } = {},
): HttpRequest {
  const headers = new Headers(options.headers);
  if (options.principal) {
    headers.set(
      'x-ms-client-principal',
      Buffer.from(JSON.stringify(options.principal)).toString('base64'),
    );
  }
  return {
    params: options.params ?? {},
    headers,
    json: async () => {
      if (options.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return options.body;
    },
    arrayBuffer: async () => {
      const raw = options.rawBody ?? new Uint8Array();
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    },
  } as unknown as HttpRequest;
}

export function makeContext(): InvocationContext & {
  error: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
} {
  return {
    invocationId: 'test',
    functionName: 'test',
    error: vi.fn<(...args: unknown[]) => void>(),
    warn: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => void>(),
    log: vi.fn<(...args: unknown[]) => void>(),
  } as unknown as InvocationContext & {
    error: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  };
}

export const PRINCIPAL = { userId: 'user-1', userDetails: 'user@example.com' };
