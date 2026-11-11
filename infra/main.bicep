targetScope = 'resourceGroup'

@description('Functions API を含むリージョナル Azure リソースの配置先リージョン。')
param location string = 'japaneast'

@description('フロントエンド静的サイト用ストレージアカウント名。')
@minLength(3)
@maxLength(24)
param frontendStorageAccountName string = 'stweb${uniqueString(resourceGroup().id)}'

@description('リソースに付与するタグ。')
param tags object = {
  managedBy: 'bicep'
  application: 'flyingfish'
}

resource frontendStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: frontendStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  tags: tags
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true
    supportsHttpsTrafficOnly: true
  }
}

resource frontendBlobService 'Microsoft.Storage/storageAccounts/blobServices@2025-08-01' = {
  parent: frontendStorage
  name: 'default'
  properties: {
    staticWebsite: {
      enabled: true
      indexDocument: 'index.html'
    }
  }
}

@description('Function App のグローバルに一意なリソース名。')
param functionAppName string = 'func-flex-${uniqueString(resourceGroup().id)}'

@description('Function App のホスト状態とデプロイパッケージを保存するストレージアカウント名。')
param functionStorageAccountName string = 'stfn${uniqueString(resourceGroup().id)}'

@description('Cosmos DB アカウント名。')
param cosmosAccountName string = 'cosmos-${uniqueString(resourceGroup().id)}'

@description('Blob データ用ストレージアカウント名。')
param dataStorageAccountName string = 'stdata${uniqueString(resourceGroup().id)}'

var functionPlanName = 'plan-${functionAppName}'
var vnetName = 'vnet-${frontendStorageAccountName}'
var integrationSubnetName = 'function-integration'
var privateEndpointSubnetName = 'private-endpoints'
var deploymentStorageContainerName = 'function-packages'
var cosmosDatabaseName = 'flyingfish'
var cosmosContainerName = 'records'
var blobContainerName = 'objects'

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [ '10.40.0.0/16' ]
    }
    subnets: [
      {
        name: integrationSubnetName
        properties: {
          addressPrefix: '10.40.1.0/27'
          delegations: [
            {
              name: 'flex-consumption'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: privateEndpointSubnetName
        properties: {
          addressPrefix: '10.40.2.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource integrationSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: integrationSubnetName
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: privateEndpointSubnetName
}

resource functionPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: functionPlanName
  location: location
  kind: 'functionapp'
  tags: tags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: functionStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  tags: tags
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    supportsHttpsTrafficOnly: true
  }
}

resource functionBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: functionStorage
  name: 'default'
}

resource functionDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: functionBlobService
  name: deploymentStorageContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: dataStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  tags: tags
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Disabled'
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
  properties: {
    publicAccess: 'None'
  }
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    // Free Tier はサブスクリプションごとに1アカウント、最大1,000 RU/s・25 GBまでが対象。
    enableFreeTier: true
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
    isVirtualNetworkFilterEnabled: false
    disableKeyBasedMetadataWriteAccess: true
    // Free Tier の RU/s 枠を超えるスループット割り当てを防ぐ。
    capacity: {
      totalThroughputLimit: 1000
    }
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
    options: {
      // Free Tier の1,000 RU/s枠内で共有スループットを設定。
      throughput: 400
    }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosContainerName
  properties: {
    resource: {
      id: cosmosContainerName
      partitionKey: {
        paths: [ '/id' ]
        kind: 'Hash'
      }
    }
  }
}

resource cosmosPrivateDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.documents.azure.com'
  location: 'global'
  tags: tags
}

resource cosmosDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: cosmosPrivateDns
  name: 'link-${vnetName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource cosmosPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${cosmosAccountName}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'cosmos'
        properties: {
          privateLinkServiceId: cosmosAccount.id
          groupIds: [ 'Sql' ]
        }
      }
    ]
  }
}

resource cosmosPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: cosmosPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cosmos'
        properties: {
          privateDnsZoneId: cosmosPrivateDns.id
        }
      }
    ]
  }
}

resource blobPrivateDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource blobDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: blobPrivateDns
  name: 'link-${vnetName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource blobPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${dataStorageAccountName}-blob'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: dataStorage.id
          groupIds: [ 'blob' ]
        }
      }
    ]
  }
}

resource blobPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: blobPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: blobPrivateDns.id
        }
      }
    ]
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionPlan.id
    virtualNetworkSubnetId: integrationSubnet.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'AzureWebJobsStorage__accountName', value: functionStorage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'Cosmos__endpoint', value: cosmosAccount.properties.documentEndpoint }
        { name: 'Cosmos__databaseId', value: cosmosDatabaseName }
        { name: 'Cosmos__containerId', value: cosmosContainerName }
        { name: 'Storage__endpoint', value: dataStorage.properties.primaryEndpoints.blob }
        { name: 'Storage__containerName', value: blobContainerName }
      ]
      cors: {
        allowedOrigins: [ substring(frontendStorage.properties.primaryEndpoints.web, 0, length(frontendStorage.properties.primaryEndpoints.web) - 1) ]
        supportCredentials: false
      }
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${functionStorage.properties.primaryEndpoints.blob}${deploymentStorageContainerName}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 512
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
  dependsOn: [
    blobContainer
    cosmosContainer
    cosmosPrivateDnsZoneGroup
    blobPrivateDnsZoneGroup
    functionDeploymentContainer
  ]
}

resource functionHostStorageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionStorage.id, functionApp.id, 'host-storage-blob-owner')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionHostStorageQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionStorage.id, functionApp.id, 'host-storage-queue-contributor')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionHostStorageTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionStorage.id, functionApp.id, 'host-storage-table-contributor')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource blobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(dataStorage.id, functionApp.id, 'blob-data-contributor')
  scope: dataStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionApp.id, 'cosmos-data-contributor')
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmosAccount.id
  }
}

@description('Application Insights のログを保存する Log Analytics ワークスペース。')
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-${frontendStorageAccountName}'
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

@description('Azure Functions API のテレメトリを収集する Application Insights。')
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${frontendStorageAccountName}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

output frontendStorageAccountName string = frontendStorage.name
output frontendUrl string = frontendStorage.properties.primaryEndpoints.web
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output functionAppName string = functionApp.name
output functionPlanName string = functionPlan.name
output functionStorageAccountName string = functionStorage.name
output cosmosAccountName string = cosmosAccount.name
output dataStorageAccountName string = dataStorage.name
output vnetName string = vnet.name
output cosmosPrivateEndpointName string = cosmosPrivateEndpoint.name
output blobPrivateEndpointName string = blobPrivateEndpoint.name
output cosmosPrivateDnsZoneName string = cosmosPrivateDns.name
output blobPrivateDnsZoneName string = blobPrivateDns.name
output privateDnsVnetLinkName string = cosmosDnsLink.name
output logAnalyticsWorkspaceName string = logAnalyticsWorkspace.name
output appInsightsName string = appInsights.name
