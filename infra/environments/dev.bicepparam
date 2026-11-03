using '../main.bicep'

param location = 'eastasia'
param tags = {
  managedBy: 'bicep'
  application: 'flyingfish'
  environment: 'dev'
}
