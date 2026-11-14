targetScope = 'resourceGroup'

@description('Cosmos DB と Blob Storage の配置先リージョン。')
param location string = 'japaneast'
@description('SWA マネージド Functions の配置先リージョン。')
param staticWebAppLocation string = 'eastasia'
@description('リソースに付与するタグ。')
param tags object = { managedBy: 'bicep', application: 'flyingfish' }
@minLength(3)
@maxLength(24)
param dataStorageAccountName string = 'stdata${uniqueString(resourceGroup().id)}'
param cosmosAccountName string = 'cosmos-${uniqueString(resourceGroup().id)}'
param staticWebAppName string = 'swa-flyingfish-${uniqueString(resourceGroup().id)}'

var databaseName = 'flyingfish'
var cosmosContainerName = 'records'
var blobContainerName = 'objects'

resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
  tags: tags
}

resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: dataStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  tags: tags
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: dataStorage
  name: 'default'
}
resource blobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: blobContainerName
  properties: { publicAccess: 'None' }
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    locations: [ { locationName: location, failoverPriority: 0, isZoneRedundant: false } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    isVirtualNetworkFilterEnabled: false
    disableKeyBasedMetadataWriteAccess: false
    capacity: { totalThroughputLimit: 1000 }
  }
}
resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: { id: databaseName }
    options: { throughput: 400 }
  }
}
resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosContainerName
  properties: {
    resource: { id: cosmosContainerName, partitionKey: { paths: ['/id'], kind: 'Hash' } }
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output cosmosAccountName string = cosmosAccount.name
output dataStorageAccountName string = dataStorage.name
