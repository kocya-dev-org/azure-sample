// GitHub Issue の起票（ADR 0007）。トークンはサーバー側でだけ使い、
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

export async function createIssue(
  repository: string,
  issue: { title: string; body: string },
): Promise<CreatedIssue> {
  const token = optionalSetting(TOKEN_SETTING);
  if (!token) throw new GithubError(0);
  if (!REPOSITORY_PATTERN.test(repository)) throw new GithubError(400);
  const [owner, repo] = repository.split('/');
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'flyingfish',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(issue),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new GithubError(response.status);
  const created = (await response.json()) as { number?: unknown; html_url?: unknown };
  if (typeof created.number !== 'number' || typeof created.html_url !== 'string') {
    throw new GithubError(response.status);
  }
  return { number: created.number, url: created.html_url };
}
