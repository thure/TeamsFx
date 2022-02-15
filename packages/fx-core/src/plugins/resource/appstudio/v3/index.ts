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
} from "../manifestTemplate";
import { getTemplatesFolder } from "../../../../folder";
import * as path from "path";
import fs from "fs-extra";
import {
  APP_PACKAGE_FOLDER_FOR_MULTI_ENV,
  COLOR_TEMPLATE,
  DEFAULT_COLOR_PNG_FILENAME,
  DEFAULT_OUTLINE_PNG_FILENAME,
  MANIFEST_RESOURCES,
  OUTLINE_TEMPLATE,
} from "../constants";
import { TelemetryUtils, TelemetryEventName, TelemetryPropertyKey } from "../utils/telemetry";
import { AppStudioPluginImpl } from "./plugin";

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
  async init(ctx: v2.Context, inputs: v2.InputsWithProjectPath): Promise<Result<any, FxError>> {
    TelemetryUtils.init(ctx);
    TelemetryUtils.sendStartEvent(TelemetryEventName.init);
    const res = await init(inputs.projectPath, ctx.projectSetting.appName);
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
    capability: "staticTab" | "configurableTab" | "Bot" | "MessageExtension"
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
    const result = await this.appStudioPluginImpl.createTeamsApp(
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
    envInfo: v3.EnvInfoV3
  ): Promise<Result<Void, FxError>> {
    return ok(Void);
  }

  async publishTeamsApp(
    ctx: v2.Context,
    inputs: v2.InputsWithProjectPath,
    envInfo: v3.EnvInfoV3
  ): Promise<Result<Void, FxError>> {
    return ok(Void);
  }
}
