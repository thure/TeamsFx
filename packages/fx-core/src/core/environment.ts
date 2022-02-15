// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  ConfigFolderName,
  ConfigMap,
  CryptoProvider,
  EnvStateFileNameTemplate,
  EnvConfig,
  err,
  FxError,
  ok,
  StatesFolderName,
  Result,
  SystemError,
  InputConfigsFolderName,
  EnvConfigFileNameTemplate,
  EnvNamePlaceholder,
  EnvInfo,
  Json,
  v3,
  ExistingAppConfig,
  ExistingTeamsAppType,
} from "@microsoft/teamsfx-api";
import path, { basename } from "path";
import fs from "fs-extra";
import * as dotenv from "dotenv";
import {
  dataNeedEncryption,
  replaceTemplateWithUserData,
  PathNotExistError,
  serializeDict,
  separateSecretData,
  WriteFileError,
  mapToJson,
  objectToMap,
  ProjectEnvNotExistError,
  InvalidEnvConfigError,
} from "..";
import { GLOBAL_CONFIG } from "../plugins/solution/fx-solution/constants";
import { Component, sendTelemetryErrorEvent, TelemetryEvent } from "../common/telemetry";
import { compileHandlebarsTemplateString } from "../common";
import Ajv from "ajv";
import * as draft6MetaSchema from "ajv/dist/refs/json-schema-draft-06.json";
import * as envConfigSchema from "@microsoft/teamsfx-api/build/schemas/envConfig.json";
import { ConstantString, ManifestVariables } from "../common/constants";

export interface EnvStateFiles {
  envState: string;
  userDataFile: string;
}

export const envPrefix = "$env.";

class EnvironmentManager {
  public readonly envNameRegex = /^[\w\d-_]+$/;
  public readonly envConfigNameRegex = /^config\.(?<envName>[\w\d-_]+)\.json$/i;
  public readonly envStateNameRegex = /^state\.(?<envName>[\w\d-_]+)\.json$/i;

  public readonly schema = "https://aka.ms/teamsfx-env-config-schema";
  public readonly envConfigDescription =
    `You can customize the TeamsFx config for different environments.` +
    ` Visit https://aka.ms/teamsfx-env-config to learn more about this.`;

  private readonly defaultEnvName = "dev";
  private readonly ajv;
  private readonly localEnvName = "local";

  constructor() {
    this.ajv = new Ajv();
    this.ajv.addMetaSchema(draft6MetaSchema);
  }

  public async loadEnvInfo(
    projectPath: string,
    cryptoProvider: CryptoProvider,
    envName?: string,
    isV3 = false
  ): Promise<Result<EnvInfo | v3.EnvInfoV3, FxError>> {
    if (!(await fs.pathExists(projectPath))) {
      return err(PathNotExistError(projectPath));
    }

    envName = envName ?? this.getDefaultEnvName();
    const configResult = await this.loadEnvConfig(projectPath, envName);
    if (configResult.isErr()) {
      return err(configResult.error);
    }

    const stateResult = await this.loadEnvState(projectPath, envName, cryptoProvider, isV3);
    if (stateResult.isErr()) {
      return err(stateResult.error);
    }
    if (isV3)
      return ok({
        envName,
        config: configResult.value as Json,
        state: stateResult.value as v3.ResourceStates,
      });
    else
      return ok({
        envName,
        config: configResult.value,
        state: stateResult.value as Map<string, any>,
      });
  }

  public newEnvConfigData(appName: string, existingAppConfig?: ExistingAppConfig): EnvConfig {
    const envConfig: EnvConfig = {
      $schema: this.schema,
      description: this.envConfigDescription,
      manifest: {
        appName: {
          short: appName,
          full: `Full name for ${appName}`,
        },
      },
    };

    if (!existingAppConfig || !existingAppConfig.isCreatedFromExistingApp) {
      return envConfig;
    }

    // Common settings for existing app.
    envConfig.manifest[ManifestVariables.DeveloperWebsiteUrl] = "";
    envConfig.manifest[ManifestVariables.DeveloperPrivacyUrl] = "";
    envConfig.manifest[ManifestVariables.DeveloperTermsOfUseUrl] = "";

    // Settings to build a static Tab app from existing app.
    if (existingAppConfig.newAppTypes.indexOf(ExistingTeamsAppType.StaticTab) !== -1) {
      envConfig.manifest[ManifestVariables.TabContentUrl] = "";
      envConfig.manifest[ManifestVariables.TabWebsiteUrl] = "";
    }

    // Settings to build a configurable Tab app from existing app.
    if (existingAppConfig.newAppTypes.indexOf(ExistingTeamsAppType.ConfigurableTab) !== -1) {
      envConfig.manifest[ManifestVariables.TabConfigurationUrl] = "";
    }

    // Settings to build a Bot/ME app from existing app.
    if (
      existingAppConfig.newAppTypes.indexOf(ExistingTeamsAppType.Bot) !== -1 ||
      existingAppConfig.newAppTypes.indexOf(ExistingTeamsAppType.MessageExtension) !== -1
    ) {
      envConfig.manifest[ManifestVariables.BotId] = "";
    }

    return envConfig;
  }

  public async writeEnvConfig(
    projectPath: string,
    envConfig: EnvConfig,
    envName?: string
  ): Promise<Result<string, FxError>> {
    if (!(await fs.pathExists(projectPath))) {
      return err(PathNotExistError(projectPath));
    }

    const envConfigsFolder = this.getEnvConfigsFolder(projectPath);
    if (!(await fs.pathExists(envConfigsFolder))) {
      await fs.ensureDir(envConfigsFolder);
    }

    envName = envName ?? this.getDefaultEnvName();
    const envConfigPath = this.getEnvConfigPath(envName, projectPath);

    try {
      await fs.writeFile(envConfigPath, JSON.stringify(envConfig, null, 4));
    } catch (error) {
      return err(WriteFileError(error));
    }

    return ok(envConfigPath);
  }

  public async writeEnvState(
    envData: Map<string, any> | Json,
    projectPath: string,
    cryptoProvider: CryptoProvider,
    envName?: string,
    isV3?: boolean
  ): Promise<Result<string, FxError>> {
    if (!(await fs.pathExists(projectPath))) {
      return err(PathNotExistError(projectPath));
    }

    const envStatesFolder = this.getEnvStatesFolder(projectPath);
    if (!(await fs.pathExists(envStatesFolder))) {
      await fs.ensureDir(envStatesFolder);
    }

    envName = envName ?? this.getDefaultEnvName();
    const envFiles = this.getEnvStateFilesPath(envName, projectPath);

    const data: Json = envData instanceof Map ? mapToJson(envData) : envData;
    const secrets = isV3
      ? separateSecretDataV3(data as v3.ResourceStates)
      : separateSecretData(data);
    this.encrypt(secrets, cryptoProvider);

    try {
      await fs.writeFile(envFiles.envState, JSON.stringify(data, null, 4));
      await fs.writeFile(envFiles.userDataFile, serializeDict(secrets));
    } catch (error) {
      return err(WriteFileError(error));
    }

    return ok(envFiles.envState);
  }

  public async listAllEnvConfigs(projectPath: string): Promise<Result<Array<string>, FxError>> {
    if (!(await fs.pathExists(projectPath))) {
      return err(PathNotExistError(projectPath));
    }

    const envConfigsFolder = this.getEnvConfigsFolder(projectPath);
    if (!(await fs.pathExists(envConfigsFolder))) {
      return ok([]);
    }

    const configFiles = await fs.readdir(envConfigsFolder);
    const envNames = configFiles
      .map((file) => this.getEnvNameFromPath(file))
      .filter((name): name is string => name !== null);

    return ok(envNames);
  }

  public async listRemoteEnvConfigs(projectPath: string): Promise<Result<Array<string>, FxError>> {
    if (!(await fs.pathExists(projectPath))) {
      return err(PathNotExistError(projectPath));
    }

    const envConfigsFolder = this.getEnvConfigsFolder(projectPath);
    if (!(await fs.pathExists(envConfigsFolder))) {
      return ok([]);
    }

    const configFiles = await fs.readdir(envConfigsFolder);
    const envNames = configFiles
      .map((file) => this.getEnvNameFromPath(file))
      .filter((name): name is string => name !== null && name !== this.getLocalEnvName());

    return ok(envNames);
  }

  public async checkEnvExist(projectPath: string, env: string): Promise<Result<boolean, FxError>> {
    const envList = await environmentManager.listAllEnvConfigs(projectPath);
    if (envList.isErr()) {
      return err(envList.error);
    }
    if (envList.value?.indexOf(env) >= 0) {
      return ok(true);
    } else {
      return ok(false);
    }
  }

  public isEnvConfig(projectPath: string, filePath: string): boolean {
    const fileName = path.basename(filePath);
    const fileDirname = path.dirname(filePath);
    const configFolder = this.getEnvConfigsFolder(projectPath);
    const relativeFilePath = path.relative(configFolder, fileDirname);

    if (relativeFilePath !== "") {
      return false;
    }

    const match = fileName.match(environmentManager.envConfigNameRegex);
    return match !== null;
  }

  public getEnvConfigPath(envName: string, projectPath: string): string {
    const basePath = this.getEnvConfigsFolder(projectPath);
    return path.resolve(basePath, EnvConfigFileNameTemplate.replace(EnvNamePlaceholder, envName));
  }

  public getEnvStateFilesPath(envName: string, projectPath: string): EnvStateFiles {
    const basePath = this.getEnvStatesFolder(projectPath);
    const envState = path.resolve(
      basePath,
      EnvStateFileNameTemplate.replace(EnvNamePlaceholder, envName)
    );
    const userDataFile = path.resolve(basePath, `${envName}.userdata`);

    return { envState: envState, userDataFile };
  }

  private async loadEnvConfig(
    projectPath: string,
    envName: string
  ): Promise<Result<EnvConfig, FxError>> {
    const envConfigPath = this.getEnvConfigPath(envName, projectPath);
    if (!(await fs.pathExists(envConfigPath))) {
      return err(ProjectEnvNotExistError(envName));
    }

    const validate = this.ajv.compile<EnvConfig>(envConfigSchema);
    let data;
    try {
      data = await fs.readFile(envConfigPath, ConstantString.UTF8Encoding);

      // resolve environment variables
      data = this.expandEnvironmentVariables(data);
      data = JSON.parse(data);
    } catch (error) {
      return err(InvalidEnvConfigError(envName, `Failed to read env config JSON: ${error}`));
    }

    if (validate(data)) {
      return ok(data);
    }

    return err(InvalidEnvConfigError(envName, JSON.stringify(validate.errors)));
  }

  private async loadEnvState(
    projectPath: string,
    envName: string,
    cryptoProvider: CryptoProvider,
    isV3 = false
  ): Promise<Result<Map<string, any> | v3.ResourceStates, FxError>> {
    const envFiles = this.getEnvStateFilesPath(envName, projectPath);
    const userDataResult = await this.loadUserData(envFiles.userDataFile, cryptoProvider);
    if (userDataResult.isErr()) {
      return err(userDataResult.error);
    }
    const userData = userDataResult.value;

    if (!(await fs.pathExists(envFiles.envState))) {
      const data = new Map<string, any>([[GLOBAL_CONFIG, new ConfigMap()]]);

      return ok(data);
    }

    const template = await fs.readFile(envFiles.envState, { encoding: "utf-8" });
    const result = replaceTemplateWithUserData(template, userData);
    const resultJson: Json = JSON.parse(result);
    if (isV3) return ok(resultJson as v3.ResourceStates);
    const data = objectToMap(resultJson);

    return ok(data as Map<string, any>);
  }

  private expandEnvironmentVariables(templateContent: string): string {
    if (!templateContent) {
      return templateContent;
    }

    return compileHandlebarsTemplateString(templateContent, { $env: process.env });
  }

  private getEnvNameFromPath(filePath: string): string | null {
    const match = this.envConfigNameRegex.exec(filePath);
    if (match != null && match.groups != null) {
      return match.groups.envName;
    }

    return null;
  }

  private getConfigFolder(projectPath: string): string {
    return path.resolve(projectPath, `.${ConfigFolderName}`);
  }

  private getStatesFolder(projectPath: string): string {
    return path.resolve(this.getConfigFolder(projectPath), StatesFolderName);
  }

  private getEnvStatesFolder(projectPath: string): string {
    return this.getStatesFolder(projectPath);
  }

  public getEnvConfigsFolder(projectPath: string): string {
    return path.resolve(this.getConfigFolder(projectPath), InputConfigsFolderName);
  }

  private async loadUserData(
    userDataPath: string,
    cryptoProvider: CryptoProvider
  ): Promise<Result<Record<string, string>, FxError>> {
    if (!(await fs.pathExists(userDataPath))) {
      return ok({});
    }

    const content = await fs.readFile(userDataPath, "UTF-8");
    const secrets = dotenv.parse(content);

    const res = this.decrypt(secrets, cryptoProvider);
    if (res.isErr()) {
      const fxError: SystemError = res.error;
      const fileName = basename(userDataPath);
      fxError.message = `Project update failed because of ${fxError.name}(file:${fileName}):${fxError.message}, if your local file '*.userdata' is not modified, please report to us by click 'Report Issue' button.`;
      fxError.userData = `file: ${fileName}\n------------FILE START--------\n${content}\n------------FILE END----------`;
      sendTelemetryErrorEvent(Component.core, TelemetryEvent.DecryptUserdata, fxError);
    }
    return res;
  }

  private encrypt(
    secrets: Record<string, string>,
    cryptoProvider: CryptoProvider
  ): Result<Record<string, string>, FxError> {
    for (const secretKey of Object.keys(secrets)) {
      if (!dataNeedEncryption(secretKey)) {
        continue;
      }
      const encryptedSecret = cryptoProvider.encrypt(secrets[secretKey]);
      // always success
      if (encryptedSecret.isOk()) {
        secrets[secretKey] = encryptedSecret.value;
      }
    }

    return ok(secrets);
  }

  private decrypt(
    secrets: Record<string, string>,
    cryptoProvider: CryptoProvider
  ): Result<Record<string, string>, FxError> {
    for (const secretKey of Object.keys(secrets)) {
      if (!dataNeedEncryption(secretKey)) {
        continue;
      }

      const secretValue = secrets[secretKey];
      const plaintext = cryptoProvider.decrypt(secretValue);
      if (plaintext.isErr()) {
        return err(plaintext.error);
      }

      secrets[secretKey] = plaintext.value;
    }

    return ok(secrets);
  }

  public getDefaultEnvName() {
    return this.defaultEnvName;
  }

  public getLocalEnvName() {
    return this.localEnvName;
  }
}

export function separateSecretDataV3(envState: v3.ResourceStates): Record<string, string> {
  const res: Record<string, string> = {};
  for (const key of Object.keys(envState)) {
    const config = envState[key] as v3.CloudResource;
    if (config.secretFields && config.secretFields.length > 0) {
      config.secretFields.forEach((f: string) => {
        const keyName = `${key}.${f}`;
        res[keyName] = config[f];
        config[f] = `{{${keyName}}}`;
      });
    }
  }
  return res;
}

export const environmentManager = new EnvironmentManager();
