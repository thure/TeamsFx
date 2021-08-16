// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  AzureSolutionSettings,
  Func,
  FxError,
  Inputs,
  Result,
  TokenProvider,
} from "@microsoft/teamsfx-api";
import { Context, LocalSettings, ResourcePlugin } from "@microsoft/teamsfx-api/build/v2";
import { Inject, Service } from "typedi";
import { LocalDebugPlugin } from "..";
import {
  ResourcePlugins,
  ResourcePluginsV2,
} from "../../../solution/fx-solution/ResourcePluginContainer";
import {
  configureLocalResourceAdapter,
  executeUserTaskAdapter,
  provisionLocalResourceAdapter,
  scaffoldSourceCodeAdapter,
} from "../../utils4v2";

@Service(ResourcePluginsV2.LocalDebugPlugin)
export class LocalDebugPluginV2 implements ResourcePlugin {
  name = "fx-resource-local-debug";
  displayName = "LocalDebug";
  @Inject(ResourcePlugins.LocalDebugPlugin)
  plugin!: LocalDebugPlugin;
  activate(solutionSettings: AzureSolutionSettings): boolean {
    return this.plugin.activate(solutionSettings);
  }

  async scaffoldSourceCode(
    ctx: Context,
    inputs: Inputs
  ): Promise<Result<{ output: Record<string, string> }, FxError>> {
    return await scaffoldSourceCodeAdapter(ctx, inputs, this.plugin);
  }

  async provisionLocalResource(
    ctx: Context,
    inputs: Inputs,
    localSettings: LocalSettings,
    tokenProvider: TokenProvider
  ): Promise<Result<LocalSettings, FxError>> {
    return await provisionLocalResourceAdapter(
      ctx,
      inputs,
      localSettings,
      tokenProvider,
      this.plugin
    );
  }

  async configureLocalResource(
    ctx: Context,
    inputs: Inputs,
    localSettings: LocalSettings,
    tokenProvider: TokenProvider
  ): Promise<Result<LocalSettings, FxError>> {
    return await configureLocalResourceAdapter(
      ctx,
      inputs,
      localSettings,
      tokenProvider,
      this.plugin
    );
  }

  async executeUserTask(
    ctx: Context,
    func: Func,
    inputs: Inputs
  ): Promise<Result<unknown, FxError>> {
    return await executeUserTaskAdapter(ctx, func, inputs, this.plugin);
  }
}