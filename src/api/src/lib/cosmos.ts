// Cosmos DB へのアクセス。クライアントは初めて使うときに生成する。
// コンテナーは Bicep でも定義しているが、PR プレビュー環境ではインフラのデプロイが
// 走らないため、初回アクセス時に createIfNotExists で作成する（ADR 0004 を補足）。
import { CosmosClient, type Container, type Database } from '@azure/cosmos';
import { requiredSetting } from './settings';

export const CONTAINER_DEFINITIONS = {
  products: { partitionKey: '/id' },
  proposals: { partitionKey: '/productId', defaultTtl: -1 },
  scoredItems: { partitionKey: '/productId' },
  backlogs: { partitionKey: '/productId' },
} as const;

export type ContainerName = keyof typeof CONTAINER_DEFINITIONS;

let database: Database | undefined;
const containers = new Map<ContainerName, Promise<Container>>();

function getDatabase(): Database {
  if (!database) {
    const client = new CosmosClient(requiredSetting('COSMOS_CONNECTION_STRING'));
    database = client.database(process.env.COSMOS_DATABASE_ID ?? 'flyingfish');
  }
  return database;
}

export function getContainer(name: ContainerName): Promise<Container> {
  let container = containers.get(name);
  if (!container) {
    const definition = CONTAINER_DEFINITIONS[name];
    container = getDatabase()
      .containers.createIfNotExists({
        id: name,
        partitionKey: { paths: [definition.partitionKey] },
        ...('defaultTtl' in definition ? { defaultTtl: definition.defaultTtl } : {}),
      })
      .then((response) => response.container);
    // 失敗した場合は次回のアクセスで再試行する
    container.catch(() => containers.delete(name));
    containers.set(name, container);
  }
  return container;
}

export function isCosmosStatus(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
