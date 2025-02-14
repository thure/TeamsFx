// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { assert, use as chaiUse } from "chai";
import * as chaiPromises from "chai-as-promised";
import { MsGraphAuthProvider, TeamsFx, IdentityType } from "../../../src";
import {
  getSsoTokenFromTeams,
  MockEnvironmentVariable,
  RestoreEnvironmentVariable,
  AADJwtPayLoad,
} from "../helper";
import jwtDecode from "jwt-decode";

chaiUse(chaiPromises);
let restore: () => void;

describe("MsGraphAuthProvider Tests - Node", () => {
  let ssoToken = "";
  beforeEach(async function () {
    restore = MockEnvironmentVariable();

    ssoToken = await getSsoTokenFromTeams();
  });

  afterEach(() => {
    RestoreEnvironmentVariable(restore);
  });

  it("getAccessToken should success with OnBehalfOfUserCredential", async function () {
    const scopes = "User.Read";
    const teamsfx = new TeamsFx().setSsoToken(ssoToken);
    const authProvider: MsGraphAuthProvider = new MsGraphAuthProvider(teamsfx, scopes);
    const accessToken = await authProvider.getAccessToken();

    const decodedToken = jwtDecode<AADJwtPayLoad>(accessToken);
    assert.strictEqual(decodedToken.aud, "00000003-0000-0000-c000-000000000000");
    assert.strictEqual(decodedToken.appid, process.env.M365_CLIENT_ID);
    assert.strictEqual(decodedToken.idtyp, "user");
    assert.strictEqual(decodedToken.upn, process.env.SDK_INTEGRATION_TEST_ACCOUNT_NAME);
    assert.isTrue(decodedToken.scp!.indexOf(scopes) >= 0);
  });

  it("getAccessToken should success with AppCredential", async function () {
    const scopes = ["https://graph.microsoft.com/.default"];
    const teamsfx = new TeamsFx(IdentityType.App);
    const authProvider: MsGraphAuthProvider = new MsGraphAuthProvider(teamsfx, scopes);
    const accessToken = await authProvider.getAccessToken();

    const decodedToken = jwtDecode<AADJwtPayLoad>(accessToken);
    assert.strictEqual(decodedToken.aud, "https://graph.microsoft.com");
    assert.strictEqual(decodedToken.appid, process.env.M365_CLIENT_ID);
    assert.strictEqual(decodedToken.idtyp, "app");
  });
});
