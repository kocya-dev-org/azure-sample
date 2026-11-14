import { CosmosClient, type Container } from '@azure/cosmos';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

const cosmosClient = new CosmosClient(requiredSetting('COSMOS_CONNECTION_STRING'));
const cosmosContainer = cosmosClient
  .database(process.env.COSMOS_DATABASE_ID ?? 'flyingfish')
  .container(process.env.COSMOS_CONTAINER_ID ?? 'records');

const blobContainer = BlobServiceClient
  .fromConnectionString(requiredSetting('BLOB_CONNECTION_STRING'))
  .getContainerClient(process.env.BLOB_CONTAINER_NAME ?? 'objects');

function requiredSetting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required application setting is missing: ${name}`);
  return value;
}

export function getCosmosContainer(): Container {
  return cosmosContainer;
}

export function getBlobContainer(): ContainerClient {
  return blobContainer;
}
