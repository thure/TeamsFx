// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  AzureSolutionSettings,
  err,
  FxError,
  Json,
  ok,
  OptionItem,
  QTreeNode,
  Result,
  TokenProvider,
  v2,
  v3,
  Void,
} from "@microsoft/teamsfx-api";
import { Container } from "typedi";
import { PluginDisplayName } from "../../../../common/constants";
import { executeConcurrently } from "../v2/executor";
import { selectMultiPluginsQuestion } from "../../utils/questions";
import { getLocalizedString } from "../../../../common/localizeUtils";

export async function getQuestionsForDeploy(
  ctx: v2.Context,
  inputs: v2.InputsWithProjectPath,
  envInfo: v2.DeepReadonly<v3.EnvInfoV3>,
  tokenProvider: TokenProvider
): Promise<Result<QTreeNode | undefined, FxError>> {
  const solutionSetting = ctx.projectSetting.solutionSettings as AzureSolutionSettings | undefined;
  const pluginNames = solutionSetting ? solutionSetting.activeResourcePlugins : [];
  if (pluginNames.length === 0) return ok(undefined);
  const rootNode = new QTreeNode(selectMultiPluginsQuestion);
  const deployOptions: OptionItem[] = [];
  const pluginPrefix = "fx-resource-";
  for (const pluginName of pluginNames) {
    if (pluginName) {
      const plugin = Container.get<v3.PluginV3>(pluginName);
      if (plugin.deploy) {
        deployOptions.push({
          id: pluginName,
          label: plugin.displayName || pluginName,
          cliName: plugin.name.replace(pluginPrefix, ""),
        });
        if (plugin.getQuestionsForDeploy) {
          const res = await plugin.getQuestionsForDeploy(ctx, inputs, envInfo, tokenProvider);
          if (res.isErr()) {
            return res;
          }
          if (res.value) {
            const node = res.value;
            if (node && node.data) {
              node.condition = { contains: pluginName };
              rootNode.addChild(node);
            }
          }
        }
      }
    }
  }
  selectMultiPluginsQuestion.staticOptions = deployOptions;
  return ok(rootNode);
}
export async function deploy(
  ctx: v2.Context,
  inputs: v2.InputsWithProjectPath,
  envInfo: v2.DeepReadonly<v3.EnvInfoV3>,
  tokenProvider: TokenProvider,
  telemetryProps?: Json
): Promise<Result<Void, FxError>> {
  const solutionSetting = ctx.projectSetting.solutionSettings as AzureSolutionSettings | undefined;
  const pluginNames = solutionSetting ? solutionSetting.activeResourcePlugins : [];
  const plugins = pluginNames
    .map((name) => Container.get<v3.PluginV3>(name))
    .filter((p) => p.deploy !== undefined);
  if (plugins.length === 0) return ok(Void);
  const thunks = plugins.map((plugin) => {
    return {
      pluginName: `${plugin.name}`,
      taskName: "deploy",
      thunk: () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return plugin.deploy!(ctx, inputs, envInfo, tokenProvider);
      },
    };
  });
  ctx.logProvider.info(
    getLocalizedString(
      "core.deploy.selectedPluginsToDeployNotice",
      PluginDisplayName.Solution,
      JSON.stringify(thunks.map((p) => p.pluginName))
    )
  );
  ctx.logProvider.info(getLocalizedString("core.deploy.startNotice", PluginDisplayName.Solution));
  const result = await executeConcurrently(thunks, ctx.logProvider);

  if (result.kind === "success") {
    const msg = getLocalizedString("core.deploy.successNotice", ctx.projectSetting.appName);
    ctx.logProvider.info(msg);
    ctx.userInteraction.showMessage("info", msg, false);
    return ok(Void);
  } else {
    const msg = getLocalizedString("core.deploy.failNotice", ctx.projectSetting.appName);
    ctx.logProvider.info(msg);
    return err(result.error);
  }
}
