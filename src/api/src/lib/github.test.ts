import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIssue, GithubError, isGithubEnabled } from './github';

const TOKEN = 'github_pat_test_token_value';

beforeEach(() => {
  vi.stubEnv('ISSUE_GITHUB_TOKEN', TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isGithubEnabled', () => {
  it('トークンの有無を返す', () => {
    expect(isGithubEnabled()).toBe(true);
    vi.stubEnv('ISSUE_GITHUB_TOKEN', '');
    expect(isGithubEnabled()).toBe(false);
  });
});

describe('createIssue', () => {
  it('GitHub API に Issue を作成する', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' }), {
          status: 201,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const issue = await createIssue('o/r', { title: 'T', body: 'B' });

    expect(issue).toEqual({ number: 7, url: 'https://github.com/o/r/issues/7' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r/issues');
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'flyingfish',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('失敗時は状態コードだけを持つエラーにする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response('{"message":"Bad credentials"}', { status: 401 }),
      ),
    );
    const error = await createIssue('o/r', { title: 'T', body: 'B' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GithubError);
    expect((error as GithubError).status).toBe(401);
    expect(String(error)).not.toContain('Bad credentials');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('不正なリポジトリ名では呼び出さない', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createIssue('../x', { title: 'T', body: 'B' })).rejects.toBeInstanceOf(
      GithubError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
