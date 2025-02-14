// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FxResult } from "../result";
import { SystemError, UserError } from "@microsoft/teamsfx-api";
import { TelemetryKeys, TelemetryValues, PluginCICD, PluginSolution } from "../constants";
import { Context, EnvInfoV2 } from "@microsoft/teamsfx-api/build/v2";

export class telemetryHelper {
  static fillCommonProperty(
    ctx: Context,
    envInfo: EnvInfoV2,
    properties: { [key: string]: string }
  ): void {
    properties[TelemetryKeys.Component] = PluginCICD.PLUGIN_NAME;
    properties[TelemetryKeys.AppId] =
      (envInfo.state?.[PluginSolution.PLUGIN_NAME]?.[
        PluginSolution.REMOTE_TEAMS_APPID
      ] as string) || "";
  }

  static sendStartEvent(
    ctx: Context,
    envInfo: EnvInfoV2,
    eventName: string,
    properties: { [key: string]: string } = {},
    measurements: { [key: string]: number } = {}
  ): void {
    properties[TelemetryKeys.Success] = TelemetryValues.Success;
    this.fillCommonProperty(ctx, envInfo, properties);

    ctx.telemetryReporter?.sendTelemetryEvent(`${eventName}-start`, properties, measurements);
  }

  static sendSuccessEvent(
    ctx: Context,
    envInfo: EnvInfoV2,
    eventName: string,
    properties: { [key: string]: string } = {},
    measurements: { [key: string]: number } = {}
  ): void {
    properties[TelemetryKeys.Success] = TelemetryValues.Success;
    this.fillCommonProperty(ctx, envInfo, properties);

    ctx.telemetryReporter?.sendTelemetryEvent(eventName, properties, measurements);
  }

  static sendErrorEvent(
    ctx: Context,
    envInfo: EnvInfoV2,
    eventName: string,
    e: SystemError | UserError,
    properties: { [key: string]: string } = {},
    measurements: { [key: string]: number } = {}
  ): void {
    properties[TelemetryKeys.Success] = TelemetryValues.Fail;
    properties[TelemetryKeys.ErrorMessage] = e.message;
    properties[TelemetryKeys.ErrorCode] = e.name;
    this.fillCommonProperty(ctx, envInfo, properties);

    if (e instanceof SystemError) {
      properties[TelemetryKeys.ErrorType] = TelemetryValues.SystemError;
    } else if (e instanceof UserError) {
      properties[TelemetryKeys.ErrorType] = TelemetryValues.UserError;
    }

    ctx.telemetryReporter?.sendTelemetryEvent(eventName, properties, measurements);
  }

  static sendResultEvent(
    ctx: Context,
    envInfo: EnvInfoV2,
    eventName: string,
    result: FxResult,
    properties: { [key: string]: string } = {},
    measurements: { [key: string]: number } = {}
  ): void {
    result.match(
      () => this.sendSuccessEvent(ctx, envInfo, eventName, properties, measurements),
      (e: SystemError | UserError) =>
        this.sendErrorEvent(ctx, envInfo, eventName, e, properties, measurements)
    );
  }
}
