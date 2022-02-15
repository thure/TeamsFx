// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  ok,
  err,
  AzureSolutionSettings,
  ConfigFolderName,
  FxError,
  Result,
  PluginContext,
  TeamsAppManifest,
  LogProvider,
  AppPackageFolderName,
  BuildFolderName,
  ArchiveFolderName,
  V1ManifestFileName,
  ConfigMap,
} from "@microsoft/teamsfx-api";
import { AppStudioClient } from "./appStudio";
import { IAppDefinition, IUserList, ILanguage } from "./interfaces/IAppDefinition";
import {
  BotOptionItem,
  MessageExtensionItem,
  TabOptionItem,
} from "../../solution/fx-solution/question";
import {
  REMOTE_AAD_ID,
  LOCAL_DEBUG_BOT_DOMAIN,
  BOT_DOMAIN,
  LOCAL_WEB_APPLICATION_INFO_SOURCE,
  WEB_APPLICATION_INFO_SOURCE,
  PluginNames,
  SOLUTION_PROVISION_SUCCEEDED,
} from "../../solution/fx-solution/constants";
import { AppStudioError } from "./errors";
import { AppStudioResultFactory } from "./results";
import {
  Constants,
  TEAMS_APP_SHORT_NAME_MAX_LENGTH,
  DEFAULT_DEVELOPER_WEBSITE_URL,
  FRONTEND_ENDPOINT,
  FRONTEND_DOMAIN,
  BOT_ID,
  REMOTE_MANIFEST,
  ErrorMessages,
  MANIFEST_TEMPLATE,
  TEAMS_APP_MANIFEST_TEMPLATE_FOR_MULTI_ENV,
  STATIC_TABS_TPL_FOR_MULTI_ENV,
  CONFIGURABLE_TABS_TPL_FOR_MULTI_ENV,
  BOTS_TPL_FOR_MULTI_ENV,
  COMPOSE_EXTENSIONS_TPL_FOR_MULTI_ENV,
  MANIFEST_LOCAL,
  TEAMS_APP_MANIFEST_TEMPLATE_LOCAL_DEBUG,
  STATIC_TABS_TPL_LOCAL_DEBUG,
  CONFIGURABLE_TABS_TPL_LOCAL_DEBUG,
  BOTS_TPL_LOCAL_DEBUG,
  COMPOSE_EXTENSIONS_TPL_LOCAL_DEBUG,
  COLOR_TEMPLATE,
  OUTLINE_TEMPLATE,
  DEFAULT_COLOR_PNG_FILENAME,
  DEFAULT_OUTLINE_PNG_FILENAME,
  MANIFEST_RESOURCES,
  APP_PACKAGE_FOLDER_FOR_MULTI_ENV,
  FRONTEND_INDEX_PATH,
} from "./constants";
import AdmZip from "adm-zip";
import * as fs from "fs-extra";
import { getTemplatesFolder } from "../../..";
import path from "path";
import { getAppDirectory, isSPFxProject } from "../../../common";
import {
  LocalSettingsAuthKeys,
  LocalSettingsBotKeys,
  LocalSettingsFrontendKeys,
  LocalSettingsTeamsAppKeys,
} from "../../../common/localSettingsConstants";
import { v4 } from "uuid";
import isUUID from "validator/lib/isUUID";
import { ResourcePermission, TeamsAppAdmin } from "../../../common/permissionInterface";
import Mustache from "mustache";
import {
  getCustomizedKeys,
  replaceConfigValue,
  convertToAppDefinitionBots,
  convertToAppDefinitionMessagingExtensions,
} from "./utils/utils";
import { TelemetryPropertyKey } from "./utils/telemetry";
import _ from "lodash";
import { HelpLinks } from "../../../common/constants";
import { loadManifest } from "./manifestTemplate";
import Ajv from "ajv-draft-04";
import axios from "axios";

export class AppStudioPluginImpl {
  public commonProperties: { [key: string]: string } = {};
  private readonly ajv;

  constructor() {
    this.ajv = new Ajv({ formats: { uri: true } });
  }

  public async getAppDefinitionAndUpdate(
    ctx: PluginContext,
    isLocalDebug: boolean,
    manifest: TeamsAppManifest
  ): Promise<Result<string, FxError>> {
    let teamsAppId: Result<string, FxError>;
    const appDirectory = await getAppDirectory(ctx.root);
    const appStudioToken = await ctx.appStudioToken?.getAccessToken();

    if (isLocalDebug) {
      const appDefinitionAndManifest = await this.getAppDefinitionAndManifest(ctx, true);

      if (appDefinitionAndManifest.isErr()) {
        return err(appDefinitionAndManifest.error);
      }

      const localTeamsAppID = await this.getTeamsAppId(ctx, true);

      let createIfNotExist = false;
      if (!localTeamsAppID) {
        createIfNotExist = true;
      } else {
        const appStudioToken = await ctx?.appStudioToken?.getAccessToken();
        try {
          await AppStudioClient.getApp(localTeamsAppID, appStudioToken!, ctx.logProvider);
        } catch (error) {
          createIfNotExist = true;
        }
      }

      teamsAppId = await this.updateApp(
        ctx,
        appDefinitionAndManifest.value[0],
        appStudioToken!,
        isLocalDebug,
        createIfNotExist,
        appDirectory,
        createIfNotExist ? undefined : localTeamsAppID,
        ctx.logProvider
      );

      return teamsAppId;
    } else {
      const appDefinitionRes = await this.convertToAppDefinition(ctx, manifest, true);
      if (appDefinitionRes.isErr()) {
        return err(appDefinitionRes.error);
      }

      teamsAppId = await this.updateApp(
        ctx,
        appDefinitionRes.value,
        appStudioToken!,
        isLocalDebug,
        true,
        appDirectory,
        undefined,
        ctx.logProvider
      );

      return teamsAppId;
    }
  }

  private async getSPFxLocalDebugAppDefinitionAndUpdate(
    ctx: PluginContext,
    manifest: TeamsAppManifest
  ): Promise<Result<string, FxError>> {
    const appDirectory = await getAppDirectory(ctx.root);
    const appStudioToken = await ctx.appStudioToken?.getAccessToken();
    const localTeamsAppID = await this.getTeamsAppId(ctx, true);
    let create = !localTeamsAppID;
    if (localTeamsAppID) {
      try {
        await AppStudioClient.getApp(localTeamsAppID, appStudioToken!, ctx.logProvider);
      } catch (error) {
        create = true;
      }
    }

    const view = {
      localSettings: {
        teamsApp: {
          teamsAppId: localTeamsAppID,
        },
      },
    };
    const manifestString = Mustache.render(JSON.stringify(manifest), view);
    manifest = JSON.parse(manifestString);

    const appDefinition = await this.convertToAppDefinition(ctx, manifest, false);
    if (appDefinition.isErr()) {
      return err(appDefinition.error);
    }
    const teamsAppId = await this.updateApp(
      ctx,
      appDefinition.value,
      appStudioToken!,
      true,
      create,
      appDirectory,
      create ? undefined : localTeamsAppID,
      ctx.logProvider
    );

    return teamsAppId;
  }

  /**
   * generate app manifest template according to existing manifest
   * @param settings
   * @returns
   */
  public async createV1Manifest(ctx: PluginContext): Promise<TeamsAppManifest> {
    const archiveManifestPath = path.join(
      ctx.root,
      ArchiveFolderName,
      AppPackageFolderName,
      V1ManifestFileName
    );
    const manifestSourceRes = await this.reloadManifest(archiveManifestPath);
    if (manifestSourceRes.isErr()) {
      throw manifestSourceRes.error;
    }
    const manifestSource = manifestSourceRes.value;

    let manifestString = (await fs.readFile(archiveManifestPath)).toString();
    manifestString = this.replaceExistingValueToPlaceholder(
      manifestString,
      manifestSource.developer.websiteUrl,
      "{{{localSettings.frontend.tabEndpoint}}}"
    );
    const manifest: TeamsAppManifest = JSON.parse(manifestString);
    manifest.id = "{{localSettings.teamsApp.teamsAppId}}";
    manifest.validDomains = [];

    const includeBot = (
      ctx.projectSettings?.solutionSettings as AzureSolutionSettings
    ).activeResourcePlugins?.includes(PluginNames.BOT);
    if (includeBot) {
      if (manifest.bots !== undefined && manifest.bots.length > 0) {
        for (let index = 0; index < manifest.bots.length; ++index) {
          manifest.bots[index].botId = "{{localSettings.bot.botId}}";
        }
      }
      if (manifest.composeExtensions !== undefined && manifest.composeExtensions.length > 0) {
        for (let index = 0; index < manifest.composeExtensions.length; ++index) {
          manifest.composeExtensions[index].botId = "{{localSettings.bot.botId}}";
        }
      }
    }
    return manifest;
  }

  public async provision(ctx: PluginContext): Promise<Result<string, FxError>> {
    let remoteTeamsAppId = await this.getTeamsAppId(ctx, false);

    let create = false;
    if (!remoteTeamsAppId) {
      create = true;
    } else {
      const appStudioToken = await ctx?.appStudioToken?.getAccessToken();
      try {
        await AppStudioClient.getApp(remoteTeamsAppId, appStudioToken!, ctx.logProvider);
      } catch (error) {
        create = true;
      }
    }

    if (create) {
      const result = await this.createApp(ctx, false);
      if (result.isErr()) {
        return err(result.error);
      }
      remoteTeamsAppId = result.value.teamsAppId!;
      ctx.logProvider?.info(`Teams app created ${remoteTeamsAppId}`);
    }
    ctx.envInfo.state.get(PluginNames.APPST)?.set(Constants.TEAMS_APP_ID, remoteTeamsAppId);
    return ok(remoteTeamsAppId);
  }

  public async postProvision(ctx: PluginContext): Promise<Result<string, FxError>> {
    const remoteTeamsAppId = await this.getTeamsAppId(ctx, false);
    let manifestString: string;
    const manifestResult = await loadManifest(ctx.root, false);
    if (manifestResult.isErr()) {
      return err(manifestResult.error);
    } else {
      manifestString = JSON.stringify(manifestResult.value);
    }

    let appDefinition: IAppDefinition;
    if (isSPFxProject(ctx.projectSettings)) {
      manifestString = await this.getSPFxManifest(ctx, false);
      const appDefinitionRes = await this.convertToAppDefinition(
        ctx,
        JSON.parse(manifestString),
        false
      );
      if (appDefinitionRes.isErr()) {
        return err(appDefinitionRes.error);
      }
      appDefinition = appDefinitionRes.value;
    } else {
      const remoteManifest = await this.getAppDefinitionAndManifest(ctx, false);
      if (remoteManifest.isErr()) {
        return err(remoteManifest.error);
      }
      [appDefinition] = remoteManifest.value;
    }

    const appDirectory = await getAppDirectory(ctx.root);
    const appStudioToken = await ctx?.appStudioToken?.getAccessToken();
    const result = await this.updateApp(
      ctx,
      appDefinition,
      appStudioToken!,
      false,
      false,
      appDirectory,
      remoteTeamsAppId,
      ctx.logProvider
    );
    if (result.isErr()) {
      return err(result.error);
    }

    ctx.logProvider?.info(`Teams app updated: ${result.value}`);
    return ok(remoteTeamsAppId);
  }

  public async validateManifest(
    ctx: PluginContext,
    isLocalDebug: boolean
  ): Promise<Result<string[], FxError>> {
    let manifestString: string | undefined = undefined;
    if (isSPFxProject(ctx.projectSettings)) {
      manifestString = await this.getSPFxManifest(ctx, isLocalDebug);
      const manifest = JSON.parse(manifestString);
      if (!isUUID(manifest.id)) {
        manifest.id = v4();
      }
      manifestString = JSON.stringify(manifest, null, 4);
    } else {
      const appDefinitionAndManifest = await this.getAppDefinitionAndManifest(ctx, isLocalDebug);
      if (appDefinitionAndManifest.isErr()) {
        ctx.logProvider?.error("[Teams Toolkit] Manifest Validation failed!");
        return err(appDefinitionAndManifest.error);
      } else {
        manifestString = JSON.stringify(appDefinitionAndManifest.value[1]);
      }
    }
    const manifest: TeamsAppManifest = JSON.parse(manifestString);

    let errors: string[];
    const res = await this.validateManifestAgainstSchema(manifest);
    if (res.isOk()) {
      errors = res.value;
    } else {
      return err(res.error);
    }

    const appDirectory = await getAppDirectory(ctx.root);
    if (manifest.icons.outline) {
      if (
        manifest.icons.outline.startsWith("https://") ||
        manifest.icons.outline.startsWith("http://")
      ) {
        errors.push("icons.outline should be a relative path, URL is not supported");
      } else {
        const outlineFile = path.join(appDirectory, manifest.icons.outline);
        if (!(await fs.pathExists(outlineFile))) {
          errors.push(`icons.outline "${outlineFile}" cannot be found.`);
        }
      }
    }

    if (manifest.icons.color) {
      if (
        manifest.icons.color.startsWith("https://") ||
        manifest.icons.color.startsWith("http://")
      ) {
        errors.push("icons.color should be a relative path, URL is not supported");
      } else {
        const colorFile = path.join(appDirectory, manifest.icons.color);
        if (!(await fs.pathExists(colorFile))) {
          errors.push(`icons.color "${colorFile}" cannot be found.`);
        }
      }
    }
    return ok(errors);
  }

  public async updateManifest(
    ctx: PluginContext,
    isLocalDebug: boolean
  ): Promise<Result<string, FxError>> {
    const teamsAppId = await this.getTeamsAppId(ctx, isLocalDebug);
    let manifest: any;
    let manifestString: string;
    const manifestResult = await loadManifest(ctx.root, isLocalDebug);
    if (manifestResult.isErr()) {
      return err(manifestResult.error);
    } else {
      manifestString = JSON.stringify(manifestResult.value);
    }

    let appDefinition: IAppDefinition;
    if (isSPFxProject(ctx.projectSettings)) {
      manifestString = await this.getSPFxManifest(ctx, isLocalDebug);
      manifest = JSON.parse(manifestString);
      const appDefinitionRes = await this.convertToAppDefinition(ctx, manifest, false);
      if (appDefinitionRes.isErr()) {
        return err(appDefinitionRes.error);
      }
      appDefinition = appDefinitionRes.value;
    } else {
      const appManifest = await this.getAppDefinitionAndManifest(ctx, isLocalDebug);
      if (appManifest.isErr()) {
        ctx.logProvider?.error("[Teams Toolkit] Update manifest failed!");
        const isProvisionSucceeded = !!(ctx.envInfo.state
          .get("solution")
          ?.get(SOLUTION_PROVISION_SUCCEEDED) as boolean);
        if (
          appManifest.error.name === AppStudioError.GetRemoteConfigFailedError.name &&
          !isProvisionSucceeded
        ) {
          return err(
            AppStudioResultFactory.UserError(
              AppStudioError.GetRemoteConfigError.name,
              AppStudioError.GetRemoteConfigError.message("Update manifest failed"),
              HelpLinks.WhyNeedProvision
            )
          );
        } else {
          return err(appManifest.error);
        }
      }
      [appDefinition] = appManifest.value;
      manifest = appManifest.value[1];
    }

    const manifestFileName =
      `${ctx.root}/${BuildFolderName}/${AppPackageFolderName}/manifest.` +
      (isLocalDebug ? "local" : ctx.envInfo.envName) +
      `.json`;
    if (!(await fs.pathExists(manifestFileName))) {
      return err(
        AppStudioResultFactory.UserError(
          AppStudioError.FileNotFoundError.name,
          AppStudioError.FileNotFoundError.message(manifestFileName) +
            " Run 'Provision in the cloud' first. Click Get Help to learn more about why you need to provision.",
          HelpLinks.WhyNeedProvision
        )
      );
    }
    const existingManifest = await fs.readJSON(manifestFileName);
    delete manifest.id;
    delete existingManifest.id;
    if (!_.isEqual(manifest, existingManifest)) {
      const res = await ctx.ui?.showMessage(
        "warn",
        "The manifest file configurations has been modified already. Do you want to continue to regenerate the manifest file and update to Teams platform?",
        true,
        "Preview only",
        "Preview and update"
      );

      const error = AppStudioResultFactory.UserError(
        AppStudioError.UpdateManifestCancelError.name,
        AppStudioError.UpdateManifestCancelError.message(manifest.name.short)
      );
      if (res?.isOk() && res.value === "Preview only") {
        this.buildTeamsAppPackage(ctx, isLocalDebug);
        return err(error);
      } else if (res?.isOk() && res.value === "Preview and update") {
        this.buildTeamsAppPackage(ctx, isLocalDebug);
      } else {
        return err(error);
      }
    }

    const appStudioToken = await ctx?.appStudioToken?.getAccessToken();
    try {
      const localUpdateTime = isLocalDebug
        ? undefined
        : (ctx.envInfo.state.get(PluginNames.APPST)?.get(Constants.TEAMS_APP_UPDATED_AT) as number);
      if (localUpdateTime) {
        const app = await AppStudioClient.getApp(teamsAppId, appStudioToken!, ctx.logProvider);
        const devPortalUpdateTime = new Date(app.updatedAt!)?.getTime() ?? -1;
        if (localUpdateTime < devPortalUpdateTime) {
          const res = await ctx.ui?.showMessage(
            "warn",
            "The manifest file on Teams platform has been changed since your last update. Do you want to continue to update and overwrite the manifest file on Teams platform?",
            true,
            "Overwrite and update"
          );

          if (!(res?.isOk() && res.value === "Overwrite and update")) {
            const error = AppStudioResultFactory.UserError(
              AppStudioError.UpdateManifestCancelError.name,
              AppStudioError.UpdateManifestCancelError.message(manifest.name.short)
            );
            return err(error);
          }
        }
      }

      const appDirectory = await getAppDirectory(ctx.root);
      const result = await this.updateApp(
        ctx,
        appDefinition,
        appStudioToken!,
        isLocalDebug,
        false,
        appDirectory,
        teamsAppId,
        ctx.logProvider
      );
      if (result.isErr()) {
        return err(result.error);
      }

      ctx.logProvider?.info(`Teams app updated: ${result.value}`);
      ctx.ui?.showMessage(
        "info",
        `Successfully updated manifest for [${manifest.name.short}]`,
        false
      );
      return ok(teamsAppId);
    } catch (error) {
      if (error.message && error.message.includes("404")) {
        return err(
          AppStudioResultFactory.UserError(
            AppStudioError.UpdateManifestWithInvalidAppError.name,
            AppStudioError.UpdateManifestWithInvalidAppError.message(teamsAppId)
          )
        );
      } else {
        return err(error);
      }
    }
  }

  public async migrateV1Project(ctx: PluginContext): Promise<{ enableAuth: boolean }> {
    let manifest: TeamsAppManifest | undefined;
    const archiveAppPackageFolder = path.join(ctx.root, ArchiveFolderName, AppPackageFolderName);
    const archiveManifestPath = path.join(archiveAppPackageFolder, V1ManifestFileName);

    // cannot use getAppDirectory before creating the manifest file
    const newAppPackageFolder = `${ctx.root}/${APP_PACKAGE_FOLDER_FOR_MULTI_ENV}`;

    await fs.ensureDir(newAppPackageFolder);
    if (await fs.pathExists(archiveManifestPath)) {
      manifest = await this.createV1Manifest(ctx);

      const resourcesDir = path.join(newAppPackageFolder, MANIFEST_RESOURCES);
      await fs.ensureDir(resourcesDir);

      if (manifest?.icons?.color && !manifest.icons.color.startsWith("https://")) {
        const archiveColorFile = path.join(archiveAppPackageFolder, manifest.icons.color);
        const existColorFile = await fs.pathExists(archiveColorFile);
        const newColorFileName = existColorFile
          ? path.basename(manifest.icons.color)
          : DEFAULT_COLOR_PNG_FILENAME;
        await fs.copyFile(
          existColorFile ? archiveColorFile : path.join(getTemplatesFolder(), COLOR_TEMPLATE),
          path.join(resourcesDir, newColorFileName)
        );
        manifest.icons.color = `${MANIFEST_RESOURCES}/${newColorFileName}`;
      }

      if (manifest?.icons?.outline && !manifest.icons.outline.startsWith("https://")) {
        const archiveOutlineFile = path.join(archiveAppPackageFolder, manifest.icons.outline);
        const existOutlineFile = await fs.pathExists(archiveOutlineFile);
        const newOutlineFileName = existOutlineFile
          ? path.basename(manifest.icons.outline)
          : DEFAULT_OUTLINE_PNG_FILENAME;
        await fs.copyFile(
          existOutlineFile ? archiveOutlineFile : path.join(getTemplatesFolder(), OUTLINE_TEMPLATE),
          path.join(resourcesDir, newOutlineFileName)
        );
        manifest.icons.outline = `${MANIFEST_RESOURCES}/${newOutlineFileName}`;
      }

      await fs.writeFile(
        path.join(newAppPackageFolder, MANIFEST_LOCAL),
        JSON.stringify(manifest, null, 4)
      );

      return { enableAuth: !!manifest?.webApplicationInfo?.id };
    } else {
      await this.scaffold(ctx);
      return { enableAuth: false };
    }
  }

  public async scaffold(ctx: PluginContext): Promise<any> {
    let manifest: TeamsAppManifest | undefined;
    const templatesFolder = getTemplatesFolder();

    // cannot use getAppDirectory before creating the manifest file
    const appDir = `${ctx.root}/${APP_PACKAGE_FOLDER_FOR_MULTI_ENV}`;

    if (isSPFxProject(ctx.projectSettings)) {
      const templateManifestFolder = path.join(templatesFolder, "plugins", "resource", "spfx");
      const manifestFile = path.resolve(
        templateManifestFolder,
        "./solution/manifest_multi_env.json"
      );
      const manifestString = (await fs.readFile(manifestFile)).toString();
      manifest = JSON.parse(manifestString);
      const localManifest = await createLocalManifest(
        ctx.projectSettings!.appName,
        false,
        false,
        false,
        true,
        false
      );
      await fs.writeFile(`${appDir}/${MANIFEST_LOCAL}`, JSON.stringify(localManifest, null, 4));
    } else {
      const solutionSettings: AzureSolutionSettings = ctx.projectSettings
        ?.solutionSettings as AzureSolutionSettings;
      const hasFrontend = solutionSettings.capabilities.includes(TabOptionItem.id);
      const hasBot = solutionSettings.capabilities.includes(BotOptionItem.id);
      const hasMessageExtension = solutionSettings.capabilities.includes(MessageExtensionItem.id);
      manifest = await createManifest(
        ctx.projectSettings!.appName,
        hasFrontend,
        hasBot,
        hasMessageExtension,
        false,
        !!solutionSettings?.migrateFromV1
      );
      const localDebugManifest = await createLocalManifest(
        ctx.projectSettings!.appName,
        hasFrontend,
        hasBot,
        hasMessageExtension,
        false,
        !!solutionSettings?.migrateFromV1
      );
      await fs.writeFile(
        `${appDir}/${MANIFEST_LOCAL}`,
        JSON.stringify(localDebugManifest, null, 4)
      );
    }

    await fs.ensureDir(appDir);
    const manifestTemplatePath = `${appDir}/${MANIFEST_TEMPLATE}`;
    await fs.writeFile(manifestTemplatePath, JSON.stringify(manifest, null, 4));

    const defaultColorPath = path.join(templatesFolder, COLOR_TEMPLATE);
    const defaultOutlinePath = path.join(templatesFolder, OUTLINE_TEMPLATE);
    const resourcesDir = path.join(appDir, MANIFEST_RESOURCES);
    await fs.ensureDir(resourcesDir);
    await fs.copy(defaultColorPath, `${resourcesDir}/${DEFAULT_COLOR_PNG_FILENAME}`);
    await fs.copy(defaultOutlinePath, `${resourcesDir}/${DEFAULT_OUTLINE_PNG_FILENAME}`);

    return undefined;
  }

  public async buildTeamsAppPackage(ctx: PluginContext, isLocalDebug: boolean): Promise<string> {
    // Validate manifest
    const validationResult = await this.validateManifest(ctx, isLocalDebug);
    if (validationResult.isOk() && validationResult.value.length > 0) {
      const errMessage = AppStudioError.ValidationFailedError.message(validationResult.value);
      const validationFailed = AppStudioResultFactory.UserError(
        AppStudioError.ValidationFailedError.name,
        errMessage
      );
      throw validationFailed;
    }
    let manifestString: string | undefined = undefined;

    if (!ctx.envInfo?.envName) {
      throw new Error("Failed to get target environment name from plugin context.");
    }

    const appDirectory = await getAppDirectory(ctx.root);
    let zipFileName: string;
    if (isLocalDebug) {
      zipFileName = `${ctx.root}/${BuildFolderName}/${AppPackageFolderName}/appPackage.local.zip`;
    } else {
      zipFileName = `${ctx.root}/${BuildFolderName}/${AppPackageFolderName}/appPackage.${ctx.envInfo.envName}.zip`;
    }

    if (isSPFxProject(ctx.projectSettings)) {
      manifestString = await this.getSPFxManifest(ctx, isLocalDebug);
      const manifest = JSON.parse(manifestString);
      if (!isUUID(manifest.id)) {
        manifest.id = v4();
      }
      manifestString = JSON.stringify(manifest, null, 4);
    } else {
      const manifest = await this.getAppDefinitionAndManifest(ctx, isLocalDebug);
      if (manifest.isOk()) {
        manifestString = JSON.stringify(manifest.value[1], null, 4);
      } else {
        ctx.logProvider?.error("[Teams Toolkit] Teams Package build failed!");
        const isProvisionSucceeded = !!(ctx.envInfo.state
          .get("solution")
          ?.get(SOLUTION_PROVISION_SUCCEEDED) as boolean);
        if (
          manifest.error.name === AppStudioError.GetRemoteConfigFailedError.name &&
          !isProvisionSucceeded
        ) {
          throw AppStudioResultFactory.UserError(
            AppStudioError.GetRemoteConfigError.name,
            AppStudioError.GetRemoteConfigError.message("Teams package build failed"),
            HelpLinks.WhyNeedProvision
          );
        } else {
          throw manifest.error;
        }
      }
    }
    const status = await fs.lstat(appDirectory);
    if (!status.isDirectory()) {
      throw AppStudioResultFactory.UserError(
        AppStudioError.NotADirectoryError.name,
        AppStudioError.NotADirectoryError.message(appDirectory)
      );
    }
    const zip = new AdmZip();
    zip.addFile(Constants.MANIFEST_FILE, Buffer.from(manifestString));

    const manifest: TeamsAppManifest = JSON.parse(manifestString);

    // color icon
    if (manifest.icons.color && !manifest.icons.color.startsWith("https://")) {
      const colorFile = `${appDirectory}/${manifest.icons.color}`;
      const fileExists = await fs.pathExists(colorFile);
      if (!fileExists) {
        throw AppStudioResultFactory.UserError(
          AppStudioError.FileNotFoundError.name,
          AppStudioError.FileNotFoundError.message(colorFile)
        );
      }

      const dir = path.dirname(manifest.icons.color);
      zip.addLocalFile(colorFile, dir === "." ? "" : dir);
    }

    // outline icon
    if (manifest.icons.outline && !manifest.icons.outline.startsWith("https://")) {
      const outlineFile = `${appDirectory}/${manifest.icons.outline}`;
      const fileExists = await fs.pathExists(outlineFile);
      if (!fileExists) {
        throw AppStudioResultFactory.UserError(
          AppStudioError.FileNotFoundError.name,
          AppStudioError.FileNotFoundError.message(outlineFile)
        );
      }

      const dir = path.dirname(manifest.icons.outline);
      zip.addLocalFile(outlineFile, dir === "." ? "" : dir);
    }

    await fs.ensureDir(path.dirname(zipFileName));

    const manifestFileName =
      `${ctx.root}/${BuildFolderName}/${AppPackageFolderName}/manifest.` +
      (isLocalDebug ? "local" : ctx.envInfo.envName) +
      `.json`;
    if (await fs.pathExists(manifestFileName)) {
      await fs.chmod(manifestFileName, 0o777);
    }
    await fs.writeFile(manifestFileName, manifestString);
    await fs.chmod(manifestFileName, 0o444);

    // localization file
    if (
      manifest.localizationInfo &&
      manifest.localizationInfo.additionalLanguages &&
      manifest.localizationInfo.additionalLanguages.length > 0
    ) {
      await Promise.all(
        manifest.localizationInfo.additionalLanguages.map(async function (language: any) {
          const file = language.file;
          const fileName = `${appDirectory}/${file}`;
          if (!(await fs.pathExists(fileName))) {
            throw AppStudioResultFactory.UserError(
              AppStudioError.FileNotFoundError.name,
              AppStudioError.FileNotFoundError.message(fileName)
            );
          }
          const dir = path.dirname(file);
          zip.addLocalFile(fileName, dir === "." ? "" : dir);
        })
      );
    }

    zip.writeZip(zipFileName);

    if (isSPFxProject(ctx.projectSettings)) {
      await fs.copyFile(zipFileName, `${ctx.root}/SPFx/teams/TeamsSPFxApp.zip`);
    }

    if (appDirectory === `${ctx.root}/.${ConfigFolderName}`) {
      await fs.ensureDir(path.join(ctx.root, `${AppPackageFolderName}`));

      const formerZipFileName = `${appDirectory}/appPackage.zip`;
      if (await fs.pathExists(formerZipFileName)) {
        await fs.remove(formerZipFileName);
      }

      await fs.move(
        `${appDirectory}/${manifest.icons.color}`,
        `${ctx.root}/${APP_PACKAGE_FOLDER_FOR_MULTI_ENV}/${MANIFEST_RESOURCES}/${manifest.icons.color}`
      );
      await fs.move(
        `${appDirectory}/${manifest.icons.outline}`,
        `${ctx.root}/${APP_PACKAGE_FOLDER_FOR_MULTI_ENV}/${MANIFEST_RESOURCES}/${manifest.icons.outline}`
      );
      await fs.move(
        `${appDirectory}/${REMOTE_MANIFEST}`,
        `${ctx.root}/${APP_PACKAGE_FOLDER_FOR_MULTI_ENV}/${MANIFEST_TEMPLATE}`
      );
    }

    return zipFileName;
  }

  public async publish(ctx: PluginContext): Promise<{ name: string; id: string; update: boolean }> {
    let manifest: TeamsAppManifest | undefined;

    const appDirectory = await getAppDirectory(ctx.root);
    if (isSPFxProject(ctx.projectSettings)) {
      const manifestString = await this.getSPFxManifest(ctx, false);
      manifest = JSON.parse(manifestString);
    } else {
      const fillinRes = await this.getAppDefinitionAndManifest(ctx, false);
      if (fillinRes.isOk()) {
        manifest = fillinRes.value[1];
      } else {
        throw fillinRes.error;
      }
    }

    if (!manifest) {
      throw AppStudioResultFactory.SystemError(
        AppStudioError.ManifestLoadFailedError.name,
        AppStudioError.ManifestLoadFailedError.message("")
      );
    }

    // manifest.id === externalID
    const appStudioToken = await ctx?.appStudioToken?.getAccessToken();
    const existApp = await AppStudioClient.getAppByTeamsAppId(manifest.id, appStudioToken!);
    if (existApp) {
      let executePublishUpdate = false;
      let description = `The app ${existApp.displayName} has already been submitted to tenant App Catalog.\nStatus: ${existApp.publishingState}\n`;
      if (existApp.lastModifiedDateTime) {
        description =
          description + `Last Modified: ${existApp.lastModifiedDateTime?.toLocaleString()}\n`;
      }
      description = description + "Do you want to submit a new update?";
      const res = await ctx.ui?.showMessage("warn", description, true, "Confirm");
      if (res?.isOk() && res.value === "Confirm") executePublishUpdate = true;

      if (executePublishUpdate) {
        const appId = await this.beforePublish(ctx, appDirectory, JSON.stringify(manifest), true);
        return { id: appId, name: manifest.name.short, update: true };
      } else {
        throw AppStudioResultFactory.SystemError(
          AppStudioError.TeamsAppPublishCancelError.name,
          AppStudioError.TeamsAppPublishCancelError.message(manifest.name.short)
        );
      }
    } else {
      const appId = await this.beforePublish(ctx, appDirectory, JSON.stringify(manifest), false);
      return { id: appId, name: manifest.name.short, update: false };
    }
  }

  public async postLocalDebug(ctx: PluginContext): Promise<Result<string, FxError>> {
    let teamsAppId;
    const manifest = await loadManifest(ctx.root, true);
    if (manifest.isErr()) {
      return err(manifest.error);
    }
    if (isSPFxProject(ctx.projectSettings)) {
      teamsAppId = await this.getSPFxLocalDebugAppDefinitionAndUpdate(ctx, manifest.value);
    } else {
      teamsAppId = await this.getAppDefinitionAndUpdate(ctx, true, manifest.value);
    }
    if (teamsAppId.isErr()) {
      return teamsAppId;
    }
    ctx.localSettings?.teamsApp?.set(Constants.TEAMS_APP_ID, teamsAppId.value);
    return ok(teamsAppId.value);
  }

  public async checkPermission(
    ctx: PluginContext,
    userInfo: IUserList
  ): Promise<ResourcePermission[]> {
    const appStudioToken = await ctx?.appStudioToken?.getAccessToken();

    const teamsAppId = await this.getTeamsAppId(ctx, false);
    if (!teamsAppId) {
      throw new Error(ErrorMessages.GetConfigError(Constants.TEAMS_APP_ID, PluginNames.APPST));
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

    return result;
  }

  public async listCollaborator(ctx: PluginContext): Promise<TeamsAppAdmin[]> {
    const appStudioToken = await ctx?.appStudioToken?.getAccessToken();
    const teamsAppId = await this.getTeamsAppId(ctx, false);
    if (!teamsAppId) {
      throw new Error(ErrorMessages.GetConfigError(Constants.TEAMS_APP_ID, PluginNames.APPST));
    }

    let userLists;
    try {
      userLists = await AppStudioClient.getUserList(teamsAppId, appStudioToken as string);
      if (!userLists) {
        return [];
      }
    } catch (error) {
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

    return teamsAppAdmin;
  }

  public async grantPermission(
    ctx: PluginContext,
    userInfo: IUserList
  ): Promise<ResourcePermission[]> {
    const appStudioToken = await ctx?.appStudioToken?.getAccessToken();

    const teamsAppId = await this.getTeamsAppId(ctx, false);
    if (!teamsAppId) {
      throw new Error(
        AppStudioError.GrantPermissionFailedError.message(
          ErrorMessages.GetConfigError(Constants.TEAMS_APP_ID, PluginNames.APPST)
        )
      );
    }

    try {
      await AppStudioClient.grantPermission(teamsAppId, appStudioToken as string, userInfo);
    } catch (error) {
      throw new Error(
        AppStudioError.GrantPermissionFailedError.message(error?.message, teamsAppId)
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

    return result;
  }

  private async beforePublish(
    ctx: PluginContext,
    appDirectory: string,
    manifestString: string,
    update: boolean
  ): Promise<string> {
    const manifest: TeamsAppManifest = JSON.parse(manifestString);
    const publishProgress = ctx.ui?.createProgressBar(`Publishing ${manifest.name.short}`, 3);
    try {
      // Validate manifest
      await publishProgress?.start("Validating manifest file");
      const validationResult = await this.validateManifestAgainstSchema(manifest);
      if (validationResult.isErr()) {
        throw validationResult.error;
      } else if (validationResult.value.length > 0) {
        throw AppStudioResultFactory.UserError(
          AppStudioError.ValidationFailedError.name,
          AppStudioError.ValidationFailedError.message(validationResult.value)
        );
      }

      // Update App in App Studio
      const remoteTeamsAppId = await this.getTeamsAppId(ctx, false);
      await publishProgress?.next(
        `Updating app definition for app ${remoteTeamsAppId} in app studio`
      );
      const appDefinitionRes = await this.convertToAppDefinition(ctx, manifest, true);
      if (appDefinitionRes.isErr()) {
        throw appDefinitionRes.error;
      }
      let appStudioToken = await ctx?.appStudioToken?.getAccessToken();
      const colorIconContent = manifest.icons.color
        ? (await fs.readFile(`${appDirectory}/${manifest.icons.color}`)).toString("base64")
        : undefined;
      const outlineIconContent = manifest.icons.outline
        ? (await fs.readFile(`${appDirectory}/${manifest.icons.outline}`)).toString("base64")
        : undefined;
      try {
        const app = await AppStudioClient.updateApp(
          remoteTeamsAppId,
          appDefinitionRes.value,
          appStudioToken!,
          undefined,
          colorIconContent,
          outlineIconContent
        );

        if (app.updatedAt) {
          ctx.envInfo.state
            .get(PluginNames.APPST)
            ?.set(Constants.TEAMS_APP_UPDATED_AT, new Date(app.updatedAt).getTime());
        }
      } catch (e) {
        if (e.name === 404) {
          throw AppStudioResultFactory.UserError(
            AppStudioError.TeamsAppNotFoundError.name,
            AppStudioError.TeamsAppNotFoundError.message(remoteTeamsAppId)
          );
        }
      }

      // Build Teams App package
      // Platforms will be checked in buildTeamsAppPackage(ctx)
      await publishProgress?.next(`Building Teams app package in ${appDirectory}.`);
      const appPackage = await this.buildTeamsAppPackage(ctx, false);

      const appContent = await fs.readFile(appPackage);
      appStudioToken = await ctx.appStudioToken?.getAccessToken();
      await publishProgress?.next(`Publishing ${manifest.name.short}`);
      if (update) {
        // Update existing app in App Catalog
        return await AppStudioClient.publishTeamsAppUpdate(
          manifest.id,
          appContent,
          appStudioToken!
        );
      } else {
        // Publish Teams App
        return await AppStudioClient.publishTeamsApp(manifest.id, appContent, appStudioToken!);
      }
    } finally {
      await publishProgress?.end(true);
    }
  }

  private replaceExistingValueToPlaceholder(
    config: string,
    value: string,
    placeholderName: string
  ): string {
    if (config && value && placeholderName) {
      config = config.split(value).join(placeholderName);
    }

    return config;
  }

  private async reloadManifest(manifestPath: string): Promise<Result<TeamsAppManifest, FxError>> {
    try {
      const manifest = await fs.readJson(manifestPath);
      if (!manifest) {
        return err(
          AppStudioResultFactory.SystemError(
            AppStudioError.ManifestLoadFailedError.name,
            AppStudioError.ManifestLoadFailedError.message(`Failed to load manifest file`)
          )
        );
      }
      // Object.assign(ctx.app, manifest);
      return ok(manifest);
    } catch (e) {
      if (e.stack && e.stack.startsWith("SyntaxError")) {
        return err(
          AppStudioResultFactory.UserError(
            AppStudioError.ManifestLoadFailedError.name,
            AppStudioError.ManifestLoadFailedError.message(
              `Failed to load manifest file from ${manifestPath}, due to ${e.message}`
            )
          )
        );
      }
      return err(
        AppStudioResultFactory.SystemError(
          AppStudioError.ManifestLoadFailedError.name,
          AppStudioError.ManifestLoadFailedError.message(
            `Failed to load manifest file from ${manifestPath}, due to ${e.message}`
          )
        )
      );
    }
  }

  private async getConfigForCreatingManifest(
    ctx: PluginContext,
    localDebug: boolean
  ): Promise<{
    tabEndpoint?: string;
    tabDomain?: string;
    tabIndexPath?: string;
    aadId: string;
    botDomain?: string;
    botId?: string;
    webApplicationInfoResource?: string;
    teamsAppId: string;
  }> {
    const tabEndpoint = this.getTabEndpoint(ctx, localDebug);
    const tabDomain = this.getTabDomain(ctx, localDebug);
    const tabIndexPath = this.getTabIndexPath(ctx, localDebug);
    const aadId = this.getAadClientId(ctx, localDebug);
    const botId = this.getBotId(ctx, localDebug);
    const botDomain = this.getBotDomain(ctx, localDebug);
    const teamsAppId = await this.getTeamsAppId(ctx, localDebug);

    // This config value is set by aadPlugin.setApplicationInContext. so aadPlugin.setApplicationInContext needs to run first.

    const webApplicationInfoResource = this.getApplicationIdUris(ctx, localDebug);

    return {
      tabEndpoint,
      tabDomain,
      tabIndexPath,
      aadId,
      botDomain,
      botId,
      webApplicationInfoResource,
      teamsAppId,
    };
  }

  private getTabEndpoint(ctx: PluginContext, isLocalDebug: boolean): string {
    const tabEndpoint = isLocalDebug
      ? (ctx.localSettings?.frontend?.get(LocalSettingsFrontendKeys.TabEndpoint) as string)
      : (ctx.envInfo.state.get(PluginNames.FE)?.get(FRONTEND_ENDPOINT) as string);

    return tabEndpoint;
  }

  private getTabDomain(ctx: PluginContext, isLocalDebug: boolean): string {
    const tabDomain = isLocalDebug
      ? (ctx.localSettings?.frontend?.get(LocalSettingsFrontendKeys.TabDomain) as string)
      : (ctx.envInfo.state.get(PluginNames.FE)?.get(FRONTEND_DOMAIN) as string);
    return tabDomain;
  }

  private getTabIndexPath(ctx: PluginContext, isLocalDebug: boolean): string {
    const tabIndexPath = isLocalDebug
      ? (ctx.localSettings?.frontend?.get(LocalSettingsFrontendKeys.TabIndexPath) as string)
      : (ctx.envInfo.state.get(PluginNames.FE)?.get(FRONTEND_INDEX_PATH) as string);
    return tabIndexPath;
  }

  private getAadClientId(ctx: PluginContext, isLocalDebug: boolean): string {
    const clientId = isLocalDebug
      ? (ctx.localSettings?.auth?.get(LocalSettingsAuthKeys.ClientId) as string)
      : (ctx.envInfo.state.get(PluginNames.AAD)?.get(REMOTE_AAD_ID) as string);

    return clientId;
  }

  private getBotId(ctx: PluginContext, isLocalDebug: boolean): string {
    const botId = isLocalDebug
      ? (ctx.localSettings?.bot?.get(LocalSettingsBotKeys.BotId) as string)
      : (ctx.envInfo.state.get(PluginNames.BOT)?.get(BOT_ID) as string);

    return botId;
  }

  private getBotDomain(ctx: PluginContext, isLocalDebug: boolean): string {
    const botDomain = isLocalDebug
      ? (ctx.localSettings?.bot?.get(LocalSettingsBotKeys.BotDomain) as string)
      : (ctx.envInfo.state.get(PluginNames.BOT)?.get(BOT_DOMAIN) as string);

    return botDomain;
  }

  private getApplicationIdUris(ctx: PluginContext, isLocalDebug: boolean): string {
    const applicationIdUris = isLocalDebug
      ? (ctx.localSettings?.auth?.get(LocalSettingsAuthKeys.ApplicationIdUris) as string)
      : (ctx.envInfo.state.get(PluginNames.AAD)?.get(WEB_APPLICATION_INFO_SOURCE) as string);

    return applicationIdUris;
  }

  private async getTeamsAppId(ctx: PluginContext, isLocalDebug: boolean): Promise<string> {
    let teamsAppId = "";

    // User may manually update id in manifest template file, rather than configuration file
    // The id in manifest template file should override configurations
    const manifestResult = await loadManifest(ctx.root, isLocalDebug);
    if (manifestResult.isOk()) {
      teamsAppId = manifestResult.value.id;
    }
    if (!isUUID(teamsAppId)) {
      teamsAppId = isLocalDebug
        ? ctx.localSettings?.teamsApp?.get(LocalSettingsTeamsAppKeys.TeamsAppId)
        : (ctx.envInfo.state.get(PluginNames.APPST)?.get(Constants.TEAMS_APP_ID) as string);
    }
    return teamsAppId;
  }

  /**
   *
   * Refer to AppDefinitionProfile.cs
   */
  private async convertToAppDefinition(
    ctx: PluginContext,
    appManifest: TeamsAppManifest,
    ignoreIcon: boolean
  ): Promise<Result<IAppDefinition, FxError>> {
    const appDefinition: IAppDefinition = {
      appName: appManifest.name.short,
      validDomains: appManifest.validDomains,
    };

    appDefinition.showLoadingIndicator = appManifest.showLoadingIndicator;
    appDefinition.isFullScreen = appManifest.isFullScreen;
    appDefinition.appId = appManifest.id;

    appDefinition.appName = appManifest.name.short;
    appDefinition.shortName = appManifest.name.short;
    appDefinition.longName = appManifest.name.full;
    appDefinition.manifestVersion = appManifest.manifestVersion;
    appDefinition.version = appManifest.version;

    appDefinition.packageName = appManifest.packageName;
    appDefinition.accentColor = appManifest.accentColor;

    appDefinition.developerName = appManifest.developer.name;
    appDefinition.mpnId = appManifest.developer.mpnId;
    appDefinition.websiteUrl = appManifest.developer.websiteUrl;
    appDefinition.privacyUrl = appManifest.developer.privacyUrl;
    appDefinition.termsOfUseUrl = appManifest.developer.termsOfUseUrl;

    appDefinition.shortDescription = appManifest.description.short;
    appDefinition.longDescription = appManifest.description.full;

    appDefinition.staticTabs = appManifest.staticTabs;
    appDefinition.configurableTabs = appManifest.configurableTabs;

    appDefinition.bots = convertToAppDefinitionBots(appManifest);
    appDefinition.messagingExtensions = convertToAppDefinitionMessagingExtensions(appManifest);

    appDefinition.connectors = appManifest.connectors;
    appDefinition.devicePermissions = appManifest.devicePermissions;
    if (appManifest.localizationInfo) {
      let languages: ILanguage[] = [];
      if (appManifest.localizationInfo.additionalLanguages) {
        try {
          languages = await Promise.all(
            appManifest.localizationInfo.additionalLanguages!.map(async function (item: any) {
              const templateDirectory = await getAppDirectory(ctx.root);
              const fileName = `${templateDirectory}/${item.file}`;
              if (!(await fs.pathExists(fileName))) {
                throw AppStudioResultFactory.UserError(
                  AppStudioError.FileNotFoundError.name,
                  AppStudioError.FileNotFoundError.message(fileName)
                );
              }
              const content = await fs.readJSON(fileName);
              return {
                languageTag: item.languageTag,
                file: content,
              };
            })
          );
        } catch (error) {
          return err(error);
        }
      }
      appDefinition.localizationInfo = {
        defaultLanguageTag: appManifest.localizationInfo.defaultLanguageTag,
        languages: languages,
      };
    }

    if (appManifest.webApplicationInfo) {
      appDefinition.webApplicationInfoId = appManifest.webApplicationInfo.id;
      appDefinition.webApplicationInfoResource = appManifest.webApplicationInfo.resource;
    }

    appDefinition.activities = appManifest.activities;

    if (!ignoreIcon && appManifest.icons.color) {
      appDefinition.colorIcon = appManifest.icons.color;
    }

    if (!ignoreIcon && appManifest.icons.outline) {
      appDefinition.outlineIcon = appManifest.icons.outline;
    }

    return ok(appDefinition);
  }

  private async createApp(
    ctx: PluginContext,
    isLocalDebug: boolean
  ): Promise<Result<IAppDefinition, FxError>> {
    const appDirectory = await getAppDirectory(ctx.root);
    const status = await fs.lstat(appDirectory);

    if (!status.isDirectory()) {
      throw AppStudioResultFactory.UserError(
        AppStudioError.NotADirectoryError.name,
        AppStudioError.NotADirectoryError.message(appDirectory)
      );
    }
    const manifestResult = await loadManifest(ctx.root, isLocalDebug);
    if (manifestResult.isErr()) {
      return err(manifestResult.error);
    }
    const manifest: TeamsAppManifest = manifestResult.value;
    manifest.bots = undefined;
    manifest.composeExtensions = undefined;
    if (isLocalDebug || !isUUID(manifest.id)) {
      manifest.id = v4();
    }

    const colorFile = `${appDirectory}/${manifest.icons.color}`;
    if (!(await fs.pathExists(colorFile))) {
      throw AppStudioResultFactory.UserError(
        AppStudioError.FileNotFoundError.name,
        AppStudioError.FileNotFoundError.message(colorFile)
      );
    }

    const outlineFile = `${appDirectory}/${manifest.icons.outline}`;
    if (!(await fs.pathExists(outlineFile))) {
      throw AppStudioResultFactory.UserError(
        AppStudioError.FileNotFoundError.name,
        AppStudioError.FileNotFoundError.message(outlineFile)
      );
    }

    const zip = new AdmZip();
    zip.addFile(Constants.MANIFEST_FILE, Buffer.from(JSON.stringify(manifest)));
    zip.addLocalFile(colorFile);
    zip.addLocalFile(outlineFile);

    const archivedFile = zip.toBuffer();
    const appStudioToken = await ctx?.appStudioToken?.getAccessToken();

    try {
      const appDefinition = await AppStudioClient.createApp(
        archivedFile,
        appStudioToken!,
        ctx.logProvider
      );
      return ok(appDefinition);
    } catch (e) {
      return err(
        isLocalDebug
          ? AppStudioResultFactory.SystemError(
              AppStudioError.LocalAppIdCreateFailedError.name,
              AppStudioError.LocalAppIdCreateFailedError.message(e)
            )
          : AppStudioResultFactory.SystemError(
              AppStudioError.RemoteAppIdCreateFailedError.name,
              AppStudioError.RemoteAppIdCreateFailedError.message(e)
            )
      );
    }
  }

  private async updateApp(
    ctx: PluginContext,
    appDefinition: IAppDefinition,
    appStudioToken: string,
    isLocalDebug: boolean,
    createIfNotExist: boolean,
    appDirectory: string,
    teamsAppId?: string,
    logProvider?: LogProvider
  ): Promise<Result<string, FxError>> {
    if (appStudioToken === undefined || appStudioToken.length === 0) {
      return err(
        AppStudioResultFactory.SystemError(
          AppStudioError.AppStudioTokenGetFailedError.name,
          AppStudioError.AppStudioTokenGetFailedError.message
        )
      );
    }

    if (createIfNotExist) {
      const appDef = await this.createApp(ctx, isLocalDebug);
      if (appDef.isErr()) {
        return err(appDef.error);
      }
      if (!appDef.value.teamsAppId) {
        return err(
          isLocalDebug
            ? AppStudioResultFactory.SystemError(
                AppStudioError.LocalAppIdCreateFailedError.name,
                AppStudioError.LocalAppIdCreateFailedError.message()
              )
            : AppStudioResultFactory.SystemError(
                AppStudioError.RemoteAppIdCreateFailedError.name,
                AppStudioError.RemoteAppIdCreateFailedError.message()
              )
        );
      }
      teamsAppId = appDef.value.teamsAppId;
      appDefinition.outlineIcon = appDef.value.outlineIcon;
      appDefinition.colorIcon = appDef.value.colorIcon;
    }

    const colorIconContent =
      appDirectory && appDefinition.colorIcon && !appDefinition.colorIcon.startsWith("https://")
        ? (await fs.readFile(`${appDirectory}/${appDefinition.colorIcon}`)).toString("base64")
        : undefined;
    const outlineIconContent =
      appDirectory && appDefinition.outlineIcon && !appDefinition.outlineIcon.startsWith("https://")
        ? (await fs.readFile(`${appDirectory}/${appDefinition.outlineIcon}`)).toString("base64")
        : undefined;
    appDefinition.appId = teamsAppId;

    try {
      const app = await AppStudioClient.updateApp(
        teamsAppId!,
        appDefinition,
        appStudioToken,
        logProvider,
        colorIconContent,
        outlineIconContent
      );

      if (app.updatedAt && !isLocalDebug) {
        const time = new Date(app.updatedAt).getTime();
        ctx.envInfo.state.get(PluginNames.APPST)?.set(Constants.TEAMS_APP_UPDATED_AT, time);
      }

      return ok(teamsAppId!);
    } catch (e) {
      if (e instanceof Error) {
        return err(
          isLocalDebug
            ? AppStudioResultFactory.SystemError(
                AppStudioError.LocalAppIdUpdateFailedError.name,
                AppStudioError.LocalAppIdUpdateFailedError.message(e)
              )
            : AppStudioResultFactory.SystemError(
                AppStudioError.RemoteAppIdUpdateFailedError.name,
                AppStudioError.RemoteAppIdUpdateFailedError.message(e)
              )
        );
      }
      throw e;
    }
  }

  private async validateManifestAgainstSchema(
    manifest: TeamsAppManifest
  ): Promise<Result<string[], FxError>> {
    const errors: string[] = [];
    if (manifest.$schema) {
      const instance = axios.create();
      try {
        const res = await instance.get(manifest.$schema);
        const validate = this.ajv.compile(res.data);
        const valid = validate(manifest);
        if (!valid) {
          validate.errors?.map((error) => {
            errors.push(`${error.instancePath} ${error.message}`);
          });
        }
      } catch (e: any) {
        return err(
          AppStudioResultFactory.UserError(
            AppStudioError.ValidationFailedError.name,
            AppStudioError.ValidationFailedError.message([
              `Failed to get schema from ${manifest.$schema}, message: ${e.message}`,
            ]),
            HelpLinks.WhyNeedProvision
          )
        );
      }
    } else {
      return err(
        AppStudioResultFactory.UserError(
          AppStudioError.ValidationFailedError.name,
          AppStudioError.ValidationFailedError.message(["Manifest schema is not defined"]),
          HelpLinks.WhyNeedProvision
        )
      );
    }
    return ok(errors);
  }

  private async getAppDefinitionAndManifest(
    ctx: PluginContext,
    isLocalDebug: boolean
  ): Promise<Result<[IAppDefinition, TeamsAppManifest], FxError>> {
    const {
      tabEndpoint,
      tabDomain,
      tabIndexPath,
      aadId,
      botDomain,
      botId,
      webApplicationInfoResource,
      teamsAppId,
    } = await this.getConfigForCreatingManifest(ctx, isLocalDebug);
    const isProvisionSucceeded = !!(ctx.envInfo.state
      .get("solution")
      ?.get(SOLUTION_PROVISION_SUCCEEDED) as boolean);

    const validDomains: string[] = [];
    if (tabDomain) {
      validDomains.push(tabDomain);
    }

    if (botId) {
      if (!botDomain) {
        if (isLocalDebug) {
          return err(
            AppStudioResultFactory.SystemError(
              AppStudioError.GetLocalDebugConfigFailedError.name,
              AppStudioError.GetLocalDebugConfigFailedError.message(
                new Error(`Data required: ${LOCAL_DEBUG_BOT_DOMAIN}`)
              )
            )
          );
        } else {
          return err(
            AppStudioResultFactory.UserError(
              AppStudioError.GetRemoteConfigFailedError.name,
              AppStudioError.GetRemoteConfigFailedError.message(
                new Error(`Data required: ${BOT_DOMAIN}`),
                isProvisionSucceeded
              ),
              HelpLinks.WhyNeedProvision
            )
          );
        }
      } else {
        validDomains.push(botDomain);
      }
    }

    const manifestResult = await loadManifest(ctx.root, isLocalDebug);
    if (manifestResult.isErr()) {
      return err(manifestResult.error);
    }

    let manifestString = JSON.stringify(manifestResult.value);

    // Bot only project, without frontend hosting
    let endpoint = tabEndpoint;
    let indexPath = tabIndexPath;
    const solutionSettings: AzureSolutionSettings = ctx.projectSettings
      ?.solutionSettings as AzureSolutionSettings;
    const hasFrontend = solutionSettings.capabilities.includes(TabOptionItem.id);
    if (!endpoint && !hasFrontend) {
      endpoint = DEFAULT_DEVELOPER_WEBSITE_URL;
      indexPath = "";
    }

    const customizedKeys = getCustomizedKeys("", JSON.parse(manifestString));
    this.commonProperties = {
      [TelemetryPropertyKey.customizedKeys]: JSON.stringify(customizedKeys),
    };
    const view = {
      config: ctx.envInfo.config,
      state: {
        "fx-resource-frontend-hosting": {
          endpoint: endpoint ?? "{{{state.fx-resource-frontend-hosting.endpoint}}}",
          indexPath: indexPath ?? "{{{state.fx-resource-frontend-hosting.indexPath}}}",
        },
        "fx-resource-aad-app-for-teams": {
          clientId: aadId ?? "{{state.fx-resource-aad-app-for-teams.clientId}}",
          applicationIdUris:
            webApplicationInfoResource ??
            "{{{state.fx-resource-aad-app-for-teams.applicationIdUris}}}",
        },
        "fx-resource-appstudio": {
          teamsAppId: teamsAppId ?? "{{state.fx-resource-appstudio.teamsAppId}}",
        },
        "fx-resource-bot": {
          botId: botId ?? "{{state.fx-resource-bot.botId}}",
        },
      },
      localSettings: {
        frontend: {
          tabEndpoint: endpoint ? endpoint : "{{{localSettings.frontend.tabEndpoint}}}",
          tabIndexPath: indexPath ?? "{{{localSettings.frontend.tabIndexPath}}}",
        },
        auth: {
          clientId: ctx.localSettings?.auth?.get(LocalSettingsAuthKeys.ClientId)
            ? ctx.localSettings?.auth?.get(LocalSettingsAuthKeys.ClientId)
            : "{{localSettings.auth.clientId}}",
          applicationIdUris: ctx.localSettings?.auth?.get(LocalSettingsAuthKeys.ApplicationIdUris)
            ? ctx.localSettings?.auth?.get(LocalSettingsAuthKeys.ApplicationIdUris)
            : "{{{localSettings.auth.applicationIdUris}}}",
        },
        teamsApp: {
          teamsAppId: ctx.localSettings?.teamsApp?.get(LocalSettingsTeamsAppKeys.TeamsAppId)
            ? ctx.localSettings?.teamsApp?.get(LocalSettingsTeamsAppKeys.TeamsAppId)
            : "{{localSettings.teamsApp.teamsAppId}}",
        },
        bot: {
          botId: ctx.localSettings?.bot?.get(LocalSettingsBotKeys.BotId)
            ? ctx.localSettings?.bot?.get(LocalSettingsBotKeys.BotId)
            : "{{localSettings.bot.botId}}",
        },
      },
    };
    manifestString = Mustache.render(manifestString, view);
    const tokens = [
      ...new Set(
        Mustache.parse(manifestString)
          .filter((x) => {
            return x[0] != "text" && x[1] != "localSettings.teamsApp.teamsAppId";
          })
          .map((x) => x[1])
      ),
    ];
    if (tokens.length > 0) {
      if (isLocalDebug) {
        return err(
          AppStudioResultFactory.UserError(
            AppStudioError.GetLocalDebugConfigFailedError.name,
            AppStudioError.GetLocalDebugConfigFailedError.message(
              new Error(`Data required: ${tokens.join(",")}`)
            )
          )
        );
      } else {
        return err(
          AppStudioResultFactory.UserError(
            AppStudioError.GetRemoteConfigFailedError.name,
            AppStudioError.GetRemoteConfigFailedError.message(
              new Error(`Data required: ${tokens.join(",")}`),
              isProvisionSucceeded
            ),
            HelpLinks.WhyNeedProvision
          )
        );
      }
    }

    let updatedManifest: TeamsAppManifest;
    try {
      updatedManifest = JSON.parse(manifestString) as TeamsAppManifest;
    } catch (error) {
      if (error.stack && error.stack.startsWith("SyntaxError")) {
        // teams app id in userData may be updated by user, result to invalid manifest
        const reg = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
        const result = teamsAppId.match(reg);
        if (!result) {
          return err(
            AppStudioResultFactory.UserError(
              AppStudioError.InvalidManifestError.name,
              AppStudioError.InvalidManifestError.message(error, "teamsAppId"),
              undefined,
              error.stack
            )
          );
        }
        return err(
          AppStudioResultFactory.UserError(
            AppStudioError.InvalidManifestError.name,
            AppStudioError.InvalidManifestError.message(error),
            undefined,
            error.stack
          )
        );
      } else {
        return err(error);
      }
    }

    for (const domain of validDomains) {
      updatedManifest.validDomains?.push(domain);
    }

    const appDefinitionRes = await this.convertToAppDefinition(ctx, updatedManifest, false);
    if (appDefinitionRes.isErr()) {
      return err(appDefinitionRes.error);
    }
    const appDefinition = appDefinitionRes.value;

    return ok([appDefinition, updatedManifest]);
  }

  private async getSPFxManifest(ctx: PluginContext, isLocalDebug: boolean): Promise<string> {
    const manifestResult = await loadManifest(ctx.root, isLocalDebug);
    if (manifestResult.isErr()) {
      throw manifestResult.error;
    }
    let manifestString = JSON.stringify(manifestResult.value);
    const view = {
      config: ctx.envInfo.config,
      state: {
        "fx-resource-appstudio": {
          teamsAppId: await this.getTeamsAppId(ctx, isLocalDebug),
        },
      },
      localSettings: {
        teamsApp: {
          teamsAppId: ctx.localSettings?.teamsApp?.get(LocalSettingsTeamsAppKeys.TeamsAppId),
        },
      },
    };
    manifestString = Mustache.render(manifestString, view);
    return manifestString;
  }
}

export async function createLocalManifest(
  appName: string,
  hasFrontend: boolean,
  hasBot: boolean,
  hasMessageExtension: boolean,
  isSPFx: boolean,
  migrateFromV1: boolean
): Promise<TeamsAppManifest> {
  let name = appName;
  const suffix = "-local-debug";
  if (suffix.length + appName.length <= TEAMS_APP_SHORT_NAME_MAX_LENGTH) {
    name = name + suffix;
  }
  if (isSPFx) {
    const templateManifestFolder = path.join(getTemplatesFolder(), "plugins", "resource", "spfx");
    const localManifestFile = path.resolve(templateManifestFolder, `./solution/${MANIFEST_LOCAL}`);
    let manifestString = (await fs.readFile(localManifestFile)).toString();
    manifestString = replaceConfigValue(manifestString, "appName", name);
    const manifest: TeamsAppManifest = JSON.parse(manifestString);
    return manifest;
  } else {
    let manifestString = TEAMS_APP_MANIFEST_TEMPLATE_LOCAL_DEBUG;

    manifestString = replaceConfigValue(manifestString, "appName", name);
    const manifest: TeamsAppManifest = JSON.parse(manifestString);
    if (hasFrontend) {
      manifest.staticTabs = STATIC_TABS_TPL_LOCAL_DEBUG;
      manifest.configurableTabs = CONFIGURABLE_TABS_TPL_LOCAL_DEBUG;
    }
    if (hasBot) {
      manifest.bots = BOTS_TPL_LOCAL_DEBUG;
    }
    if (hasMessageExtension) {
      manifest.composeExtensions = COMPOSE_EXTENSIONS_TPL_LOCAL_DEBUG;
    }
    if (migrateFromV1) {
      manifest.webApplicationInfo = undefined;
    }
    return manifest;
  }
}

export async function createManifest(
  appName: string,
  hasFrontend: boolean,
  hasBot: boolean,
  hasMessageExtension: boolean,
  isSPFx: boolean,
  migrateFromV1: boolean
): Promise<TeamsAppManifest | undefined> {
  if (!hasBot && !hasMessageExtension && !hasFrontend) {
    throw new Error(`Invalid capability`);
  }
  if (!isSPFx || hasBot || hasMessageExtension) {
    const manifestString = TEAMS_APP_MANIFEST_TEMPLATE_FOR_MULTI_ENV;
    const manifest: TeamsAppManifest = JSON.parse(manifestString);
    if (hasFrontend) {
      manifest.staticTabs = STATIC_TABS_TPL_FOR_MULTI_ENV;
      manifest.configurableTabs = CONFIGURABLE_TABS_TPL_FOR_MULTI_ENV;
    }
    if (hasBot) {
      manifest.bots = BOTS_TPL_FOR_MULTI_ENV;
    }
    if (hasMessageExtension) {
      manifest.composeExtensions = COMPOSE_EXTENSIONS_TPL_FOR_MULTI_ENV;
    }

    if (migrateFromV1) {
      manifest.webApplicationInfo = undefined;
    }

    return manifest;
  }

  return undefined;
}
