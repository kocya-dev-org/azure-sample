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
@description('日次バッチ（Issue 状態の同期、ADR 0010）用の Function App の名前。')
param batchFunctionAppName string = 'func-flyingfish-batch-${uniqueString(resourceGroup().id)}'
@description('日次バッチの Node.js ランタイムのバージョン（Flex Consumption の対応バージョン）。')
param batchNodeVersion string = '24'
@secure()
@description('日次バッチが GitHub Issue の状態を読むためのトークン。空なら同期をスキップする（ADR 0007、0010）。')
param issueGithubToken string = ''
@description('音声会話の中継（ADR 0013）の配置先リージョン。データを保存しないため、ほかのリソースと分けてよい。')
param relayLocation string = 'japanwest'
@description('音声会話の中継（ADR 0013）用の Web App の名前。')
param relayAppName string = 'app-flyingfish-relay-${uniqueString(resourceGroup().id)}'
@description('中継の Node.js ランタイム（App Service の Linux の linuxFxVersion の値）。')
param relayNodeVersion string = 'NODE|24-lts'
@description('中継が接続する Foundry リソースのエンドポイント。')
param foundryRealtimeEndpoint string = 'https://voice-stt-foundary.openai.azure.com/'
@description('GPT-Live（全二重の音声モデル）のモデル（デプロイ）名（ADR 0014）。')
param foundryLiveModel string = 'gpt-live-1'
@secure()
@description('中継が Foundry を呼ぶ API キー。空なら中継は起動しない（音声会話は使えない）。')
param foundryRealtimeApiKey string = ''
@secure()
@description('SWA API が発行するチケットの署名鍵。SWA API の REALTIME_TICKET_SECRET と同じ値にする。')
param realtimeTicketSecret string = ''

var databaseName = 'flyingfish'
@description('Cosmos DB のコンテナー定義。パーティションキーと TTL（-1 は無期限、null は無効）。')
var cosmosContainers = [
  { name: 'products', partitionKey: '/id', defaultTtl: null }
  { name: 'proposals', partitionKey: '/productId', defaultTtl: -1 }
  { name: 'scoredItems', partitionKey: '/productId', defaultTtl: null }
  { name: 'backlogs', partitionKey: '/productId', defaultTtl: null }
]
var blobContainerName = 'objects'
var batchDeploymentContainerName = 'batch-deployments'

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

// 日次バッチのデプロイパッケージ置き場（Flex Consumption、ADR 0010）
resource batchDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: batchDeploymentContainerName
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
@batchSize(1)
resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [
  for container in cosmosContainers: {
    parent: cosmosDatabase
    name: container.name
    properties: {
      resource: union(
        {
          id: container.name
          partitionKey: { paths: [container.partitionKey], kind: 'Hash', version: 2 }
        },
        container.defaultTtl == null ? {} : { defaultTtl: container.defaultTtl }
      )
    }
  }
]

// --- 日次バッチ（独立 Function App、ADR 0010） ---
// SWA マネージド Functions は HTTP トリガーしか使えないため、タイマー関数だけを Flex Consumption で動かす。
// ホスト用ストレージはアプリケーションデータ用ストレージアカウントを再利用し、接続文字列で接続する。
var dataStorageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${dataStorage.name};AccountKey=${dataStorage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource batchPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${batchFunctionAppName}'
  location: location
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
  tags: tags
}

resource batchFunctionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: batchFunctionAppName
  location: location
  kind: 'functionapp,linux'
  tags: tags
  properties: {
    serverFarmId: batchPlan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${dataStorage.properties.primaryEndpoints.blob}${batchDeploymentContainerName}'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING'
          }
        }
      }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 512 }
      runtime: { name: 'node', version: batchNodeVersion }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // アプリ設定はすべてここで定義する（CLI で追加した設定は再デプロイで消えるため）
      appSettings: [
        { name: 'AzureWebJobsStorage', value: dataStorageConnectionString }
        { name: 'DEPLOYMENT_STORAGE_CONNECTION_STRING', value: dataStorageConnectionString }
        {
          name: 'COSMOS_CONNECTION_STRING'
          value: cosmosAccount.listConnectionStrings().connectionStrings[0].connectionString
        }
        { name: 'COSMOS_DATABASE_ID', value: databaseName }
        { name: 'ISSUE_GITHUB_TOKEN', value: issueGithubToken }
      ]
    }
  }
  dependsOn: [batchDeploymentContainer]
}

// --- 音声会話の中継（App Service F1、ADR 0013） ---
// WebRTC がブロックされ、マネージド Functions が WebSocket を扱えないため、
// ブラウザーとは HTTPS（POST と SSE）、Foundry とは WebSocket でつなぐ中継を置く。
// F1 は CPU 60 分/日・帯域 165 MB/日・1 インスタンスの制限がある。
// Japan East は、このリソースグループの webspace（日次バッチの Flex Consumption と同じ）で F1 を作れないため、
// Japan West に置く（SubscriptionIsOverQuotaForSku。ADR 0013 の追記）。
var swaHostName = staticWebApp.properties.defaultHostname
var swaHostLabel = split(swaHostName, '.')[0]
var swaHostSuffix = substring(swaHostName, length(swaHostLabel))
// SWA の既定ホスト（例: orange-field-0a2258e00.5.azurestaticapps.net）と、
// PR プレビューのホスト（例: orange-field-0a2258e00-24.eastasia.5.azurestaticapps.net。番号のあとにリージョンが入る）を許可する
var relayAllowedOrigins = 'https://${swaHostName},https://${swaHostLabel}-*.*${swaHostSuffix}'

resource relayPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${relayAppName}'
  location: relayLocation
  kind: 'linux'
  sku: { name: 'F1', tier: 'Free' }
  properties: { reserved: true }
  tags: tags
}

resource relayApp 'Microsoft.Web/sites@2024-04-01' = {
  name: relayAppName
  location: relayLocation
  kind: 'app,linux'
  tags: tags
  properties: {
    serverFarmId: relayPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: relayNodeVersion
      appCommandLine: 'node dist/src/server.js'
      alwaysOn: false
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // アプリ設定はすべてここで定義する（CLI で追加した設定は再デプロイで消えるため）
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'FOUNDRY_REALTIME_ENDPOINT', value: foundryRealtimeEndpoint }
        { name: 'FOUNDRY_LIVE_MODEL', value: foundryLiveModel }
        { name: 'FOUNDRY_REALTIME_API_KEY', value: foundryRealtimeApiKey }
        { name: 'REALTIME_TICKET_SECRET', value: realtimeTicketSecret }
        { name: 'RELAY_ALLOWED_ORIGINS', value: relayAllowedOrigins }
      ]
    }
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output cosmosAccountName string = cosmosAccount.name
output dataStorageAccountName string = dataStorage.name
output batchFunctionAppName string = batchFunctionApp.name
output relayAppName string = relayApp.name
output relayUrl string = 'https://${relayApp.properties.defaultHostName}'
