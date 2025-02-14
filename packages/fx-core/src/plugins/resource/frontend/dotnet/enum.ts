// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export enum DotnetConfigKey {
  /* Config from solution */
  resourceGroupName = "resourceGroupName",
  subscriptionId = "subscriptionId",
  resourceNameSuffix = "resourceNameSuffix",
  location = "location",
  credential = "credential",
  teamsAppName = "teamsAppName",

  /* Config exported by Dotnet plugin */
  webAppName = "webAppName",
  appServicePlanName = "appServicePlanName",
  webAppEndpoint = "webAppEndpoint",
  webAppDomain = "webAppDomain",
  projectFilePath = "projectFilePath",
  webAppResourceId = "webAppResourceId",

  /* Intermediate */
  site = "site",
}

export enum AppSettingsKey {
  clientSecret = "CLIENT_SECRET",
  clientId = "CLIENT_ID",
  oauthHost = "OAUTH_AUTHORITY",
  tabAppEndpoint = "TAB_APP_ENDPOINT",
  aadMetadataAddress = "AAD_METADATA_ADDRESS",
  botId = "BOT_ID",
  botPassword = "BOT_PASSWORD",
  identifierUri = "IDENTIFIER_URI",
}

export enum ResourceType {
  webApp = "Azure Web App",
  appServicePlan = "Azure App Service Plan",
}
