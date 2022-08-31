const chai = require("chai");

chai.should();
const supertest = require("supertest");
const request = require("request");
const cuid = require("cuid");

// We will use it to store expected values
const debug = require("debug")("swstest:auth");

const swsTestFixture = require("./testfixture.js");

const swaggerSpecUrl = "./examples/spectest/petstore.yaml"; // Default

let appSpecTest = null;
let apiSpecTest = null;

const elasticURL = "http://swagger-stats-elasticsearch:9200";
const indexTemplate = require("../schema/elasticsearch/api_index_template.json");

const testRequestId = cuid();

setImmediate(() => {
  describe("Elasticsearch test", () => {
    describe("Initialize", () => {
      it("should initialize spectest  app", (done) => {
        supertest(swsTestFixture.SWS_SPECTEST_DEFAULT_URL)
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .expect(200)
          .end((err, res) => {
            if (err) {
              if (res && res.status === 403) {
                apiSpecTest = supertest
                  .agent(swsTestFixture.SWS_TEST_DEFAULT_URL)
                  .auth("swagger-stats", "swagger-stats");
                done();
              } else {
                process.env.SWS_SPECTEST_URL = swaggerSpecUrl;
                process.env.SWS_ELASTIC = elasticURL;
                process.env.SWS_ELASTIC_INDEX_PREFIX = "swaggerstats-";
                // eslint-disable-next-line global-require
                appSpecTest = require("../examples/spectest/spectest.js");
                const dest = `http://localhost:${appSpecTest.app.get("port")}`;
                apiSpecTest = supertest(dest);
                setTimeout(done, 2000);
              }
            } else {
              apiSpecTest = supertest(swsTestFixture.SWS_SPECTEST_DEFAULT_URL);
              done();
            }
          });
      }).timeout(3000);

      it("should get index template from Elasticsearch ", (done) => {
        // Check if there is a template
        const templateURL = `${elasticURL}/_template/template_api`;
        request.get(
          { url: templateURL, json: true },
          (error, response, body) => {
            if (error) {
              debug("Error querying template:", JSON.stringify(error));
              done(error);
            } else {
              response.should.have.property("statusCode");
              response.statusCode.should.be.equal(200);
              body.should.have.property("template_api");
              body.template_api.should.have.property("version");
              body.template_api.version.should.be.equal(indexTemplate.version);
              done();
            }
          },
        );
      });

      it("should send test requests", (done) => {
        for (let i = 0; i < 10; i += 1) {
          apiSpecTest
            .get("/v2/mockapi")
            .set("x-ses-test-id", testRequestId)
            .set("x-ses-test-seq", i)
            .set(
              "x-sws-res",
              '{"code":"200","message":"TEST","delay":"50","payloadsize":"5"}',
            )
            .expect(200)
            .end((err) => {
              if (err) return done(err);
            });
        }
        setTimeout(done, 5100);
      }).timeout(10000);

      it("should find test request in Elasticsearch", (done) => {
        const searchBody = {
          from: 0,
          size: 100,
          query: {
            term: {
              "http.request.headers.x-ses-test-id": testRequestId,
            },
          },
        };

        const searchURL = `${elasticURL}/_search`; // ?q='+test_request_id;
        request.post(
          { url: searchURL, body: searchBody, json: true },
          (error, response, body) => {
            if (error) {
              debug("Error searching for request:", JSON.stringify(error));
              done(error);
            } else {
              response.should.have.property("statusCode");
              response.statusCode.should.be.equal(200);
              body.should.have.property("hits");
              body.hits.should.have.property("total");
              // (body.hits.total.value).should.be.equal(10);
              done();
            }
          },
        );
      });
    });
  });

  // eslint-disable-next-line no-undef
  run();
});
