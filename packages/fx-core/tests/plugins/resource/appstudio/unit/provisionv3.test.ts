// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import "mocha";
import * as chai from "chai";
import sinon from "sinon";
import { v4 as uuid } from "uuid";
import * as os from "os";
import * as path from "path";
import fs from "fs-extra";
import AdmZip from "adm-zip";
import {
  ProjectSettings,
  v2,
  Platform,
  TokenProvider,
  TeamsAppManifest,
} from "@microsoft/teamsfx-api";
import { AppStudioPluginV3 } from "../../../../../src/plugins/resource/appstudio/v3";
import { AppStudioClient } from "./../../../../../src/plugins/resource/appstudio/appStudio";
import { Constants } from "../../../../../src/plugins/resource/appstudio/constants";
import { IAppDefinition } from "./../../../../../src/plugins/resource/appstudio/interfaces/IAppDefinition";
import { newEnvInfoV3 } from "../../../../../src/core/tools";
import { LocalCrypto } from "../../../../../src/core/crypto";
import {
  MockedAppStudioTokenProvider,
  MockedAzureAccountProvider,
  MockedGraphTokenProvider,
  MockedSharepointProvider,
  MockedLogProvider,
  MockedTelemetryReporter,
} from "../../../solution/util";
import { MockUserInteraction } from "../helper";

describe("Provision Teams app with Azure", () => {
  const sandbox = sinon.createSandbox();

  const appDef: IAppDefinition = {
    appName: "fake",
    teamsAppId: uuid(),
    userList: [],
  };

  let plugin: AppStudioPluginV3;
  let context: v2.Context;
  let inputs: v2.InputsWithProjectPath;
  let mockedTokenProvider: TokenProvider;

  beforeEach(async () => {
    plugin = new AppStudioPluginV3();

    const projectSettings: ProjectSettings = {
      appName: "fake",
      projectId: uuid(),
    };

    inputs = {
      platform: Platform.VSCode,
      projectPath: path.join(os.tmpdir(), projectSettings.appName),
      appPackagePath: path.join(os.tmpdir(), projectSettings.appName),
    };

    mockedTokenProvider = {
      azureAccountProvider: new MockedAzureAccountProvider(),
      appStudioToken: new MockedAppStudioTokenProvider(),
      graphTokenProvider: new MockedGraphTokenProvider(),
      sharepointTokenProvider: new MockedSharepointProvider(),
    };

    context = {
      userInteraction: new MockUserInteraction(),
      logProvider: new MockedLogProvider(),
      telemetryReporter: new MockedTelemetryReporter(),
      cryptoProvider: new LocalCrypto(projectSettings.projectId),
      projectSetting: projectSettings,
    };

    sandbox.stub<any, any>(fs, "pathExists").resolves(true);
    sandbox.stub(fs, "readFile").callsFake(async () => {
      const zip = new AdmZip();
      zip.addFile(Constants.MANIFEST_FILE, Buffer.from(JSON.stringify(new TeamsAppManifest())));
      zip.addFile("color.png", new Buffer(""));
      zip.addFile("outlie.png", new Buffer(""));

      const archivedFile = zip.toBuffer();
      return archivedFile;
    });
  });

  afterEach(async () => {
    sandbox.restore();
  });

  it("Register Teams app with user provided zip", async () => {
    sandbox.stub(AppStudioClient, "createApp").resolves(appDef);
    const teamsAppId = await plugin.registerTeamsApp(
      context,
      inputs,
      newEnvInfoV3(),
      mockedTokenProvider
    );
    chai.assert.isTrue(teamsAppId.isOk());
  });

  it("Update Teams app with user provided zip", async () => {
    const error = new Error();
    error.name = "409";
    sandbox.stub(AppStudioClient, "createApp").rejects(error);
    sandbox.stub(AppStudioClient, "updateApp").resolves(appDef);
    const teamsAppId = await plugin.registerTeamsApp(
      context,
      inputs,
      newEnvInfoV3(),
      mockedTokenProvider
    );
    chai.assert.isTrue(teamsAppId.isOk());
  });
});
