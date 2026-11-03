targetScope = 'resourceGroup'

@description('Static Web Apps を配置する Azure リージョン。')
param location string = 'eastasia'

@description('Static Web Apps のグローバルに一意なリソース名。')
@minLength(2)
@maxLength(40)
param staticWebAppName string = 'swa-flyingfish-${uniqueString(resourceGroup().id)}'

@description('リソースに付与するタグ。')
param tags object = {
  managedBy: 'bicep'
  application: 'flyingfish'
}

resource staticWebApp 'Microsoft.Web/staticSites@2025-03-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
    publicNetworkAccess: 'Enabled'
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
