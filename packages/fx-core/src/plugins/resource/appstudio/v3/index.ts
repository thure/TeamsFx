// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  FxError,
  Result,
  err,
  v2,
  TeamsAppManifest,
  PluginContext,
  ok,
  Json,
  TokenProvider,
  Void,
  v3,
  AppStudioTokenProvider,
  UserError,
} from "@microsoft/teamsfx-api";
import { Service } from "typedi";
import { BuiltInFeaturePluginNames } from "../../../solution/fx-solution/v3/constants";
import { convert2PluginContext } from "../../utils4v2";
import { AppStudioResultFactory } from "../results";
import { AppStudioError } from "../errors";
import {
  init,
  addCapabilities,
  loadManifest,
  saveManifest,
  capabilityExceedLimit,
  updateCapability,
  deleteCapability,
} from "../manifestTemplate";
import { getTemplatesFolder } from "../../../../folder";
import * as path from "path";
import fs from "fs-extra";
import {
  APP_PACKAGE_FOLDER_FOR_MULTI_ENV,
  COLOR_TEMPLATE,
  Constants,
  DEFAULT_COLOR_PNG_FILENAME,
  DEFAULT_OUTLINE_PNG_FILENAME,
  ErrorMessages,
  MANIFEST_RESOURCES,
  OUTLINE_TEMPLATE,
} from "../constants";
import { TelemetryUtils, TelemetryEventName, TelemetryPropertyKey } from "../utils/telemetry";
import { AppStudioPluginImpl } from "./plugin";
import { ResourcePermission, TeamsAppAdmin } from "../../../../common/permissionInterface";
import isUUID from "validator/lib/isUUID";
import { AppStudioClient } from "../appStudio";
import { IUserList } from "../interfaces/IAppDefinition";

@Service(BuiltInFeaturePluginNames.appStudio)
export class AppStudioPluginV3 {
  name = "fx-resource-appstudio";
  displayName = "App Studio";

  private appStudioPluginImpl = new AppStudioPluginImpl();

  /**
   * Generate initial manifest template file, for both local debug & remote
   * @param ctx
   * @param inputs
   * @returns
   */
  async init(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    existingApp = false
  ): Promise<Result<any, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.init);
    const res = await init(inputs.projectPath, ctx.projectSetting.appName, existingApp);
    if (res.isErr()) return err(res.error);
    const templatesFolder = getTemplatesFolder();
    const defaultColorPath = path.join(templatesFolder, COLOR_TEMPLATE);
    const defaultOutlinePath = path.join(templatesFolder, OUTLINE_TEMPLATE);
    const appPackageDir = path.resolve(inputs.projectPath, APP_PACKAGE_FOLDER_FOR_MULTI_ENV);
    const resourcesDir = path.resolve(appPackageDir, MANIFEST_RESOURCES);
    await fs.ensureDir(resourcesDir);
    await fs.copy(defaultColorPath, path.join(resourcesDir, DEFAULT_COLOR_PNG_FILENAME));
    await fs.copy(defaultOutlinePath, path.join(resourcesDir, DEFAULT_OUTLINE_PNG_FILENAME));
    TelemetryUtils.sendSuccessEvent(TelemetryEventName.init);
    return ok(undefined);
  }

  /**
   * Append capabilities to manifest templates
   * @param ctx
   * @param inputs
   * @param capabilities
   * @returns
   */
  async addCapabilities(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    capabilities: v3.ManifestCapability[]
  ): Promise<Result<any, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.addCapability);
    const pluginContext: PluginContext = convert2PluginContext(this.name, ctx, inputs);
    capabilities.map(async (capability) => {
      const exceedLimit = await this.capabilityExceedLimit(ctx, inputs, capability.name);
      if (exceedLimit.isErr()) {
        return err(exceedLimit.error);
      }
      if (exceedLimit.value) {
        return err(
          AppStudioResultFactory.UserError(
            AppStudioError.CapabilityExceedLimitError.name,
            AppStudioError.CapabilityExceedLimitError.message(capability.name)
          )
        );
      }
    });
    const res = await addCapabilities(pluginContext.root, capabilities);
    if (res.isOk()) {
      TelemetryUtils.sendSuccessEvent(TelemetryEventName.addCapability);
    } else {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.addCapability, res.error);
    }
    return res;
  }

  /**
   * Update existing manifest template
   * @param ctx
   * @param inputs
   * @param capability
   */
  async updateCapability(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    capability: v3.ManifestCapability
  ): Promise<Result<any, FxError>> {
    return await updateCapability(inputs.projectPath, capability);
  }

  /**
   * Delete existing manifest template
   * @param ctx
   * @param inputs
   * @param capability
   */
  async deleteCapability(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    capability: v3.ManifestCapability
  ): Promise<Result<any, FxError>> {
    return await deleteCapability(inputs.projectPath, capability);
  }

  /**
   * Should conside both local and remote
   * @returns
   */
  async loadManifest(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath
  ): Promise<Result<{ local: TeamsAppManifest; remote: TeamsAppManifest }, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.loadManifest);
    const pluginContext: PluginContext = convert2PluginContext(this.name, ctx, inputs);
    const localManifest = await loadManifest(pluginContext.root, true);
    if (localManifest.isErr()) {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.loadManifest, localManifest.error);
      return err(localManifest.error);
    }

    const remoteManifest = await loadManifest(pluginContext.root, false);
    if (remoteManifest.isErr()) {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.loadManifest, remoteManifest.error);
      return err(remoteManifest.error);
    }

    TelemetryUtils.sendSuccessEvent(TelemetryEventName.loadManifest);
    return ok({ local: localManifest.value, remote: remoteManifest.value });
  }

  /**
   * Save manifest template file
   * @param ctx ctx.manifest
   * @param inputs
   * @returns
   */
  async saveManifest(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    manifest: { local: TeamsAppManifest; remote: TeamsAppManifest }
  ): Promise<Result<any, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.saveManifest);
    const pluginContext: PluginContext = convert2PluginContext(this.name, ctx, inputs);
    let res = await saveManifest(pluginContext.root, manifest.local, true);
    if (res.isErr()) {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.saveManifest, res.error);
      return err(res.error);
    }

    res = await saveManifest(pluginContext.root, manifest.remote, false);
    if (res.isErr()) {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.saveManifest, res.error);
      return err(res.error);
    }

    TelemetryUtils.sendSuccessEvent(TelemetryEventName.saveManifest);
    return ok(undefined);
  }

  /**
   * Load manifest template, and check if it exceeds the limit.
   * The limit of staticTab if 16, others are 1
   * Should check both local & remote manifest template file
   * @param capability
   * @returns
   */
  async capabilityExceedLimit(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    capability: "staticTab" | "configurableTab" | "Bot" | "MessageExtension" | "WebApplicationInfo"
  ): Promise<Result<boolean, FxError>> {
    const pluginContext: PluginContext = convert2PluginContext(this.name, ctx, inputs);
    return await capabilityExceedLimit(pluginContext.root, capability);
  }

  async registerTeamsApp(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3,
    tokenProvider: TokenProvider
  ): Promise<Result<string, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.provisionManifest);
    const result = await this.appStudioPluginImpl.createOrUpdateTeamsApp(
      ctx,
      inputs,
      envInfo,
      tokenProvider
    );
    if (result.isOk()) {
      const properties: { [key: string]: string } = {};
      properties[TelemetryPropertyKey.appId] = result.value;
      TelemetryUtils.sendSuccessEvent(TelemetryEventName.provisionManifest);
    } else {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.provisionManifest, result.error);
    }
    return result;
  }

  async updateTeamsApp(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3,
    tokenProvider: TokenProvider
  ): Promise<Result<string, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.updateManifest);
    const result = await this.appStudioPluginImpl.createOrUpdateTeamsApp(
      ctx,
      inputs,
      envInfo,
      tokenProvider
    );
    if (result.isOk()) {
      const properties: { [key: string]: string } = {};
      properties[TelemetryPropertyKey.appId] = result.value;
      TelemetryUtils.sendSuccessEvent(TelemetryEventName.updateManifest);
    } else {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.updateManifest, result.error);
    }
    return result;
  }

  async publishTeamsApp(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3,
    tokenProvider: AppStudioTokenProvider
  ): Promise<Result<Void, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.publish);
    const result = await this.appStudioPluginImpl.publishTeamsApp(
      ctx,
      inputs,
      envInfo,
      tokenProvider
    );
    if (result.isOk()) {
      const properties: { [key: string]: string } = {};
      properties[TelemetryPropertyKey.publishedAppId] = result.value.publishedAppId;
      properties[TelemetryPropertyKey.updateExistingApp] = String(result.value.update);
      TelemetryUtils.sendSuccessEvent(TelemetryEventName.publish);
    } else {
      TelemetryUtils.sendErrorEvent(TelemetryEventName.publish, result.error);
    }
    return result;
  }

  private async getTeamsAppId(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3
  ): Promise<string> {
    let teamsAppId = "";
    // User may manually update id in manifest template file, rather than configuration file
    // The id in manifest template file should override configurations
    const manifestResult = await this.loadManifest(ctx, inputs);
    if (manifestResult.isOk()) {
      teamsAppId = manifestResult.value.remote.id;
    }
    if (!isUUID(teamsAppId)) {
      teamsAppId = (envInfo.state[this.name] as v3.TeamsAppResource).teamsAppId;
    }
    return teamsAppId;
  }

  async listCollaborator(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3,
    appStudioTokenProvider: AppStudioTokenProvider
  ): Promise<Result<TeamsAppAdmin[], FxError>> {
    const teamsAppId = await this.getTeamsAppId(ctx, inputs, envInfo);
    if (!teamsAppId) {
      return err(
        new UserError(
          "GetConfigError",
          ErrorMessages.GetConfigError(Constants.TEAMS_APP_ID, this.name),
          Constants.PLUGIN_NAME
        )
      );
    }

    const appStudioToken = await appStudioTokenProvider.getAccessToken();
    let userLists;
    try {
      userLists = await AppStudioClient.getUserList(teamsAppId, appStudioToken as string);
      if (!userLists) {
        return ok([]);
      }
    } catch (error: any) {
      if (error.name === 404) {
        error.message = ErrorMessages.TeamsAppNotFound(teamsAppId);
      }
      throw error;
    }

    const teamsAppAdmin: TeamsAppAdmin[] = userLists
      .filter((userList) => {
        return userList.isAdministrator;
      })
      .map((userList) => {
        return {
          userObjectId: userList.aadId,
          displayName: userList.displayName,
          userPrincipalName: userList.userPrincipalName,
          resourceId: teamsAppId,
        };
      });

    return ok(teamsAppAdmin);
  }

  async checkPermission(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3,
    appStudioTokenProvider: AppStudioTokenProvider,
    userInfo: IUserList
  ): Promise<Result<ResourcePermission[], FxError>> {
    const appStudioToken = await appStudioTokenProvider.getAccessToken();

    const teamsAppId = await this.getTeamsAppId(ctx, inputs, envInfo);
    if (!teamsAppId) {
      return err(
        new UserError(
          "GetConfigError",
          ErrorMessages.GetConfigError(Constants.TEAMS_APP_ID, this.name),
          Constants.PLUGIN_NAME
        )
      );
    }

    const teamsAppRoles = await AppStudioClient.checkPermission(
      teamsAppId,
      appStudioToken as string,
      userInfo.aadId
    );

    const result: ResourcePermission[] = [
      {
        name: Constants.PERMISSIONS.name,
        roles: [teamsAppRoles as string],
        type: Constants.PERMISSIONS.type,
        resourceId: teamsAppId,
      },
    ];

    return ok(result);
  }

  public async grantPermission(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3,
    appStudioTokenProvider: AppStudioTokenProvider,
    userInfo: IUserList
  ): Promise<Result<ResourcePermission[], FxError>> {
    const appStudioToken = await appStudioTokenProvider.getAccessToken();

    const teamsAppId = await this.getTeamsAppId(ctx, inputs, envInfo);
    if (!teamsAppId) {
      return err(
        new UserError(
          AppStudioError.GrantPermissionFailedError.name,
          AppStudioError.GrantPermissionFailedError.message(
            ErrorMessages.GetConfigError(Constants.TEAMS_APP_ID, this.name)
          ),
          Constants.PLUGIN_NAME
        )
      );
    }

    try {
      await AppStudioClient.grantPermission(teamsAppId, appStudioToken as string, userInfo);
    } catch (error: any) {
      return err(
        new UserError(
          AppStudioError.GrantPermissionFailedError.name,
          AppStudioError.GrantPermissionFailedError.message(error?.message, teamsAppId),
          Constants.PLUGIN_NAME
        )
      );
    }
    const result: ResourcePermission[] = [
      {
        name: Constants.PERMISSIONS.name,
        roles: [Constants.PERMISSIONS.admin],
        type: Constants.PERMISSIONS.type,
        resourceId: teamsAppId,
      },
    ];
    return ok(result);
  }
}
