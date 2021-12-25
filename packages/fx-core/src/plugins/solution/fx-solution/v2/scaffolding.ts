import {
  v2,
  Inputs,
  FxError,
  Result,
  ok,
  err,
  Void,
  AzureSolutionSettings,
  returnSystemError,
  AutoGeneratedReadme,
  Json,
} from "@microsoft/teamsfx-api";
import { getStrings } from "../../../../common/tools";
import {
  AzureSolutionQuestionNames,
  BotOptionItem,
  MessageExtensionItem,
  TabOptionItem,
} from "../question";
import { executeConcurrently, NamedThunk } from "./executor";
import {
  getAzureSolutionSettings,
  getSelectedPlugins,
  fillInSolutionSettings,
  isAzureProject,
} from "./utils";
import path from "path";
import fs from "fs-extra";
import {
  DEFAULT_PERMISSION_REQUEST,
  getTemplatesFolder,
  SolutionError,
  SolutionTelemetryComponentName,
  SolutionTelemetryEvent,
  SolutionTelemetryProperty,
  SolutionTelemetrySuccess,
} from "../../../..";
import { ResourcePluginsV2 } from "../ResourcePluginContainer";
import { Container } from "typedi";
import { scaffoldLocalDebugSettings } from "../debug/scaffolding";

export async function scaffoldSourceCode(
  ctx: v2.Context,
  inputs: Inputs
): Promise<Result<Void, FxError>> {
  if (inputs.projectPath === undefined) {
    return err(
      returnSystemError(
        new Error("projectPath is undefined"),
        "Solution",
        SolutionError.InternelError
      )
    );
  }
  const lang = inputs[AzureSolutionQuestionNames.ProgrammingLanguage] as string;
  if (lang) {
    ctx.projectSetting.programmingLanguage = lang;
  }
  const solutionSettings: AzureSolutionSettings = getAzureSolutionSettings(ctx);
  const fillinRes = fillInSolutionSettings(solutionSettings, inputs);
  if (fillinRes.isErr()) return err(fillinRes.error);
  const plugins = getSelectedPlugins(solutionSettings);

  let thunks: NamedThunk<Void>[] = plugins
    .filter((plugin) => !!plugin.scaffoldSourceCode)
    .map((plugin) => {
      return {
        pluginName: `${plugin.name}`,
        taskName: "scaffoldSourceCode",
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        thunk: () => plugin.scaffoldSourceCode!(ctx, inputs),
      };
    });

  ///SPFx plugin will be executed last, so remove it from the thunks.
  const SPFxPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.SpfxPlugin);
  if (thunks.map((p) => p.pluginName === SPFxPlugin.name).length > 0) {
    thunks = thunks.filter((p) => p.pluginName !== SPFxPlugin.name);
  }
  const result = await executeConcurrently(thunks, ctx.logProvider);
  if (result.kind === "success") {
    const capabilities = solutionSettings.capabilities;
    const azureResources = solutionSettings.azureResources;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const scaffoldLocalDebugSettingsResult = await scaffoldLocalDebugSettings(ctx, inputs);
    if (scaffoldLocalDebugSettingsResult.isErr()) {
      return scaffoldLocalDebugSettingsResult;
    }
    await scaffoldReadme(capabilities, azureResources, inputs.projectPath!);
    if (isAzureProject(solutionSettings)) {
      await fs.writeJSON(`${inputs.projectPath}/permissions.json`, DEFAULT_PERMISSION_REQUEST, {
        spaces: 4,
      });
      ctx.telemetryReporter?.sendTelemetryEvent(SolutionTelemetryEvent.Create, {
        [SolutionTelemetryProperty.Component]: SolutionTelemetryComponentName,
        [SolutionTelemetryProperty.Success]: SolutionTelemetrySuccess.Yes,
        [SolutionTelemetryProperty.Resources]: solutionSettings.azureResources.join(";"),
        [SolutionTelemetryProperty.Capabilities]: solutionSettings.capabilities.join(";"),
        [SolutionTelemetryProperty.ProgrammingLanguage]:
          ctx.projectSetting?.programmingLanguage ?? "",
      });
    } else {
      //For SPFx plugin, execute it alone lastly
      if (SPFxPlugin.scaffoldSourceCode) {
        const spfxRes = await SPFxPlugin.scaffoldSourceCode(ctx, inputs);
        if (spfxRes.isErr()) {
          return err(spfxRes.error);
        }
      }
    }
    ctx.userInteraction.showMessage(
      "info",
      `Success: ${getStrings().solution.ScaffoldSuccessNotice}`,
      false
    );
    return ok(Void);
  } else {
    return err(result.error);
  }
}

export async function scaffoldByPlugins(
  ctx: v2.Context,
  inputs: Inputs,
  localSettings: Json,
  plugins: v2.ResourcePlugin[]
): Promise<Result<Void, FxError>> {
  ctx.logProvider?.info(`start scaffolding ${plugins.map((p) => p.name).join(",")}.....`);
  const thunks: NamedThunk<Void>[] = plugins
    .filter((plugin) => !!plugin.scaffoldSourceCode)
    .map((plugin) => {
      return {
        pluginName: `${plugin.name}`,
        taskName: "scaffoldSourceCode",
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        thunk: () => plugin.scaffoldSourceCode!(ctx, inputs),
      };
    });

  const result = await executeConcurrently(thunks, ctx.logProvider);
  const solutionSettings = getAzureSolutionSettings(ctx);
  if (result.kind === "success") {
    const capabilities = solutionSettings.capabilities;
    const azureResources = solutionSettings.azureResources;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await scaffoldReadme(capabilities, azureResources, inputs.projectPath!);

    ctx.userInteraction.showMessage(
      "info",
      `Success: ${getStrings().solution.ScaffoldSuccessNotice}`,
      false
    );
    ctx.logProvider?.info(`finish scaffolding ${plugins.map((p) => p.name).join(",")}!`);
    return ok(Void);
  } else {
    ctx.logProvider?.info(`failed to scaffold ${plugins.map((p) => p.name).join(",")}!`);
    return err(result.error);
  }
}

export async function scaffoldReadme(
  capabilities: string[],
  azureResources: string[],
  projectPath: string,
  migrateFromV1?: boolean
): Promise<void> {
  capabilities = capabilities || [];
  azureResources = azureResources || [];
  const hasBot = capabilities.includes(BotOptionItem.id);
  const hasMsgExt = capabilities.includes(MessageExtensionItem.id);
  const hasTab = capabilities.includes(TabOptionItem.id);
  if (hasTab && (hasBot || hasMsgExt)) {
    const readme = path.join(getTemplatesFolder(), "plugins", "solution", "README.md");
    if (await fs.pathExists(readme)) {
      await fs.copy(readme, `${projectPath}/${AutoGeneratedReadme}`);
    }
  }

  if (migrateFromV1) {
    const readme = path.join(getTemplatesFolder(), "plugins", "solution", "v1", "README.md");
    if (await fs.pathExists(readme)) {
      await fs.copy(readme, `${projectPath}/${AutoGeneratedReadme}`);
    }
  }
}
