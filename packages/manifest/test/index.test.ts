import "mocha";
import * as chai from "chai";
import * as path from "path";
import fs from "fs-extra";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosPromise } from "axios";
import { ManifestUtil, TeamsAppManifest, TeamsAppManifestJSONSchema } from "../src";
chai.use(chaiAsPromised);

describe("Manifest manipulation", async () => {
  describe("loadFromPath", async () => {
    it("should succeed when loading from a valid path", async () => {
      const filePath = path.join(__dirname, "manifest.json");
      const manifest = await ManifestUtil.loadFromPath(filePath);
      chai.expect(manifest.id).equals("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    });

    it("should throw when loading from an invalid path", async () => {
      const invalidPath = path.join(__dirname, "invalid.json");
      chai.expect(await fs.pathExists(invalidPath)).equals(false);

      chai.expect(ManifestUtil.loadFromPath(invalidPath)).to.be.rejectedWith(Error);
    });
  });

  describe("writeToPath", async () => {
    const mocker = sinon.createSandbox();
    const fileContent: Map<string, string> = new Map();

    before(() => {
      mocker.stub(fs, "writeJson").callsFake((file: string, obj: any) => {
        fileContent.set(file, JSON.stringify(obj));
      });
    });

    after(() => {
      mocker.restore();
      fileContent.clear();
    });

    it("should succeed when writing to a valid path", async () => {
      const filePath = path.join(__dirname, "test_manifest.json");
      const manifest = new TeamsAppManifest();
      const fakeId = "some-fake-id";
      manifest.id = fakeId;
      await ManifestUtil.writeToPath(filePath, manifest);
      chai.expect(fileContent.get(filePath)).is.not.undefined;
      chai.expect(JSON.parse(fileContent.get(filePath)!).id).equals(fakeId);
    });
  });

  describe("validateManifest", async () => {
    const mocker = sinon.createSandbox();
    const axiosInstanceMock = createMockedAxiosInstance();
    axiosInstanceMock.get = async function <T = any, R = AxiosResponse<T>>(
      url: string,
      config?: AxiosRequestConfig
    ): Promise<R> {
      return { data: loadSchema() } as unknown as R;
    };

    before(() => {
      mocker.stub(axios, "create").returns(axiosInstanceMock);
    });

    after(() => {
      mocker.restore();
    });

    it("should throw if $schema is undefiend", async () => {
      const manifest = new TeamsAppManifest();
      manifest.$schema = undefined;
      chai.expect(ManifestUtil.validateManifest(manifest)).to.be.rejectedWith(Error);
    });

    it("should return empty arry when validation passes", async () => {
      const filePath = path.join(__dirname, "manifest.json");
      const validManifest = await ManifestUtil.loadFromPath(filePath);
      const result = await ManifestUtil.validateManifest(validManifest);
      chai.expect(result).to.be.empty;
    });
  });

  describe("validateManifestAgainstSchema", async () => {
    it("should return empty arry when validation passes", async () => {
      const schema = await loadSchema();
      const filePath = path.join(__dirname, "manifest.json");
      const validManifest = await ManifestUtil.loadFromPath(filePath);
      const result = await ManifestUtil.validateManifestAgainstSchema(validManifest, schema);
      chai.expect(result).to.be.empty;
    });

    it("should return error string arry when manifestVersion doesn't match", async () => {
      // schema has version 1.11
      const schema = await loadSchema();
      const manifest = new TeamsAppManifest();
      chai.expect(manifest.manifestVersion).equals("1.8");
      const result = await ManifestUtil.validateManifestAgainstSchema(manifest, schema);
      chai.expect(result).not.to.be.empty;
      chai.expect(result.length).equals(1);
      // 1.11 doesn't match 1.8, so it should return an error
      chai.expect(result[0]).to.contain("manifestVersion must be equal to constant");
    });
  });
});

async function loadSchema(): Promise<TeamsAppManifestJSONSchema> {
  const schemaPath = path.join(__dirname, "MicrosoftTeams.schema.json");
  return fs.readJson(schemaPath);
}

function createMockedAxiosInstance(): AxiosInstance {
  const mockAxiosInstance = (url: string, config?: AxiosRequestConfig): AxiosPromise => {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.defaults = axios.defaults;
  mockAxiosInstance.interceptors = axios.interceptors;
  mockAxiosInstance.getUri = (config?: AxiosRequestConfig): string => {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.request = function <T = any, R = AxiosResponse<T>>(
    config: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.get = function <T = any, R = AxiosResponse<T>>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.delete = function <T = any, R = AxiosResponse<T>>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.head = function <T = any, R = AxiosResponse<T>>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.options = function <T = any, R = AxiosResponse<T>>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.post = function <T = any, R = AxiosResponse<T>>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.put = function <T = any, R = AxiosResponse<T>>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };
  mockAxiosInstance.patch = function <T = any, R = AxiosResponse<T>>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<R> {
    throw new Error("Method not implemented.");
  };

  return mockAxiosInstance as AxiosInstance;
}
