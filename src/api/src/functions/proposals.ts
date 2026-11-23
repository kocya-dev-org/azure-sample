// 提案の登録・更新・削除。登録と更新のたびにスコアリングし、
// 提案の元データ（proposals）とスコア付き項目（scoredItems）に分けて保存する。
import { randomUUID } from 'node:crypto';
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { withAuth } from '../lib/auth';
import { getPrincipal, jsonError, logError, readJsonObject } from '../lib/http';
import { parseProposalInput } from '../lib/proposal-input';
import { scoreProposal } from '../lib/scoring';
import {
  deleteProposal,
  getProduct,
  getProposal,
  getScoredItem,
  listProposals,
  listScoredItems,
  saveProposal,
  saveScoredItem,
} from '../lib/store';
import type { Proposal, ScoredItem } from '../lib/types';

/** 画面に返す提案。スコアは scoredItems から結合する。 */
export function toProposalView(proposal: Proposal, item: ScoredItem | undefined) {
  return {
    ...proposal,
    rice: item?.rice ?? null,
    strategyFit: item?.strategyFit ?? null,
    status: item?.status ?? null,
  };
}

export async function listProposalsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId } = request.params;
  try {
    if (!(await getProduct(productId))) return jsonError(404, 'プロダクトが見つかりません。');
    const [proposals, items] = await Promise.all([
      listProposals(productId),
      listScoredItems(productId),
    ]);
    const itemById = new Map(items.map((item) => [item.id, item]));
    return { jsonBody: proposals.map((p) => toProposalView(p, itemById.get(p.id))) };
  } catch (error) {
    logError(context, 'Proposal list failed', error);
    return jsonError(500, '提案の読み込みに失敗しました。');
  }
}

export async function getProposalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId, id } = request.params;
  try {
    const proposal = await getProposal(productId, id);
    if (!proposal) return jsonError(404, '提案が見つかりません。');
    return { jsonBody: toProposalView(proposal, await getScoredItem(productId, id)) };
  } catch (error) {
    logError(context, 'Proposal read failed', error);
    return jsonError(500, '提案の読み込みに失敗しました。');
  }
}

/** 提案を登録または更新し、スコアリングし直して保存する。 */
async function scoreAndSave(
  request: HttpRequest,
  context: InvocationContext,
  mode: 'create' | 'update',
): Promise<HttpResponseInit> {
  const { productId, id: requestedId } = request.params;
  const input = parseProposalInput(await readJsonObject(request));
  if (typeof input === 'string') return jsonError(400, input);

  let product;
  let existing: Proposal | undefined;
  let existingItem: ScoredItem | undefined;
  try {
    product = await getProduct(productId);
    if (!product) return jsonError(404, 'プロダクトが見つかりません。');
    if (mode === 'update') {
      existing = await getProposal(productId, requestedId);
      if (!existing) return jsonError(404, '提案が見つかりません。');
      existingItem = await getScoredItem(productId, requestedId);
    }
  } catch (error) {
    logError(context, 'Proposal read failed', error);
    return jsonError(500, '提案の読み込みに失敗しました。');
  }

  let scores;
  try {
    scores = await scoreProposal(product, input.title, input.body);
  } catch (error) {
    logError(context, 'Proposal scoring failed', error);
    return jsonError(502, '生成 AI によるスコアリングに失敗しました。もう一度お試しください。');
  }

  const now = new Date().toISOString();
  const proposal: Proposal = existing
    ? { ...existing, title: input.title, body: input.body, updatedAt: now }
    : {
        id: randomUUID(),
        productId,
        title: input.title,
        body: input.body,
        author: getPrincipal(request),
        createdAt: now,
        updatedAt: now,
      };
  const item: ScoredItem = {
    id: proposal.id,
    productId,
    proposalId: proposal.id,
    title: proposal.title,
    rice: scores.rice,
    strategyFit: scores.strategyFit,
    // 実装状況と Issue は再スコアリングしても残す
    status: existingItem?.status ?? 'open',
    ...(existingItem?.doneAt ? { doneAt: existingItem.doneAt } : {}),
    ...(existingItem?.issue ? { issue: existingItem.issue } : {}),
    proposalCreatedAt: proposal.createdAt,
    scoredAt: now,
  };

  try {
    await saveProposal(proposal);
    await saveScoredItem(item);
  } catch (error) {
    logError(context, 'Proposal save failed', error);
    return jsonError(500, '提案の保存に失敗しました。');
  }
  return { status: mode === 'create' ? 201 : 200, jsonBody: toProposalView(proposal, item) };
}

export function createProposalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return scoreAndSave(request, context, 'create');
}

export function updateProposalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return scoreAndSave(request, context, 'update');
}

export async function deleteProposalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId, id } = request.params;
  try {
    const deleted = await deleteProposal(productId, id);
    return deleted ? { status: 204 } : jsonError(404, '提案が見つかりません。');
  } catch (error) {
    logError(context, 'Proposal delete failed', error);
    return jsonError(500, '提案の削除に失敗しました。');
  }
}

app.http('listProposals', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'products/{productId}/proposals',
  handler: withAuth(listProposalsHandler),
});

app.http('createProposal', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/proposals',
  handler: withAuth(createProposalHandler),
});

app.http('getProposal', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'products/{productId}/proposals/{id}',
  handler: withAuth(getProposalHandler),
});

app.http('updateProposal', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'products/{productId}/proposals/{id}',
  handler: withAuth(updateProposalHandler),
});

app.http('deleteProposal', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'products/{productId}/proposals/{id}',
  handler: withAuth(deleteProposalHandler),
});
