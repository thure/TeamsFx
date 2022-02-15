// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PluginContext, SystemError, UserError, v2 } from "@microsoft/teamsfx-api";
import { Constants } from "./../constants";
import { PluginNames } from "../../../solution/fx-solution/constants";

export enum TelemetryPropertyKey {
  component = "component",
  errorType = "error-type",
  errorCode = "error-code",
  errorMessage = "error-message",
  validationResult = "validation-result",
  updateExistingApp = "update",
  success = "success",
  appId = "appid",
  publishedAppId = "published-app-id",
  customizedKeys = "customized-manifest-keys",
}

enum TelemetryPropertyValue {
  UserError = "user",
  SystemError = "system",
  success = "yes",
  failure = "no",
}

export enum TelemetryEventName {
  scaffold = "scaffold",
  validateManifest = "validate-manifest",
  buildTeamsPackage = "build",
  publish = "publish",
  migrateV1Project = "migrate-v1-project",
  updateManifest = "update-manifest",
  provision = "provision",
  provisionManifest = "provision-manifest",
  postProvision = "post-provision",
  checkPermission = "check-permission",
  grantPermission = "grant-permission",
  listCollaborator = "list-collaborator",
  localDebug = "local-debug",
  init = "init",
  addCapability = "add-capability",
  loadManifest = "load-manifest",
  saveManifest = "save-manifest",
}

export class TelemetryUtils {
  static ctx: PluginContext | v2.Context;

  public static init(ctx: PluginContext | v2.Context) {
    TelemetryUtils.ctx = ctx;
  }

  public static sendStartEvent(
    eventName: string,
    properties?: { [key: string]: string },
    measurements?: { [key: string]: number }
  ) {
    if (!properties) {
      properties = {};
    }
    properties[TelemetryPropertyKey.component] = Constants.PLUGIN_NAME;
    const teamsAppId = (this.ctx as PluginContext).envInfo?.state
      .get(PluginNames.APPST)
      ?.get(Constants.TEAMS_APP_ID) as string;
    if (teamsAppId) {
      properties[TelemetryPropertyKey.appId] = teamsAppId;
    }
    TelemetryUtils.ctx.telemetryReporter?.sendTelemetryErrorEvent(
      `${eventName}-start`,
      properties,
      measurements
    );
  }

  public static sendSuccessEvent(
    eventName: string,
    properties?: { [key: string]: string },
    measurements?: { [key: string]: number }
  ) {
    if (!properties) {
      properties = {};
    }
    properties[TelemetryPropertyKey.component] = Constants.PLUGIN_NAME;
    properties[TelemetryPropertyKey.success] = TelemetryPropertyValue.success;
    const teamsAppId = (this.ctx as PluginContext).envInfo?.state
      .get(PluginNames.APPST)
      ?.get(Constants.TEAMS_APP_ID) as string;
    if (teamsAppId) {
      properties[TelemetryPropertyKey.appId] = teamsAppId;
    }
    TelemetryUtils.ctx.telemetryReporter?.sendTelemetryEvent(eventName, properties, measurements);
  }

  public static sendErrorEvent(
    eventName: string,
    error: SystemError | UserError,
    properties?: { [key: string]: string },
    measurements?: { [key: string]: number }
  ) {
    if (!properties) {
      properties = {};
    }
    properties[TelemetryPropertyKey.component] = Constants.PLUGIN_NAME;
    if (error instanceof SystemError) {
      properties[TelemetryPropertyKey.errorType] = TelemetryPropertyValue.SystemError;
    } else if (error instanceof UserError) {
      properties[TelemetryPropertyKey.errorType] = TelemetryPropertyValue.UserError;
    }
    properties[TelemetryPropertyKey.errorCode] = `${error.source}.${error.name}`;
    properties[TelemetryPropertyKey.errorMessage] = error.message;
    properties[TelemetryPropertyKey.success] = TelemetryPropertyValue.failure;

    const teamsAppId = (this.ctx as PluginContext).envInfo?.state
      .get(PluginNames.APPST)
      ?.get(Constants.TEAMS_APP_ID) as string;
    if (teamsAppId) {
      properties[TelemetryPropertyKey.appId] = teamsAppId;
    }
    TelemetryUtils.ctx.telemetryReporter?.sendTelemetryErrorEvent(
      eventName,
      properties,
      measurements
    );
  }
}
