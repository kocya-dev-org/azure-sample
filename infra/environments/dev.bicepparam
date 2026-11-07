using '../main.bicep'

param location = 'eastus'
param tags = {
  managedBy: 'bicep'
  application: 'flyingfish'
  environment: 'dev'
}
