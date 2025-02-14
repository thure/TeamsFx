// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import {
  AzureSolutionSettings,
  ConfigFolderName,
  ProjectSettings,
  ProjectSettingsFileName,
} from "@microsoft/teamsfx-api";
import fs from "fs-extra";
import * as path from "path";
import {
  BotOptionItem,
  MessageExtensionItem,
  SsoItem,
  TabOptionItem,
  TabSPFxItem,
} from "../plugins/solution/fx-solution/question";
import { BuiltInFeaturePluginNames } from "../plugins/solution/fx-solution/v3/constants";
import * as uuid from "uuid";
import { isAadManifestEnabled } from "./tools";

export function validateProjectSettings(projectSettings: ProjectSettings): string | undefined {
  if (!projectSettings) return "empty projectSettings";
  if (!projectSettings.solutionSettings) return undefined;
  const solutionSettings = projectSettings.solutionSettings as AzureSolutionSettings;
  let validateRes = validateStringArray(solutionSettings.azureResources);
  if (validateRes) {
    return `solutionSettings.azureResources validation failed: ${validateRes}`;
  }
  validateRes = validateStringArray(solutionSettings.capabilities, [
    TabOptionItem.id,
    BotOptionItem.id,
    MessageExtensionItem.id,
    TabSPFxItem.id,
    ...(isAadManifestEnabled() ? [SsoItem.id] : []),
  ]);
  if (validateRes) {
    return `solutionSettings.capabilities validation failed: ${validateRes}`;
  }
  validateRes = validateStringArray(solutionSettings.activeResourcePlugins);
  if (validateRes) {
    return `solutionSettings.activeResourcePlugins validation failed: ${validateRes}`;
  }

  if (projectSettings?.solutionSettings?.migrateFromV1) {
    return "The project created before v2.0.0 is only supported in the Teams Toolkit before v3.4.0.";
  }

  return undefined;
}

function validateStringArray(arr?: any, enums?: string[]) {
  if (!arr) {
    return "is undefined";
  }
  if (!Array.isArray(arr)) {
    return "is not array";
  }
  for (const element of arr as any[]) {
    if (typeof element !== "string") {
      return "array elements is not string type";
    }
    if (enums && !enums.includes(element)) {
      return `array elements is out of scope: ${enums}`;
    }
  }
  return undefined;
}

export function isValidProject(workspacePath?: string): boolean {
  if (!workspacePath) return false;
  try {
    const confFolderPath = path.resolve(workspacePath, `.${ConfigFolderName}`, "configs");
    const settingsFile = path.resolve(confFolderPath, ProjectSettingsFileName);
    const projectSettings: ProjectSettings = fs.readJsonSync(settingsFile);
    if (validateProjectSettings(projectSettings)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

export function hasAAD(projectSetting: ProjectSettings): boolean {
  const solutionSettings = projectSetting.solutionSettings as AzureSolutionSettings | undefined;
  if (!solutionSettings) return false;
  return solutionSettings.activeResourcePlugins.includes(BuiltInFeaturePluginNames.aad);
}

export function hasSPFx(projectSetting: ProjectSettings): boolean {
  const solutionSettings = projectSetting.solutionSettings as AzureSolutionSettings | undefined;
  if (!solutionSettings) return false;
  return solutionSettings.activeResourcePlugins.includes(BuiltInFeaturePluginNames.spfx);
}

export function hasAzureResource(projectSetting: ProjectSettings): boolean {
  const solutionSettings = projectSetting.solutionSettings as AzureSolutionSettings | undefined;
  if (!solutionSettings) return false;
  const azurePlugins = [
    BuiltInFeaturePluginNames.aad,
    BuiltInFeaturePluginNames.apim,
    BuiltInFeaturePluginNames.bot,
    BuiltInFeaturePluginNames.dotnet,
    BuiltInFeaturePluginNames.frontend,
    BuiltInFeaturePluginNames.function,
    BuiltInFeaturePluginNames.identity,
    BuiltInFeaturePluginNames.keyVault,
    BuiltInFeaturePluginNames.simpleAuth,
    BuiltInFeaturePluginNames.sql,
  ];
  for (const pluginName of solutionSettings.activeResourcePlugins) {
    if (azurePlugins.includes(pluginName)) return true;
  }
  return false;
}

export function isPureExistingApp(projectSettings: ProjectSettings): boolean {
  return projectSettings.solutionSettings === undefined;
}

export function getProjectSettingsVersion() {
  return "2.1.0";
}

export function newProjectSettings(): ProjectSettings {
  const projectSettings: ProjectSettings = {
    appName: "",
    projectId: uuid.v4(),
    version: getProjectSettingsVersion(),
  };
  return projectSettings;
}
export function isVSProject(projectSettings?: ProjectSettings): boolean {
  return projectSettings?.programmingLanguage === "csharp";
}
