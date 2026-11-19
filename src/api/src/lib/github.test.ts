import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIssue, getIssueState, GithubError, isGithubEnabled } from './github';

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

describe('getIssueState', () => {
  it('Issue の状態と close 理由を返す', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            state: 'closed',
            state_reason: 'completed',
            closed_at: '2026-11-01T00:00:00Z',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const state = await getIssueState('o/r', 7);

    expect(state).toEqual({
      state: 'closed',
      stateReason: 'completed',
      closedAt: '2026-11-01T00:00:00Z',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r/issues/7');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('open の Issue は close 理由と日時を null にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ state: 'open', state_reason: null, closed_at: null })),
      ),
    );
    expect(await getIssueState('o/r', 1)).toEqual({
      state: 'open',
      stateReason: null,
      closedAt: null,
    });
  });

  it('失敗時は状態コードだけを持つエラーにする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{"message":"Not Found"}', { status: 404 })),
    );
    const error = await getIssueState('o/r', 7).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GithubError);
    expect((error as GithubError).status).toBe(404);
    expect(String(error)).not.toContain('Not Found');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('不正な番号では呼び出さない', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getIssueState('o/r', 0)).rejects.toBeInstanceOf(GithubError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
