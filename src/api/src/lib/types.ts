// Cosmos DB に保存するドキュメントの型。docs/data-model.md と一致させる。

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

export interface Proposal {
  id: string;
  productId: string;
  title: string;
  body: string;
  author: Person;
  createdAt: string;
  updatedAt: string;
}

export interface RiceValues {
  reach: number;
  impact: number;
  confidence: number;
  effort: number;
}

export interface Rice extends RiceValues {
  score: number;
  rationale: string;
}

export interface StrategyFit {
  score: number;
  rationale: string;
}

export type ItemStatus = 'open' | 'done';

export interface IssueRef {
  number: number;
  url: string;
  createdAt: string;
}

export interface ScoredItem {
  id: string;
  productId: string;
  proposalId: string;
  title: string;
  rice: Rice;
  strategyFit: StrategyFit;
  status: ItemStatus;
  doneAt?: string;
  issue?: IssueRef;
  proposalCreatedAt: string;
  scoredAt: string;
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
