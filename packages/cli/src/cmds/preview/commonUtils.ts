// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

"use strict";

import * as path from "path";
import { Colors, FxError, IProgressHandler, LogLevel } from "@microsoft/teamsfx-api";

import * as constants from "./constants";
import { TaskResult } from "./task";
import cliLogger from "../../commonlib/log";
import { TaskFailed } from "./errors";
import cliTelemetry, { CliTelemetry } from "../../telemetry/cliTelemetry";
import {
  TelemetryEvent,
  TelemetryProperty,
  TelemetrySuccess,
} from "../../telemetry/cliTelemetryEvents";
import { ServiceLogWriter } from "./serviceLogWriter";
import open from "open";
import { LocalEnvManager } from "@microsoft/teamsfx-core";
import { getColorizedString } from "../../utils";
import { isWindows } from "./depsChecker/cliUtils";
import { CliConfigAutomaticNpmInstall, CliConfigOptions, UserSettings } from "../../userSetttings";

export async function openBrowser(
  browser: constants.Browser,
  url: string,
  browserArguments: string[] = []
): Promise<void> {
  switch (browser) {
    case constants.Browser.chrome:
      await open(url, {
        app: {
          name: open.apps.chrome,
          arguments: browserArguments,
        },
        wait: true,
        allowNonzeroExitCode: true,
      });
      break;
    case constants.Browser.edge:
      await open(url, {
        app: {
          name: open.apps.edge,
          arguments: browserArguments,
        },
        wait: true,
        allowNonzeroExitCode: true,
      });
      break;
    case constants.Browser.default:
      await open(url, {
        wait: true,
      });
      break;
  }
}

export function createTaskStartCb(
  progressBar: IProgressHandler,
  startMessage: string,
  telemetryProperties?: { [key: string]: string }
): (taskTitle: string, background: boolean) => Promise<void> {
  return async (taskTitle: string, background: boolean, serviceLogWriter?: ServiceLogWriter) => {
    if (telemetryProperties !== undefined) {
      let event = background
        ? TelemetryEvent.PreviewServiceStart
        : TelemetryEvent.PreviewNpmInstallStart;
      let key = background
        ? TelemetryProperty.PreviewServiceName
        : TelemetryProperty.PreviewNpmInstallName;
      if (taskTitle === constants.gulpCertTitle) {
        event = TelemetryEvent.PreviewGulpCertStart;
        key = TelemetryProperty.PreviewGulpCertName;
      }
      cliTelemetry.sendTelemetryEvent(event, {
        ...telemetryProperties,
        [key]: taskTitle as string,
      });
    }
    await progressBar.start(startMessage);
    if (background) {
      const serviceLogFile = await serviceLogWriter?.getLogFile(taskTitle);
      if (serviceLogFile !== undefined) {
        const message = [
          {
            content: `${taskTitle}: ${constants.serviceLogHintMessage} `,
            color: Colors.WHITE,
          },
          {
            content: serviceLogFile,
            color: Colors.BRIGHT_GREEN,
          },
        ];
        cliLogger.necessaryLog(LogLevel.Info, getColorizedString(message));
      }
    }
    await progressBar.next(startMessage);
  };
}

export function createTaskStopCb(
  progressBar: IProgressHandler,
  telemetryProperties?: { [key: string]: string }
): (
  taskTitle: string,
  background: boolean,
  result: TaskResult,
  serviceLogWriter?: ServiceLogWriter
) => Promise<FxError | null> {
  return async (taskTitle: string, background: boolean, result: TaskResult) => {
    const timestamp = new Date();
    const ifNpmInstall: boolean = taskTitle.includes("npm install");
    let event = background ? TelemetryEvent.PreviewService : TelemetryEvent.PreviewNpmInstall;
    let key = background
      ? TelemetryProperty.PreviewServiceName
      : TelemetryProperty.PreviewNpmInstallName;
    if (taskTitle === constants.gulpCertTitle) {
      event = TelemetryEvent.PreviewGulpCert;
      key = TelemetryProperty.PreviewGulpCertName;
    }
    const success = background ? result.success : result.exitCode === 0;
    const properties = {
      ...telemetryProperties,
      [key]: taskTitle,
    };
    if (!background && ifNpmInstall) {
      properties[TelemetryProperty.PreviewNpmInstallExitCode] =
        (result.exitCode === null ? undefined : result.exitCode) + "";
    }
    if (success) {
      if (telemetryProperties !== undefined) {
        cliTelemetry.sendTelemetryEvent(event, {
          ...properties,
          [TelemetryProperty.Success]: TelemetrySuccess.Yes,
        });
      }
      await progressBar.end(true);
      return null;
    } else {
      const error = TaskFailed(taskTitle);
      if (!background && ifNpmInstall && telemetryProperties !== undefined) {
        const localEnvManager = new LocalEnvManager(cliLogger, CliTelemetry.getReporter());
        const npmInstallLogInfo = await localEnvManager.getNpmInstallLogInfo();
        let validNpmInstallLogInfo = false;
        if (
          npmInstallLogInfo?.cwd !== undefined &&
          result.options?.cwd !== undefined &&
          path.relative(npmInstallLogInfo.cwd, result.options.cwd).length === 0 &&
          result.exitCode === npmInstallLogInfo.exitCode
        ) {
          const timeDiff = timestamp.getTime() - npmInstallLogInfo.timestamp.getTime();
          if (timeDiff >= 0 && timeDiff <= 20000) {
            validNpmInstallLogInfo = true;
          }
        }
        if (validNpmInstallLogInfo) {
          properties[TelemetryProperty.PreviewNpmInstallNodeVersion] =
            npmInstallLogInfo?.nodeVersion + "";
          properties[TelemetryProperty.PreviewNpmInstallNpmVersion] =
            npmInstallLogInfo?.npmVersion + "";
          properties[TelemetryProperty.PreviewNpmInstallErrorMessage] =
            npmInstallLogInfo?.errorMessage + "";
        }
      }
      if (telemetryProperties !== undefined) {
        cliTelemetry.sendTelemetryErrorEvent(event, error, properties);
      }
      cliLogger.necessaryLog(LogLevel.Error, `${error.source}.${error.name}: ${error.message}`);
      if (!background) {
        if (result.stderr.length > 0) {
          cliLogger.necessaryLog(LogLevel.Info, result.stderr[result.stderr.length - 1], true);
        }
      }
      await progressBar.end(false);
      return error;
    }
  };
}

export async function getLocalEnv(
  workspaceFolder: string
): Promise<{ [key: string]: string } | undefined> {
  const localEnvManager = new LocalEnvManager(cliLogger, CliTelemetry.getReporter());
  const projectSettings = await localEnvManager.getProjectSettings(workspaceFolder);
  const localSettings = await localEnvManager.getLocalSettings(workspaceFolder, {
    projectId: projectSettings.projectId,
  });
  return await localEnvManager.getLocalDebugEnvs(workspaceFolder, projectSettings, localSettings);
}

function getLocalEnvWithPrefix(
  env: { [key: string]: string } | undefined,
  prefix: string
): { [key: string]: string } | undefined {
  if (env === undefined) {
    return undefined;
  }
  const result: { [key: string]: string } = {};
  for (const key of Object.keys(env)) {
    if (key.startsWith(prefix) && env[key]) {
      result[key.slice(prefix.length)] = env[key];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function getFrontendLocalEnv(
  env: { [key: string]: string } | undefined
): { [key: string]: string } | undefined {
  return getLocalEnvWithPrefix(env, constants.frontendLocalEnvPrefix);
}

export function getBackendLocalEnv(
  env: { [key: string]: string } | undefined
): { [key: string]: string } | undefined {
  return getLocalEnvWithPrefix(env, constants.backendLocalEnvPrefix);
}

export function getAuthLocalEnv(
  env: { [key: string]: string } | undefined
): { [key: string]: string } | undefined {
  // SERVICE_PATH will also be included, but it has no side effect
  return getLocalEnvWithPrefix(env, constants.authLocalEnvPrefix);
}

export function getAuthServicePath(env: { [key: string]: string } | undefined): string | undefined {
  return env ? env[constants.authServicePathEnvKey] : undefined;
}

export function getBotLocalEnv(
  env: { [key: string]: string } | undefined
): { [key: string]: string } | undefined {
  return getLocalEnvWithPrefix(env, constants.botLocalEnvPrefix);
}

export async function getPortsInUse(workspaceFolder: string): Promise<number[]> {
  const localEnvManager = new LocalEnvManager(cliLogger, CliTelemetry.getReporter());
  try {
    const projectSettings = await localEnvManager.getProjectSettings(workspaceFolder);
    return await localEnvManager.getPortsInUse(workspaceFolder, projectSettings);
  } catch (error: any) {
    cliLogger.warning(`Failed to check used ports. Error: ${error}`);
    return [];
  }
}

export function mergeProcessEnv(
  env: { [key: string]: string | undefined } | undefined
): { [key: string]: string | undefined } | undefined {
  if (env === undefined) {
    return process.env;
  }
  const result = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (isWindows()) {
      let targetKey = Object.keys(result).find(
        (value) => value.toLowerCase() === key.toLowerCase()
      );
      targetKey = targetKey ?? key;
      result[targetKey] = env[key];
    } else {
      result[key] = env[key];
    }
  }
  return result;
}

export function getAutomaticNpmInstallSetting(): boolean {
  try {
    const result = UserSettings.getConfigSync();
    if (result.isErr()) {
      throw result.error;
    }

    const config = result.value;
    const automaticNpmInstallOption = "automatic-npm-install"; // TODO: use CliConfigOptions.AutomaticNpmInstall instead
    if (!(automaticNpmInstallOption in config)) {
      return false; // TODO: make automatic-npm-install enabled by default
    }
    return config[automaticNpmInstallOption] !== CliConfigAutomaticNpmInstall.Off;
  } catch (error: any) {
    cliLogger.warning(`Getting automatic-npm-install setting failed: ${error}`);
    return false; // TODO: make automatic-npm-install enabled by default
  }
}
