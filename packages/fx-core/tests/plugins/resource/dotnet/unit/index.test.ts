// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import "mocha";

import * as chai from "chai";
import * as sinon from "sinon";
import fs from "fs-extra";
import { PluginContext } from "@microsoft/teamsfx-api";
import chaiAsPromised from "chai-as-promised";

import { FrontendPlugin as BlazorPlugin } from "../../../../../src/plugins/resource/frontend";
import { TestHelper } from "../helper";
import { DotnetConfigInfo as ConfigInfo } from "../../../../../src/plugins/resource/frontend/dotnet/constants";
import { AzureClientFactory } from "../../../../../src/plugins/resource/frontend/dotnet/utils/azure-client";
import * as dirWalk from "../../../../../src/plugins/resource/function/utils/dir-walk";
import * as execute from "../../../../../src/plugins/resource/function/utils/execute";
import axios from "axios";
import * as core from "../../../../../src/core";
import { WebSiteManagementClient } from "@azure/arm-appservice";

chai.use(chaiAsPromised);

describe("BlazorPlugin", () => {
  describe("deploy", () => {
    let plugin: BlazorPlugin;
    let pluginContext: PluginContext;

    beforeEach(async () => {
      plugin = new BlazorPlugin();
      pluginContext = TestHelper.getFakePluginContext();
      pluginContext.config.set(ConfigInfo.webAppName, "ut");
      pluginContext.config.set(ConfigInfo.appServicePlanName, "ut");
      pluginContext.config.set(ConfigInfo.projectFilePath, "./ut");

      sinon.stub(core, "isVsCallingCli").returns(true);
      sinon.stub(dirWalk, "forEachFileAndDir").resolves(undefined);
      sinon.stub(execute, "execute").resolves("");
      sinon.stub(fs, "pathExists").resolves(true);
      sinon.stub(fs, "readFile").resolves("" as any);
      sinon.stub(AzureClientFactory, "getWebSiteManagementClient").returns({
        webApps: {
          listPublishingCredentials: () => TestHelper.publishingProfile,
        },
      } as any);
      sinon.stub(axios, "post").resolves({ status: 200 } as any);
    });

    afterEach(() => {
      sinon.restore();
    });

    it("happy path", async () => {
      const result = await plugin.deploy(pluginContext);

      chai.assert.isTrue(result.isOk());
    });
  });
});