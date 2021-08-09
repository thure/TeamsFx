@minLength(3)
@maxLength(24)
@description('Name of Storage Accounts for frontend hosting.')
param frontend_hosting_storage_name string

var siteDomain = replace(replace(frontendHostingStorage.properties.primaryEndpoints.web, 'https://', ''), '/', '')

resource frontendHostingStorage 'Microsoft.Storage/storageAccounts@2021-04-01' = {
  kind: 'StorageV2'
  location: resourceGroup().location
  name: frontend_hosting_storage_name
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    isHnsEnabled: false
  }
  sku: {
    name: 'Standard_LRS'
  }
}

output storageName string = frontendHostingStorage.name
output endpoint string = 'https://${siteDomain}'
output domain string = siteDomain