import * as chai from "chai";
import * as spies from "chai-spies";
import { Stage, returnUserError } from "@microsoft/teamsfx-api";
import { ExtTelemetry } from "../../../src/telemetry/extTelemetry";
import { TelemetryEvent } from "../../../src/telemetry/extTelemetryEvents";
import sinon = require("sinon");
import * as commonUtils from "../../../src/utils/commonUtils";

chai.use(spies);
const spy = chai.spy;

const reporterSpy = spy.interface({
  sendTelemetryErrorEvent(
    eventName: string,
    properties?: { [p: string]: string },
    measurements?: { [p: string]: number },
    errorProps?: string[]
  ): void {},
  sendTelemetryEvent(
    eventName: string,
    properties?: { [p: string]: string },
    measurements?: { [p: string]: number }
  ): void {},
  sendTelemetryException(
    error: Error,
    properties?: { [p: string]: string },
    measurements?: { [p: string]: number }
  ): void {},
});

suite("ExtTelemetry", () => {
  suite("setHasSentTelemetry", () => {
    test("query-expfeature", () => {
      const eventName = "query-expfeature";
      ExtTelemetry.setHasSentTelemetry(eventName);
      chai.expect(ExtTelemetry.hasSentTelemetry).equals(false);
    });

    test("other-event", () => {
      const eventName = "other-event";
      ExtTelemetry.setHasSentTelemetry(eventName);
      chai.expect(ExtTelemetry.hasSentTelemetry).equals(true);
    });
  });

  suite("stageToEvent", () => {
    test("Stage.create", () => {
      const stage = Stage.create;
      chai.expect(ExtTelemetry.stageToEvent(stage)).equals(TelemetryEvent.CreateProject);
    });

    test("Stage.update", () => {
      const stage = Stage.update;
      chai.expect(ExtTelemetry.stageToEvent(stage)).equals(TelemetryEvent.AddResource);
    });

    test("Stage.provision", () => {
      const stage = Stage.provision;
      chai.expect(ExtTelemetry.stageToEvent(stage)).equals(TelemetryEvent.Provision);
    });

    test("Stage.deploy", () => {
      const stage = Stage.deploy;
      chai.expect(ExtTelemetry.stageToEvent(stage)).equals(TelemetryEvent.Deploy);
    });

    test("Stage.publish", () => {
      const stage = Stage.publish;
      chai.expect(ExtTelemetry.stageToEvent(stage)).equals(TelemetryEvent.Publish);
    });

    test("Stage.creatEnv", () => {
      const stage = Stage.createEnv;
      chai.expect(ExtTelemetry.stageToEvent(stage)).equals(TelemetryEvent.CreateNewEnvironment);
    });

    test("unknown", () => {
      const stage = "unknown";
      chai.expect(ExtTelemetry.stageToEvent(stage as Stage)).equals(undefined);
    });
  });

  suite("Send Telemetry", () => {
    suiteSetup(() => {
      chai.util.addProperty(ExtTelemetry, "reporter", () => reporterSpy);
      const sandbox = sinon.createSandbox();
      sandbox.stub(commonUtils, "getIsExistingUser").returns(undefined);
    });

    test("sendTelemetryEvent", () => {
      ExtTelemetry.sendTelemetryEvent(
        "sampleEvent",
        { stringProp: "some string" },
        { numericMeasure: 123 }
      );

      chai.expect(reporterSpy.sendTelemetryEvent).to.have.been.called.with(
        "sampleEvent",
        {
          stringProp: "some string",
          component: "extension",
          "is-existing-user": "",
        },
        { numericMeasure: 123 }
      );
    });

    test("sendTelemetryErrorEvent", () => {
      const error = returnUserError(new Error("test error message"), "test", "UserTestError");
      ExtTelemetry.sendTelemetryErrorEvent(
        "sampleEvent",
        error,
        { stringProp: "some string" },
        { numericMeasure: 123 },
        ["errorProps"]
      );

      chai.expect(reporterSpy.sendTelemetryErrorEvent).to.have.been.called.with(
        "sampleEvent",
        {
          stringProp: "some string",
          component: "extension",
          success: "no",
          "is-existing-user": "",
          "error-type": "user",
          "error-message": `${error.message}${error.stack ? "\nstack:\n" + error.stack : ""}`,
          "error-code": "test.UserTestError",
        },
        { numericMeasure: 123 },
        ["errorProps"]
      );
    });

    test("sendTelemetryException", () => {
      const error = returnUserError(new Error("test error message"), "test", "UserTestError");
      ExtTelemetry.sendTelemetryException(
        error,
        { stringProp: "some string" },
        { numericMeasure: 123 }
      );

      chai.expect(reporterSpy.sendTelemetryException).to.have.been.called.with(
        error,
        {
          stringProp: "some string",
          component: "extension",
          "is-existing-user": "",
        },
        { numericMeasure: 123 }
      );
    });
  });
});
