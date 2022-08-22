/* eslint-disable no-unused-expressions */
const chai = require("chai");

chai.should();

const http = require("http");
const supertest = require("supertest");
const SwaggerParser = require("swagger-parser");

const debug = require("debug")("swstest:apicore");

const swsTestFixture = require("./testfixture.js");
const swsTestUtils = require("./testutils.js");

let swaggerSpecUrl = "./examples/spectest/petstore3.yaml"; // Default
if (process.env.SWS_SPECTEST_URL) {
  swaggerSpecUrl = process.env.SWS_SPECTEST_URL;
}
debug("Using Swagger Specification: %s", swaggerSpecUrl);

// https://api.apis.guru/v2/specs/amazonaws.com/rekognition/2016-06-27/swagger.json

let swaggerSpec = null;
const parser = new SwaggerParser();

let apiOperationsList = [];

// First we need to load and validate swagger spec
// Then we can generate dynamic it tests based on results of swagger spec analysis
// Use --delay mocha flag

parser.validate(swaggerSpecUrl, (err, api) => {
  if (err) {
    debug(`Error validating swagger spec: ${err}`);
    return;
  }

  swaggerSpec = api;
  apiOperationsList = swsTestUtils.generateApiOpList(swaggerSpec);

  describe("API core test", () => {
    let appSpecTest = null;
    let apiSpecTest = null;

    let apiStatsInitial = null;

    describe("Initialize", () => {
      it("should initialize spectest app", (done) => {
        supertest(swsTestFixture.SWS_SPECTEST_DEFAULT_URL)
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .expect(200)
          .end((err1, res) => {
            if (err1) {
              if (res && res.status === 403) {
                apiSpecTest = supertest
                  .agent(swsTestFixture.SWS_TEST_DEFAULT_URL)
                  .auth("swagger-stats", "swagger-stats");
                done();
              } else {
                process.env.SWS_SPECTEST_URL = swaggerSpecUrl;
                // eslint-disable-next-line global-require
                appSpecTest = require("../examples/spectest/spectest.js");
                apiSpecTest = supertest(
                  `http://localhost:${appSpecTest.app.get("port")}`,
                );
                setTimeout(done, 500);
              }
            } else {
              apiSpecTest = supertest(swsTestFixture.SWS_SPECTEST_DEFAULT_URL);
              done();
            }
          });
      });

      it("should collect initial statistics values", (done) => {
        apiSpecTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "apidefs,apistats" })
          .expect(200)
          .end((err1, res) => {
            if (err1) return done(err1);

            res.body.should.not.be.empty;
            apiStatsInitial = res.body;
            done();
          });
      });
    });

    describe("Inspect API statistics", () => {
      it("should find each API operation from swagger spec in stats", (done) => {
        // Loop over all requests
        const basePath = swsTestUtils.getApiBasePath(swaggerSpec);

        // getApiFullPath
        // eslint-disable-next-line no-restricted-syntax
        for (const path of Object.keys(swaggerSpec.paths)) {
          const pathDef = swaggerSpec.paths[path];

          // Create full path
          const fullPath = swsTestUtils.getApiFullPath(basePath, path);

          const operations = [
            "get",
            "put",
            "post",
            "delete",
            "options",
            "head",
            "patch",
          ];
          for (let i = 0; i < operations.length; i += 1) {
            const op = operations[i];
            if (op in pathDef) {
              const opDef = pathDef[op];
              const opMethod = op.toUpperCase();

              debug("Detected: %s %s", opMethod, path);

              // We must find the same API (path+method) in swagger-stats
              apiStatsInitial.apidefs.should.have.property(fullPath);
              apiStatsInitial.apidefs[fullPath].should.have.property(opMethod);

              apiStatsInitial.apistats.should.have.property(fullPath);
              apiStatsInitial.apistats[fullPath].should.have.property(opMethod);

              apiStatsInitial.apidefs[fullPath][opMethod].should.have.property(
                "swagger",
              );
              apiStatsInitial.apidefs[fullPath][opMethod].swagger.should.equal(
                true,
              );

              // We must find the same properties of this api def in swagger-stats
              if ("deprecated" in opDef) {
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].should.have.property("deprecated");
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].deprecated.should.equal(opDef.deprecated);
              }

              if ("operationId" in opDef) {
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].should.have.property("operationId");
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].operationId.should.equal(opDef.operationId);
              }

              if ("description" in opDef) {
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].should.have.property("description");
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].description.should.equal(opDef.description);
              }

              if ("summary" in opDef) {
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].should.have.property("summary");
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].summary.should.equal(opDef.summary);
              }

              if ("tags" in opDef) {
                apiStatsInitial.apidefs[fullPath][
                  opMethod
                ].should.have.property("tags");
                apiStatsInitial.apidefs[fullPath][opMethod].tags.should.be.eql(
                  opDef.tags,
                );
                // should(apiStatsInitial.api[fullPath][opMethod].tags.sort()).be.eql(opDef.tags.sort());
              }
            }
          }
        }
        done();
      });
    });

    describe("Validate statistics for each API Operations", () => {
      const simulatedRequests = [
        {
          name: "success",
          hdr: { code: 200, message: "OK", delay: 0, payloadsize: 0 },
        },
        {
          name: "redirect",
          hdr: { code: 302, message: "Moved", delay: 0, payloadsize: 50 },
        },
        {
          name: "client error",
          hdr: { code: 404, message: "Not Found", delay: 0, payloadsize: 200 },
        },
        {
          name: "server error",
          hdr: {
            code: 500,
            message: "Server Error",
            delay: 10,
            payloadsize: 300,
          },
        },
      ];

      let apiOpStatsInitial = null;
      let apiOpStatsUpdated = null;

      apiOperationsList.forEach((apiop) => {
        it(`should retrieve initial statistics for ${apiop.label}`, (done) => {
          apiSpecTest
            .get(swsTestFixture.SWS_TEST_STATS_API)
            .query({
              fields: "apiop",
              method: apiop.method,
              path: apiop.path,
            })
            .expect(200)
            .end((err1, res) => {
              if (err1) return done(err1);

              res.body.should.not.be.empty;

              const stats = res.body;
              stats.should.have.property("all");
              stats.should.have.property("apiop");
              stats.apiop.should.have.property(apiop.path);
              stats.apiop[apiop.path].should.have.property(apiop.method);

              const opstats = stats.apiop[apiop.path][apiop.method];

              opstats.should.have.property("defs");
              opstats.should.have.property("details");
              opstats.should.have.property("stats");

              apiOpStatsInitial = opstats.stats;

              debug("INITIAL STATS: %s", JSON.stringify(apiOpStatsInitial));
              done();
            });
        });

        simulatedRequests.forEach((reqdef) => {
          it(`should simulate ${reqdef.name} for ${apiop.label}`, (done) => {
            // Generate request
            const { opCallDef } = apiop;
            const xswsResHdr = JSON.stringify(reqdef.hdr);
            debug(
              ">>>>> %s %s query:%s x-sws-res:%s",
              opCallDef.method,
              opCallDef.uri,
              JSON.stringify(opCallDef.query),
              xswsResHdr,
            );
            // Use raw node http to send test request, so we can send correctly requests to uri like /#Create ...
            const options = {
              hostname: swsTestFixture.SWS_TEST_DEFAULT_HOST, // 'localhost'
              port: swsTestFixture.SWS_TEST_SPECTEST_PORT, // 3040,
              path: opCallDef.uri,
              method: opCallDef.method,
              headers: {
                "x-sws-res": xswsResHdr,
              },
            };
            const req = http.request(options, (res) => {
              res.should.have.property("statusCode");
              res.statusCode.should.be.equal(reqdef.hdr.code);
              done();
            });
            req.end();
          });
        });

        it(`should retrieve current statistics for ${apiop.label}`, (done) => {
          apiSpecTest
            .get(swsTestFixture.SWS_TEST_STATS_API)
            .query({
              fields: "apiop",
              method: apiop.method,
              path: apiop.path,
            })
            .expect(200)
            .end((err1, res) => {
              if (err1) return done(err1);

              res.body.should.not.be.empty;

              const stats = res.body;
              stats.should.have.property("all");
              stats.should.have.property("apiop");
              stats.apiop.should.have.property(apiop.path);
              stats.apiop[apiop.path].should.have.property(apiop.method);

              const opstats = stats.apiop[apiop.path][apiop.method];

              opstats.should.have.property("defs");
              opstats.should.have.property("details");
              opstats.should.have.property("stats");

              apiOpStatsUpdated = opstats.stats;

              debug("CURRENT STATS: %s", JSON.stringify(apiOpStatsUpdated));
              done();
            });
        });

        // Check statistics values
        it(`should have correct statistics values for ${apiop.label}`, (done) => {
          apiOpStatsUpdated.requests.should.be.equal(
            apiOpStatsInitial.requests + 4,
          );
          apiOpStatsUpdated.responses.should.be.equal(
            apiOpStatsInitial.responses + 4,
          );
          apiOpStatsUpdated.errors.should.be.equal(
            apiOpStatsInitial.errors + 2,
          );
          apiOpStatsUpdated.success.should.be.equal(
            apiOpStatsInitial.success + 1,
          );
          apiOpStatsUpdated.redirect.should.be.equal(
            apiOpStatsInitial.redirect + 1,
          );
          apiOpStatsUpdated.client_error.should.be.equal(
            apiOpStatsInitial.client_error + 1,
          );
          apiOpStatsUpdated.server_error.should.be.equal(
            apiOpStatsInitial.server_error + 1,
          );
          apiOpStatsUpdated.total_time.should.be.at.least(
            apiOpStatsInitial.total_time,
          );
          apiOpStatsUpdated.max_time.should.be.at.least(
            apiOpStatsInitial.max_time,
          );
          apiOpStatsUpdated.avg_time
            .toFixed(4)
            .should.be.equal(
              (
                apiOpStatsUpdated.total_time / apiOpStatsUpdated.requests
              ).toFixed(4),
            );
          apiOpStatsUpdated.total_req_clength.should.be.at.least(
            apiOpStatsInitial.total_req_clength,
          );
          apiOpStatsUpdated.max_req_clength.should.be.at.least(
            apiOpStatsInitial.max_req_clength,
          );
          apiOpStatsUpdated.avg_req_clength
            .toFixed(4)
            .should.be.equal(
              (
                apiOpStatsUpdated.total_req_clength / apiOpStatsUpdated.requests
              ).toFixed(4),
            );
          apiOpStatsUpdated.total_res_clength.should.be.at.least(
            apiOpStatsInitial.total_res_clength + 100,
          );
          apiOpStatsUpdated.max_res_clength.should.be.at.least(
            apiOpStatsInitial.max_res_clength,
          );
          (apiOpStatsUpdated.avg_res_clength + 10).should.be.at.least(
            apiOpStatsUpdated.total_res_clength / apiOpStatsUpdated.responses,
          );
          done();
        });
      });
    });

    // Check that metrics are returned, using both prom-client and internal implementations
    describe("Check Metrics", () => {
      it("should return Prometheus metrics", (done) => {
        apiSpecTest
          .get(swsTestFixture.SWS_TEST_METRICS_API)
          .expect(200)
          .expect("Content-Type", /plain/)
          .end((err1, res) => {
            if (err1) return done(err1);

            res.text.should.not.be.empty;

            // TODO Validate metric values

            done();
          });
      });
    });
  });

  // eslint-disable-next-line no-undef
  run();
});
