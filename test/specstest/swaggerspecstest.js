const chai = require("chai");

chai.should();
const { expect } = chai;

const fs = require("fs");
const cuid = require("cuid");
const path = require("path");
const cp = require("child_process");

const swaggerSpecifications = require("./apisgurulist.json");
const debug = require("debug")("swstest:swaggerspecstest");

const APICORETEST = path.join(__dirname, "..", "200_apicore.js");
const MOCHA = path.join(
  __dirname,
  "..",
  "..",
  "node_modules",
  ".bin",
  "_mocha",
);

const swaggerSpecsInfo = [];

function preProcessSwaggerSpecs() {
  for (const specName in swaggerSpecifications) {
    const specInfo = swaggerSpecifications[specName];
    if ("preferred" in specInfo && "versions" in specInfo) {
      if (specInfo.preferred in specInfo.versions) {
        const specVersion = specInfo.versions[specInfo.preferred];
        let specURL = null;
        if ("swaggerUrl" in specVersion) {
          specURL = specVersion.swaggerUrl;
        } else if ("swaggerYamlUrl" in specVersion) {
          specURL = specVersion.swaggerYamlUrl;
        }
        if (specURL) {
          debug(
            "Adding Spec: %s version %s url %s",
            specName,
            specInfo.preferred,
            specURL,
          );
          swaggerSpecsInfo.push({
            name: specName,
            version: specInfo.preferred,
            url: specURL,
          });
        }
      }
    }
  }
}

preProcessSwaggerSpecs();

describe("Swagger Specifications Test", function () {
  this.timeout(30000);

  swaggerSpecsInfo.forEach((swaggerSpec) => {
    it(`should execute core API test for ${swaggerSpec.name} v. ${swaggerSpec.version}`, (done) => {
      const options = {
        maxBuffer: 1024 * 1024,
        env: { SWS_SPECTEST_URL: swaggerSpec.url },
      };
      const cmd = `${MOCHA}  --timeout 10000 --delay ${APICORETEST}`;
      cp.exec(cmd, (error, stdout, stderr) => {
        if (error) {
          debug(
            "ERROR executing core API test for %s: %s",
            swaggerSpec.url,
            error,
          );
          fs.appendFileSync("testerrors.log", stdout);
          return done(error);
        }
        debug("Success!");
        done();
      });
    });
  });
});
