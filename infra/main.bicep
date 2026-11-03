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

@description('Application Insights のログを保存する Log Analytics ワークスペース。')
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-${staticWebAppName}'
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

@description('Static Web Apps の API を監視する Application Insights。')
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${staticWebAppName}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

@description('Static Web Apps の API に Application Insights の接続文字列を設定します。')
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2025-03-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
