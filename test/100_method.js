const chai = require("chai");

chai.should();
const supertest = require("supertest");

const Q = require("q");
const http = require("http");

// We will use it to store expected values
const debug = require("debug")("swstest:baseline");
const SwsReqResStats = require("../dist/swsReqResStats.js");
const SwsUtil = require("../dist/swsUtil.js");

const swsTestFixture = require("./testfixture.js");
const swsTestUtils = require("./testutils.js");

// duration of method test - number of requests
let methodTestDuration = 50;
if (process.env.SWS_METHOD_TEST_DURATION) {
  methodTestDuration = parseInt(process.env.SWS_METHOD_TEST_DURATION, 10);
}

const expectedMethodValues = {};

function sendTestRequestsOnce(iteration, deferred) {
  if (iteration <= 0) {
    deferred.resolve();
    return;
  }

  // var methods = ['get','post','put','delete','head','options'];
  const methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

  // Generate random number of requests each iteration
  let reqcntr = 0;

  methods.forEach((method) => {
    if (!(method in expectedMethodValues)) {
      expectedMethodValues[method] = new SwsReqResStats();
    }
    const methodCurrent = expectedMethodValues[method];

    const numReq = swsTestUtils.getRandomArbitrary(0, 5);
    for (let i = 0; i < numReq; i += 1) {
      reqcntr += 1;

      const randomcode = swsTestUtils.getRandomHttpStatusCode();
      const hdr = {
        code: randomcode,
        message: swsTestUtils.getHttpStatusMessage(randomcode),
        delay: swsTestUtils.getRandomArbitrary(0, 100),
        payloadsize: swsTestUtils.getRandomArbitrary(10, 200),
      };
      const xswsResHdr = JSON.stringify(hdr);

      debug(
        ">>>>> %s %s x-sws-res:%s",
        method,
        swsTestFixture.SWS_TEST_MOCK_API,
        xswsResHdr,
      );

      const options = {
        hostname: swsTestFixture.SWS_TEST_DEFAULT_HOST, // 'localhost'
        port: swsTestFixture.SWS_TEST_DEFAULT_PORT, // 3030,
        path: swsTestFixture.SWS_TEST_MOCK_API,
        method,
        headers: {
          "x-sws-res": xswsResHdr,
        },
      };
      let body = null;
      if (method === "post" || method === "put") {
        const reqPayloadSize = swsTestUtils.getRandomArbitrary(10, 200);
        let str = "";
        for (let j = 0; j < reqPayloadSize; j += 1) str += "r";
        body = JSON.stringify([str]);
        options.headers["Content-Type"] = "application/json";
        options.headers["Content-Length"] = Buffer.byteLength(body);
      }

      // Store in expected values
      methodCurrent.request += 1;
      methodCurrent[SwsUtil.getStatusCodeClass(randomcode)] += 1;
      if (SwsUtil.isError(randomcode)) methodCurrent.errors += 1;
      const reqClen = body !== null ? Buffer.byteLength(body) : 0;
      methodCurrent.total_req_clength += reqClen;
      const resClen = hdr.payloadsize;
      methodCurrent.total_res_clength += resClen;
      if (reqClen > methodCurrent.max_req_clength)
        methodCurrent.max_req_clength = reqClen;
      if (resClen > methodCurrent.max_res_clength)
        methodCurrent.max_res_clength = resClen;
      methodCurrent.avg_req_clength = Math.floor(
        methodCurrent.total_req_clength / methodCurrent.requests,
      );
      methodCurrent.avg_res_clength = Math.floor(
        methodCurrent.total_res_clength / methodCurrent.requests,
      );

      // eslint-disable-next-line no-loop-func
      const req = http.request(options, () => {
        reqcntr -= 1;
        if (reqcntr <= 0) {
          sendTestRequestsOnce(iteration - 1, deferred);
        }
      });
      body !== null ? req.end(body) : req.end();
    }
  });
}

function generateTestRequests() {
  const deferred = Q.defer();
  sendTestRequestsOnce(methodTestDuration, deferred);
  return deferred.promise;
}

setImmediate(() => {
  describe("Method statistics test", () => {
    this.timeout(60000);

    let appTimelineTest = null;
    let apiTimelineTest = null;

    let methodStatsInitial = null;
    let methodStatsCurrent = null;

    // 1 second
    const timelineBucketDuration = 1000;

    describe("Initialize", () => {
      it("should initialize example app", (done) => {
        supertest(swsTestFixture.SWS_TEST_DEFAULT_URL)
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .expect(200)
          .end((err, res) => {
            if (err) {
              if (res && res.status === 403) {
                // let st = supertest(swsTestFixture.SWS_TEST_DEFAULT_URL)
                apiTimelineTest = supertest
                  .agent(swsTestFixture.SWS_TEST_DEFAULT_URL)
                  .auth("swagger-stats", "swagger-stats");
                done();
              } else {
                process.env.SWS_TEST_TIMEBUCKET = timelineBucketDuration;
                // eslint-disable-next-line global-require
                appTimelineTest = require("../examples/testapp/testapp.js");
                apiTimelineTest = supertest(
                  `http://localhost:${appTimelineTest.app.get("port")}`,
                );
                setTimeout(done, 500);
              }
            } else {
              apiTimelineTest = supertest(swsTestFixture.SWS_TEST_DEFAULT_URL);
              done();
            }
          });
      });
      it("should collect initial statistics values", (done) => {
        apiTimelineTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "method" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            // eslint-disable-next-line no-unused-expressions
            res.body.should.not.be.empty;
            res.body.should.have.property("method");
            methodStatsInitial = res.body.method;
            done();
          });
      });
    });

    describe("Send Test Requests", () => {
      it(`should send random number of test requests ${methodTestDuration} times`, (done) => {
        generateTestRequests().then(() => {
          debug("generateRandomRequests - finished!");
          done();
        });
      });
    });

    // Get API Stats, and check that number of requests / responses is correctly calculated
    describe("Check Statistics", () => {
      it("should return collected statistics", (done) => {
        apiTimelineTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "method" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            // eslint-disable-next-line no-unused-expressions
            res.body.should.not.be.empty;
            res.body.should.have.property("method");
            methodStatsCurrent = res.body.method;
            done();
          });
      });

      it("should have correct values of method statistics", (done) => {
        // eslint-disable-next-line no-restricted-syntax, guard-for-in
        for (const method in expectedMethodValues) {
          // debug('Comparing[%s]: Expected %s Actual:%s', method, JSON.stringify(expected_method_values[method]),JSON.stringify(methodStatsCurrent[method]) );
          console.log(
            "Comparing[%s]: Expected %s Actual:%s",
            method,
            JSON.stringify(expectedMethodValues[method]),
            JSON.stringify(methodStatsCurrent[method]),
          );
          methodStatsCurrent.should.have.property(method);
          const adjustedStats = swsTestUtils.getRRStatsDiff(
            methodStatsInitial[method],
            methodStatsCurrent[method],
          );
          console.log(
            "Comparing[%s]: Expected %s Adjusted :%s",
            method,
            JSON.stringify(expectedMethodValues[method]),
            JSON.stringify(adjustedStats),
          );

          expectedMethodValues[method].requests.should.be.equal(
            adjustedStats.requests,
          );
          expectedMethodValues[method].errors.should.be.equal(
            adjustedStats.errors,
          );
          expectedMethodValues[method].success.should.be.equal(
            adjustedStats.success,
          );
          expectedMethodValues[method].redirect.should.be.equal(
            adjustedStats.redirect,
          );
          expectedMethodValues[method].client_error.should.be.equal(
            adjustedStats.client_error,
          );
          expectedMethodValues[method].server_error.should.be.equal(
            adjustedStats.server_error,
          );
          expectedMethodValues[method].total_req_clength.should.be.equal(
            adjustedStats.total_req_clength,
          );
          expectedMethodValues[method].total_res_clength.should.be.equal(
            adjustedStats.total_res_clength,
          );
          methodStatsCurrent[method].avg_req_clength.should.be.equal(
            Math.floor(
              methodStatsCurrent[method].total_req_clength /
                methodStatsCurrent[method].requests,
            ),
          );
          methodStatsCurrent[method].avg_res_clength.should.be.equal(
            Math.floor(
              methodStatsCurrent[method].total_res_clength /
                methodStatsCurrent[method].responses,
            ),
          );
        }

        done();
      });
    });
  });

  // eslint-disable-next-line no-undef
  run();
});
