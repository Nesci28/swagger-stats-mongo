const chai = require("chai");

chai.should();
const supertest = require("supertest");

const Q = require("q");
const http = require("http");

// We will use it to store expected values
const debug = require("debug")("swstest:baseline");
const SwsReqResStats = require("../dist/swsReqResStats.js");
const { SwsUtil } = require("../dist/swsUtil.js");

const swsTestFixture = require("./testfixture.js");
const swsTestUtils = require("./testutils.js");

let appTimelineTest = null;
let apiTimelineTest = null;

let timelineStatsCurrent = null;

// 1 second
const timelineBucketDuration = 1000;

// duration of timeline test - number of iterations
let timelineTestDuration = 3;
if (process.env.SWS_TIMELINE_TEST_DURATION) {
  timelineTestDuration = parseInt(process.env.SWS_TIMELINE_TEST_DURATION, 10);
}

const expectedTimelineValues = {};

function sendTestRequestsOnce(iteration, deferred) {
  if (iteration <= 0) {
    setTimeout(deferred.resolve, 1100); // Make sure time interval finished before we get stats
    return;
  }

  const methods = ["get", "post", "put", "delete"];

  const ts = Date.now();
  debug("Iter(%d): starting at %s (%s) ", iteration, ts, ts % 1000);
  const timelineid = Math.floor(ts / timelineBucketDuration);
  expectedTimelineValues[timelineid] = new SwsReqResStats();
  const timelineCurrent = expectedTimelineValues[timelineid];

  // Generate random number of requests each iteration
  let reqcntr = 0;

  methods.forEach((method) => {
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
      timelineCurrent.requests += 1;
      timelineCurrent[SwsUtil.getStatusCodeClass(randomcode)] += 1;
      if (SwsUtil.isError(randomcode)) timelineCurrent.errors += 1;
      const reqClen = body !== null ? Buffer.byteLength(body) : 0;
      timelineCurrent.total_req_clength += reqClen;
      const resClen = hdr.payloadsize;
      timelineCurrent.total_res_clength += resClen;
      if (reqClen > timelineCurrent.max_req_clength)
        timelineCurrent.max_req_clength = reqClen;
      if (resClen > timelineCurrent.max_res_clength)
        timelineCurrent.max_res_clength = resClen;
      timelineCurrent.avg_req_clength = Math.floor(
        timelineCurrent.total_req_clength / timelineCurrent.requests,
      );
      timelineCurrent.avg_res_clength = Math.floor(
        timelineCurrent.total_res_clength / timelineCurrent.requests,
      );
      timelineCurrent.req_rate = timelineCurrent.requests;
      timelineCurrent.err_rate = timelineCurrent.errors;

      // eslint-disable-next-line no-loop-func
      const req = http.request(options, () => {
        reqcntr -= 1;
        if (reqcntr <= 0) {
          // repeat at the beginning of the next second
          const adjDelay = 1100 - (Date.now() % 1000);
          setTimeout(sendTestRequestsOnce, adjDelay, iteration - 1, deferred);
        }
      });
      body !== null ? req.end(body) : req.end();
    }
  });
}

function generateTestRequests() {
  const deferred = Q.defer();
  // Adjust start time so we'll be at the begging of each second
  const startdelay = 1100 - (Date.now() % 1000);
  setTimeout(sendTestRequestsOnce, startdelay, timelineTestDuration, deferred);
  return deferred.promise;
}

setImmediate(() => {
  describe("Timeline statistics test", () => {
    this.timeout(120000);

    describe("Initialize", () => {
      it("should initialize example app", (done) => {
        supertest(swsTestFixture.SWS_TEST_DEFAULT_URL)
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .expect(200)
          .end((err, res) => {
            if (err) {
              if (res && res.status === 403) {
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
          .query({ fields: "timeline" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            // eslint-disable-next-line no-unused-expressions
            res.body.should.not.be.empty;
            res.body.should.have.property("timeline");
            res.body.timeline.should.have.property("data");
            done();
          });
      });
    });

    describe("Send Test Requests", () => {
      it(`should send random number of test requests each second for ${timelineTestDuration} seconds`, (done) => {
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
          .query({ fields: "timeline" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            // eslint-disable-next-line no-unused-expressions
            res.body.should.not.be.empty;
            res.body.should.have.property("timeline");
            res.body.timeline.should.have.property("data");
            timelineStatsCurrent = res.body.timeline.data;
            done();
          });
      });

      it("should have correct values of timeline statistics", (done) => {
        // eslint-disable-next-line no-restricted-syntax, guard-for-in
        for (const tid in expectedTimelineValues) {
          debug(
            "Comparing[%s]: Expected %s Actual:%s",
            tid,
            JSON.stringify(expectedTimelineValues[tid]),
            JSON.stringify(timelineStatsCurrent[tid]),
          );
          timelineStatsCurrent.should.have.property(tid);
          timelineStatsCurrent[tid].should.have.property("stats");
          expectedTimelineValues[tid].requests.should.be.equal(
            timelineStatsCurrent[tid].stats.requests,
          );
          expectedTimelineValues[tid].errors.should.be.equal(
            timelineStatsCurrent[tid].stats.errors,
          );
          expectedTimelineValues[tid].success.should.be.equal(
            timelineStatsCurrent[tid].stats.success,
          );
          expectedTimelineValues[tid].redirect.should.be.equal(
            timelineStatsCurrent[tid].stats.redirect,
          );
          expectedTimelineValues[tid].client_error.should.be.equal(
            timelineStatsCurrent[tid].stats.client_error,
          );
          expectedTimelineValues[tid].server_error.should.be.equal(
            timelineStatsCurrent[tid].stats.server_error,
          );
          expectedTimelineValues[tid].total_req_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.total_req_clength,
          );
          expectedTimelineValues[tid].total_res_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.total_res_clength,
          );
          expectedTimelineValues[tid].avg_req_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.avg_req_clength,
          );
          expectedTimelineValues[tid].avg_res_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.avg_res_clength,
          );
          expectedTimelineValues[tid].req_rate.should.be.equal(
            timelineStatsCurrent[tid].stats.req_rate,
          );
          expectedTimelineValues[tid].err_rate.should.be.equal(
            timelineStatsCurrent[tid].stats.err_rate,
          );
        }

        done();
      });
    });
  });

  // eslint-disable-next-line no-undef
  run();
});
