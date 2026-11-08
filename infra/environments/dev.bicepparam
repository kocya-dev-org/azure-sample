using '../main.bicep'

param location = 'eastus2'
param tags = {
  managedBy: 'bicep'
  application: 'flyingfish'
  environment: 'dev'
}
