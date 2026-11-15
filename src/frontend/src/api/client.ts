// API クライアント。同じ Static Web App ホストの /api を呼び出す。
// シークレットはフロントエンドに置かない（Foundry や GitHub は API 側から呼ぶ）。

export interface Person {
  userId: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  strategy: string;
  repository?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProductInput = Pick<Product, 'name' | 'strategy' | 'repository'>;

export interface Rice {
  reach: number;
  impact: number;
  confidence: number;
  effort: number;
  score: number;
  rationale: string;
}

export interface StrategyFit {
  score: number;
  rationale: string;
}

export type ItemStatus = 'open' | 'done';

export interface Proposal {
  id: string;
  productId: string;
  title: string;
  body: string;
  author: Person;
  createdAt: string;
  updatedAt: string;
  rice: Rice | null;
  strategyFit: StrategyFit | null;
  status: ItemStatus | null;
}

export interface ProposalInput {
  title: string;
  body: string;
}

export interface BacklogEntry {
  scoredItemId: string;
  rank: number;
  title: string;
  riceScore: number;
  strategyFitScore: number;
}

export interface Backlog {
  id: string;
  productId: string;
  from: string;
  to: string;
  items: BacklogEntry[];
  createdAt: string;
  createdBy: Person;
}

export interface IssueRef {
  number: number;
  url: string;
  createdAt: string;
}

export interface BacklogDetailEntry extends BacklogEntry {
  deleted: boolean;
  status: ItemStatus | null;
  issue: IssueRef | null;
  rice: Rice | null;
  strategyFit: StrategyFit | null;
}

export interface BacklogDetail extends Omit<Backlog, 'items'> {
  items: BacklogDetailEntry[];
  githubEnabled: boolean;
  hasRepository: boolean;
}

export type IssueResult =
  | { itemId: string; result: 'created' | 'skipped'; issue: IssueRef }
  | { itemId: string; result: 'not_found' | 'failed' };

export const MAX_ISSUES_PER_REQUEST = 10;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const GENERIC_ERROR = 'API の呼び出しに失敗しました。';

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return new ApiError(body.error, response.status);
  } catch {
    // JSON 以外の応答は固定メッセージにする
  }
  return new ApiError(GENERIC_ERROR, response.status);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  listProducts: () => request<Product[]>('GET', '/products'),
  createProduct: (input: ProductInput) => request<Product>('POST', '/products', input),
  updateProduct: (id: string, input: ProductInput) =>
    request<Product>('PUT', `/products/${enc(id)}`, input),
  deleteProduct: (id: string) => request<void>('DELETE', `/products/${enc(id)}`),

  listProposals: (productId: string) =>
    request<Proposal[]>('GET', `/products/${enc(productId)}/proposals`),
  getProposal: (productId: string, id: string) =>
    request<Proposal>('GET', `/products/${enc(productId)}/proposals/${enc(id)}`),
  createProposal: (productId: string, input: ProposalInput) =>
    request<Proposal>('POST', `/products/${enc(productId)}/proposals`, input),
  updateProposal: (productId: string, id: string, input: ProposalInput) =>
    request<Proposal>('PUT', `/products/${enc(productId)}/proposals/${enc(id)}`, input),
  deleteProposal: (productId: string, id: string) =>
    request<void>('DELETE', `/products/${enc(productId)}/proposals/${enc(id)}`),

  listBacklogs: (productId: string) =>
    request<Backlog[]>('GET', `/products/${enc(productId)}/backlogs`),
  createBacklog: (productId: string, range: { from: string; to: string }) =>
    request<Backlog>('POST', `/products/${enc(productId)}/backlogs`, range),
  getBacklog: (productId: string, id: string) =>
    request<BacklogDetail>('GET', `/products/${enc(productId)}/backlogs/${enc(id)}`),

  createIssues: (productId: string, itemIds: string[]) =>
    request<{ results: IssueResult[] }>('POST', `/products/${enc(productId)}/issues`, {
      itemIds,
    }),

  updateItemStatus: (productId: string, id: string, status: ItemStatus) =>
    request<{ id: string; status: ItemStatus; doneAt: string | null }>(
      'PATCH',
      `/products/${enc(productId)}/items/${enc(id)}`,
      { status },
    ),
};

/**
 * 判定コメントをストリームで受け取り、届いた分を onText に渡す。
 * サーバーやプロキシが応答をまとめて返す場合も、まとめて 1 回渡すだけで動作は変わらない。
 */
export async function streamReview(
  productId: string,
  input: ProposalInput,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/products/${enc(productId)}/proposals/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await toApiError(response);
  if (!response.body) {
    onText(await response.text());
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) onText(text);
  }
  const rest = decoder.decode();
  if (rest) onText(rest);
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_ERROR;
}
