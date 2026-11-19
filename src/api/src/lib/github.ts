// GitHub Issue の起票と状態の取得（ADR 0007）。トークンはサーバー側でだけ使い、
// レスポンスやログにはトークンも GitHub のエラー本文も含めない。
import { optionalSetting } from './settings';

export const REPOSITORY_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const TOKEN_SETTING = 'ISSUE_GITHUB_TOKEN';

export function isGithubEnabled(): boolean {
  return optionalSetting(TOKEN_SETTING) !== undefined;
}

export class GithubError extends Error {
  constructor(readonly status: number) {
    super(`GitHub API request failed with status ${status}.`);
    this.name = 'GithubError';
  }
}

export interface CreatedIssue {
  number: number;
  url: string;
}

export interface IssueState {
  state: 'open' | 'closed';
  /** close の理由。completed・not_planned・duplicate・reopened など。古い Issue では null。 */
  stateReason: string | null;
  closedAt: string | null;
}

/** リポジトリの Issue API を呼ぶ。失敗時は状態コードだけを持つ GithubError を投げる。 */
async function requestIssues(
  repository: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<{ status: number; data: Record<string, unknown> }> {
  const token = optionalSetting(TOKEN_SETTING);
  if (!token) throw new GithubError(0);
  if (!REPOSITORY_PATTERN.test(repository)) throw new GithubError(400);
  const [owner, repo] = repository.split('/');
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'flyingfish',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues${path}`,
    {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new GithubError(response.status);
  const data: unknown = await response.json().catch(() => undefined);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new GithubError(response.status);
  }
  return { status: response.status, data: data as Record<string, unknown> };
}

export async function createIssue(
  repository: string,
  issue: { title: string; body: string },
): Promise<CreatedIssue> {
  const { status, data } = await requestIssues(repository, '', { method: 'POST', body: issue });
  if (typeof data.number !== 'number' || typeof data.html_url !== 'string') {
    throw new GithubError(status);
  }
  return { number: data.number, url: data.html_url };
}

export async function getIssueState(repository: string, number: number): Promise<IssueState> {
  if (!Number.isInteger(number) || number <= 0) throw new GithubError(400);
  const { status, data } = await requestIssues(repository, `/${number}`, { method: 'GET' });
  if (data.state !== 'open' && data.state !== 'closed') throw new GithubError(status);
  return {
    state: data.state,
    stateReason: typeof data.state_reason === 'string' ? data.state_reason : null,
    closedAt: typeof data.closed_at === 'string' ? data.closed_at : null,
  };
}
