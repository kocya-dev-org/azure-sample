targetScope = 'resourceGroup'

@description('リソースの配置先リージョン。')
param location string = 'japaneast'
@description('既存の Linux App Service 名。')
param appServiceName string = 'sample-azure'
@description('リソースに付与するタグ。')
param tags object = { managedBy: 'bicep', application: 'flyingfish' }
@minLength(3)
@maxLength(24)
param dataStorageAccountName string = 'stdata${uniqueString(resourceGroup().id)}'
param cosmosAccountName string = 'cosmos-${uniqueString(resourceGroup().id)}'

var databaseName = 'flyingfish'
var cosmosContainerName = 'records'
var blobContainerName = 'objects'

resource app 'Microsoft.Web/sites@2022-03-01' existing = {
  name: appServiceName
}

resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: dataStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  tags: tags
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true
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

var cosmosKeys = cosmosAccount.listKeys().primaryMasterKey
var storageKeys = dataStorage.listKeys().keys[0].value
resource appSettings 'Microsoft.Web/sites/config@2022-03-01' = {
  parent: app
  name: 'appsettings'
  properties: {
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
    COSMOS_CONNECTION_STRING: 'AccountEndpoint=${cosmosAccount.properties.documentEndpoint};AccountKey=${cosmosKeys};'
    COSMOS_DATABASE_ID: databaseName
    COSMOS_CONTAINER_ID: cosmosContainerName
    BLOB_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${dataStorage.name};AccountKey=${storageKeys};EndpointSuffix=${environment().suffixes.storage}'
    BLOB_CONTAINER_NAME: blobContainerName
    FRONTEND_PATH: '/home/site/wwwroot/frontend'
  }
}

resource webConfig 'Microsoft.Web/sites/config@2022-03-01' = {
  parent: app
  name: 'web'
  properties: {
    linuxFxVersion: 'NODE|22-lts'
    appCommandLine: 'node api/dist/server.js'
    alwaysOn: false
    ftpsState: 'Disabled'
    minTlsVersion: '1.2'
  }
}

output appServiceName string = app.name
output appServiceUrl string = 'https://${app.properties.defaultHostName}'
output cosmosAccountName string = cosmosAccount.name
output dataStorageAccountName string = dataStorage.name
