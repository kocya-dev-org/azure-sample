import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

const credential = new DefaultAzureCredential();
const cosmosClient = new CosmosClient({
  endpoint: requiredSetting('Cosmos__endpoint'),
  aadCredentials: credential,
});
const cosmosContainer = cosmosClient
  .database(requiredSetting('Cosmos__databaseId'))
  .container(requiredSetting('Cosmos__containerId'));

const blobContainer = new BlobServiceClient(
  requiredSetting('Storage__endpoint'),
  credential,
).getContainerClient(requiredSetting('Storage__containerName'));

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
