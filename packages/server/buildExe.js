// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const fs = require("fs-extra");
const path = require("path");
const pkg = require("pkg");
const pkg_fetch = require("pkg-fetch");
const rcedit = require("rcedit");
const { version } = require("./package.json");

process.env.PKG_CACHE_PATH = path.resolve("./.pkg-cache");

const target = "node14-win-x64";
const [nodeRange, platform, arch] = target.split("-");

(async () => {
  const fetched = await pkg_fetch.need({ nodeRange, platform, arch });
  if (fetched) {
    const dirname = path.dirname(fetched);
    const filename = path.basename(fetched);
    await rcedit(fetched, {
      "version-string": {
        CompanyName: "Microsoft",
        LegalCopyright: "\xA9 Microsoft Corporation. All rights reserved.",
        ProductName: "Microsoft Teams Toolkit",
        FileDescription: "Microsoft Teams Toolkit Server",
        InternalFilename: "server",
        OriginalFilename: "server.exe",
      },
      "file-version": version,
      "product-version": version,
      icon: "icons/Teams.ico",
      "requested-execution-level": "asInvoker",
      // "application-manifest": "",
    });
    const built = path.join(dirname, filename.replace("fetched", "built"));
    await fs.rename(fetched, built);

    await pkg.exec([
      "./lib/index.js",
      "-t",
      target,
      "-o",
      "./lib/server",
      "-c",
      "pkg.json",
      "--build",
    ]);
  }
})();
