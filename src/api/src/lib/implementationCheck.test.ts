import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./foundry', () => ({
  generateJson: vi.fn<(prompt: { user: string }, signal?: AbortSignal) => Promise<unknown>>(),
}));
vi.mock('./copilotSpace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./copilotSpace')>()),
  fetchSpaceContext: vi.fn<() => Promise<string>>(),
}));

import { CopilotSpaceError, fetchSpaceContext } from './copilotSpace';
import { generateJson } from './foundry';
import { checkImplementation, toImplementationResult, UNKNOWN_RESULT } from './implementationCheck';

const input = {
  productName: '製品',
  strategy: '戦略',
  title: '音声入力',
  body: '話して入力したい',
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('toImplementationResult', () => {
  it('状態と説明を検証する', () => {
    expect(toImplementationResult({ status: 'partial', explanation: ' 説明 ' })).toEqual({
      status: 'partial',
      explanation: '説明',
    });
    expect(toImplementationResult({ status: 'done', explanation: '説明' })).toBeUndefined();
    expect(toImplementationResult({ status: 'implemented', explanation: '' })).toBeUndefined();
    expect(toImplementationResult(null)).toBeUndefined();
  });
});

describe('checkImplementation', () => {
  it('Space の内容を根拠に生成 AI に確認させる', async () => {
    vi.mocked(fetchSpaceContext).mockResolvedValue('Space の内容');
    vi.mocked(generateJson).mockResolvedValue({
      status: 'implemented',
      explanation: '提案フォームの「音声で入力」ボタンで使えます。',
    });
    const onError = vi.fn<(error: unknown) => void>();

    const result = await checkImplementation(input, new AbortController().signal, onError);

    expect(result).toEqual({
      status: 'implemented',
      explanation: '提案フォームの「音声で入力」ボタンで使えます。',
    });
    const [prompt, signal] = vi.mocked(generateJson).mock.calls[0];
    expect(prompt).toMatchObject({ schemaName: 'implementation_check' });
    expect(prompt.user).toContain('<space>\nSpace の内容\n</space>');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(onError).not.toHaveBeenCalled();
  });

  it('Space の取得や生成 AI が失敗したら unknown を返し、エラーを記録する', async () => {
    vi.mocked(fetchSpaceContext).mockRejectedValue(new CopilotSpaceError('http', 401));
    const onError = vi.fn<(error: unknown) => void>();

    expect(await checkImplementation(input, new AbortController().signal, onError)).toEqual(
      UNKNOWN_RESULT,
    );
    expect(onError).toHaveBeenCalledOnce();

    vi.mocked(fetchSpaceContext).mockResolvedValue('Space の内容');
    vi.mocked(generateJson).mockResolvedValue({ status: 'yes' });
    expect(await checkImplementation(input, new AbortController().signal, onError)).toEqual(
      UNKNOWN_RESULT,
    );
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('トークン未設定や中断はエラーとして記録しない', async () => {
    const onError = vi.fn<(error: unknown) => void>();
    vi.mocked(fetchSpaceContext).mockRejectedValue(new CopilotSpaceError('no-token'));
    expect(await checkImplementation(input, new AbortController().signal, onError)).toEqual(
      UNKNOWN_RESULT,
    );

    const controller = new AbortController();
    controller.abort();
    vi.mocked(fetchSpaceContext).mockRejectedValue(new Error('aborted'));
    expect(await checkImplementation(input, controller.signal, onError)).toEqual(UNKNOWN_RESULT);
    expect(onError).not.toHaveBeenCalled();
  });
});
