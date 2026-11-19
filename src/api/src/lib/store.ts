// データアクセス関数。ハンドラーはこのモジュールを通して Cosmos DB を使う。
import type { ItemDefinition } from '@azure/cosmos';
import { getContainer, isCosmosStatus, type ContainerName } from './cosmos';
import { publicPerson } from './person';
import type { Backlog, Product, Proposal, ScoredItem } from './types';

async function readItem<T extends ItemDefinition>(
  name: ContainerName,
  id: string,
  partitionKey: string,
): Promise<T | undefined> {
  try {
    const { resource } = await (await getContainer(name)).item(id, partitionKey).read<T>();
    return resource ?? undefined;
  } catch (error) {
    if (isCosmosStatus(error, 404)) return undefined;
    throw error;
  }
}

async function deleteItem(name: ContainerName, id: string, partitionKey: string): Promise<boolean> {
  try {
    await (await getContainer(name)).item(id, partitionKey).delete();
    return true;
  } catch (error) {
    if (isCosmosStatus(error, 404)) return false;
    throw error;
  }
}

async function queryAll<T>(
  name: ContainerName,
  query: string,
  parameters: { name: string; value: string }[] = [],
  partitionKey?: string,
): Promise<T[]> {
  const container = await getContainer(name);
  const { resources } = await container.items
    .query<T>({ query, parameters }, partitionKey === undefined ? {} : { partitionKey })
    .fetchAll();
  return resources;
}

// Cosmos DB のシステムプロパティ（_rid、_etag など）は返さない
function stripSystem<T extends object>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !key.startsWith('_'))) as T;
}

// 以前のデータに残るメールアドレスを表示名に置き換えて返す
function withPublicAuthor(proposal: Proposal): Proposal {
  return { ...stripSystem(proposal), author: publicPerson(proposal.author) };
}

function withPublicCreator(backlog: Backlog): Backlog {
  return { ...stripSystem(backlog), createdBy: publicPerson(backlog.createdBy) };
}

// --- プロダクト ---

export async function listProducts(): Promise<Product[]> {
  const products = await queryAll<Product>('products', 'SELECT * FROM c');
  return products.map(stripSystem).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const product = await readItem<Product>('products', id, id);
  return product && stripSystem(product);
}

export async function saveProduct(product: Product): Promise<void> {
  await (await getContainer('products')).items.upsert(product);
}

/** プロダクトと、紐づくすべてのデータを削除する。 */
export async function deleteProductCascade(id: string): Promise<boolean> {
  for (const name of ['proposals', 'scoredItems', 'backlogs'] as const) {
    const docs = await queryAll<{ id: string }>(name, 'SELECT c.id FROM c', [], id);
    for (const doc of docs) await deleteItem(name, doc.id, id);
  }
  return deleteItem('products', id, id);
}

// --- 提案とスコア付き項目 ---

export async function listProposals(productId: string): Promise<Proposal[]> {
  const proposals = await queryAll<Proposal>(
    'proposals',
    'SELECT * FROM c WHERE NOT IS_DEFINED(c.type) ORDER BY c.createdAt DESC',
    [],
    productId,
  );
  return proposals.map(withPublicAuthor);
}

export async function getProposal(productId: string, id: string): Promise<Proposal | undefined> {
  const proposal = await readItem<Proposal>('proposals', id, productId);
  return proposal && withPublicAuthor(proposal);
}

export async function saveProposal(proposal: Proposal): Promise<void> {
  await (await getContainer('proposals')).items.upsert(proposal);
}

/** 提案と、そのスコア付き項目を削除する。 */
export async function deleteProposal(productId: string, id: string): Promise<boolean> {
  await deleteItem('scoredItems', id, productId);
  return deleteItem('proposals', id, productId);
}

export async function listScoredItems(productId: string): Promise<ScoredItem[]> {
  const items = await queryAll<ScoredItem>('scoredItems', 'SELECT * FROM c', [], productId);
  return items.map(stripSystem);
}

export async function getScoredItem(
  productId: string,
  id: string,
): Promise<ScoredItem | undefined> {
  const item = await readItem<ScoredItem>('scoredItems', id, productId);
  return item && stripSystem(item);
}

export async function saveScoredItem(item: ScoredItem): Promise<void> {
  await (await getContainer('scoredItems')).items.upsert(item);
}

/** 提案の登録日時が fromIso 以上、toIso 未満のスコア付き項目を返す。 */
export async function listScoredItemsInRange(
  productId: string,
  fromIso: string,
  toIso: string,
): Promise<ScoredItem[]> {
  const items = await queryAll<ScoredItem>(
    'scoredItems',
    'SELECT * FROM c WHERE c.proposalCreatedAt >= @from AND c.proposalCreatedAt < @to',
    [
      { name: '@from', value: fromIso },
      { name: '@to', value: toIso },
    ],
    productId,
  );
  return items.map(stripSystem);
}

// --- バックログ ---

export async function listBacklogs(productId: string): Promise<Backlog[]> {
  const backlogs = await queryAll<Backlog>(
    'backlogs',
    'SELECT * FROM c ORDER BY c.createdAt DESC',
    [],
    productId,
  );
  return backlogs.map(withPublicCreator);
}

export async function getBacklog(productId: string, id: string): Promise<Backlog | undefined> {
  const backlog = await readItem<Backlog>('backlogs', id, productId);
  return backlog && withPublicCreator(backlog);
}

export async function saveBacklog(backlog: Backlog): Promise<void> {
  await (await getContainer('backlogs')).items.create(backlog);
}
