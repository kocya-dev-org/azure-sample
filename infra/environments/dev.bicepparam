using '../main.bicep'

param location = 'japaneast'
param staticWebAppLocation = 'eastasia'
param tags = {
  managedBy: 'bicep'
  application: 'flyingfish'
  environment: 'dev'
}
