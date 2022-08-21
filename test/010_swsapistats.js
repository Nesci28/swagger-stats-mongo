const fs = require("fs");
const path = require("path");

const util = require("util");
const chai = require("chai");

chai.should();
const { expect } = chai;
const supertest = require("supertest");
const cuid = require("cuid");

const debug = require("debug")("swstest:baseline");

const swsTestFixture = require("./testfixture");
const swsUtil = require("../lib/swsUtil");
const swsInterface = require("../lib/swsInterface");
const swsAPIStats = require("../lib/swsAPIStats");

setImmediate(() => {
  describe("swsAPIStats test", function () {
    this.timeout(2000);

    // Get API Stats, and check that number of requests / responses is correctly calculated
    describe("Check swsAPIStats", () => {
      const apistats = new swsAPIStats();

      it("should not return data for unknown operation", (done) => {
        expect(apistats.getAPIOperationStats()).to.deep.equal({});
        expect(apistats.getAPIOperationStats("GET")).to.deep.equal({});
        expect(apistats.getAPIOperationStats("GET", "/unknown")).to.deep.equal({
          GET: { "/unknown": {} },
        });
        done();
      });

      it("should not initialize without Swagger spec", (done) => {
        apistats.initialize();
        apistats.initialize(null);
        apistats.initialize({});
        apistats.initialize({ swaggerSpec: null });
        apistats.initialize({ swaggerSpec: {} });
        expect(apistats.apiMatchIndex).to.deep.equal({});
        expect(apistats.apidefs).to.deep.equal({});
        expect(apistats.apistats).to.deep.equal({});
        expect(apistats.apidetails).to.deep.equal({});
        done();
      });

      it("should initialize basePath from Swagger spec", (done) => {
        apistats.initialize({ swaggerSpec: { basePath: "/base" } });
        expect(apistats.basePath).to.equal("/base/");
        apistats.initialize({ swaggerSpec: { basePath: "base" } });
        expect(apistats.basePath).to.equal("/base/");
        apistats.initialize({ swaggerSpec: { basePath: "base/" } });
        expect(apistats.basePath).to.equal("/base/");
        apistats.initialize({ swaggerSpec: { basePath: "/base/" } });
        expect(apistats.basePath).to.equal("/base/");
        apistats.initialize({ swaggerSpec: { basePath: "/" } });
        expect(apistats.basePath).to.equal("/");
        apistats.initialize({ swaggerSpec: { basePath: "" } });
        expect(apistats.basePath).to.equal("/");
        apistats.initialize({ swaggerSpec: { basePath: null } });
        expect(apistats.basePath).to.equal("/");
        expect(apistats.getFullPath("test")).to.equal("/test");
        expect(apistats.getFullPath("/test")).to.equal("/test");
        apistats.initialize({ swaggerSpec: { basePath: "base" } });
        expect(apistats.basePath).to.equal("/base/");
        expect(apistats.getFullPath("test")).to.equal("/base/test");
        expect(apistats.getFullPath("/test")).to.equal("/base/test");
        done();
      });
    });
  });

  run();
});
