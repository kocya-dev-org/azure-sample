// API クライアント。同じ Static Web App ホストの /api を呼び出す。
// シークレットはフロントエンドに置かない（Foundry や GitHub は API 側から呼ぶ）。
import { readEvents } from './sse';

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

export interface IssueSyncResult {
  checked: number;
  updated: { id: string; doneAt: string }[];
  failed: number;
}

export interface MonthlyCount {
  month: string;
  proposals: number;
  issues: number;
  done: number;
}

export interface Dashboard {
  totals: { proposals: number; issues: number; done: number };
  monthly: MonthlyCount[];
  githubEnabled: boolean;
}

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

export async function toApiError(response: Response): Promise<ApiError> {
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

export interface Me {
  authorized: boolean;
  name: string;
}

export const api = {
  getMe: () => request<Me>('GET', '/me'),

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
  syncIssueStatus: (productId: string) =>
    request<IssueSyncResult>('POST', `/products/${enc(productId)}/issues/sync`),

  getDashboard: (productId: string) =>
    request<Dashboard>('GET', `/products/${enc(productId)}/dashboard`),

  updateItemStatus: (productId: string, id: string, status: ItemStatus) =>
    request<{ id: string; status: ItemStatus; doneAt: string | null }>(
      'PATCH',
      `/products/${enc(productId)}/items/${enc(id)}`,
      { status },
    ),
};

/** 録音した音声を送り、文字起こしの結果を返す。音声は API 側でも保存しない。 */
export async function transcribeAudio(productId: string, audio: Blob): Promise<string> {
  const response = await fetch(`/api/products/${enc(productId)}/transcriptions`, {
    method: 'POST',
    headers: { 'content-type': audio.type },
    body: audio,
  });
  if (!response.ok) throw await toApiError(response);
  const { text } = (await response.json()) as { text?: unknown };
  return typeof text === 'string' ? text : '';
}

export interface VoiceSessionTicket {
  relayUrl: string;
  ticket: string;
  expiresAt: string;
  maxSeconds: number;
}

/** 音声会話（ADR 0013）の中継を使うためのチケットを受け取る。フォームの現在値を渡し、聞き直しを避ける。 */
export function createVoiceSession(
  productId: string,
  draft: ProposalInput,
): Promise<VoiceSessionTicket> {
  return request<VoiceSessionTicket>('POST', `/products/${enc(productId)}/voice-sessions`, draft);
}

/** 音声会話の文字起こしから、提案の記録（タイトルと RICE の項目）を取り出す（ADR 0014）。 */
export async function extractVoiceRecord(
  productId: string,
  input: ProposalInput & { transcript: { role: 'user' | 'assistant'; text: string }[] },
): Promise<Record<'title' | 'summary' | 'reach' | 'impact' | 'confidence' | 'effort', string>> {
  const { record } = await request<{
    record: Record<'title' | 'summary' | 'reach' | 'impact' | 'confidence' | 'effort', string>;
  }>('POST', `/products/${enc(productId)}/voice-sessions/extract`, input);
  return record;
}

const STREAM_CUT_ERROR = '判定の応答が途中で切れました。もう一度お試しください。';

/**
 * 判定コメントを SSE（text/event-stream）で受け取り、delta イベントの差分を届いた順に onText に渡す。
 * done で正常に終わる。error イベント、または done がないまま切れた場合は ApiError を投げる。
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
  if (!response.body) throw new ApiError(STREAM_CUT_ERROR, response.status);
  for await (const { event, data } of readEvents(response.body)) {
    const fields = (data ?? {}) as { text?: unknown; message?: unknown };
    if (event === 'delta' && typeof fields.text === 'string') {
      onText(fields.text);
    } else if (event === 'error') {
      const message = typeof fields.message === 'string' ? fields.message : GENERIC_ERROR;
      throw new ApiError(message, response.status);
    } else if (event === 'done') {
      return;
    }
  }
  throw new ApiError(STREAM_CUT_ERROR, response.status);
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_ERROR;
}
