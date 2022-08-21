const util = require("util");
const chai = require("chai");

chai.should();
const { expect } = chai;
const supertest = require("supertest");
const cuid = require("cuid");

const Q = require("q");
const http = require("http");

// We will use it to store expected values
const debug = require("debug")("swstest:baseline");
const swsReqResStats = require("../lib/swsReqResStats");
const swsUtil = require("../lib/swsUtil");

const swsTestFixture = require("./testfixture");
const swsTestUtils = require("./testutils");

let appTimelineTest = null;
let apiTimelineTest = null;

let timelineStatsInitial = null;
let timelineStatsCurrent = null;

const client_error_id = cuid();
const server_error_id = cuid();

// 1 second
const timeline_bucket_duration = 1000;

// duration of timeline test - number of iterations
let timeline_test_duration = 3;
if (process.env.SWS_TIMELINE_TEST_DURATION) {
  timeline_test_duration = parseInt(process.env.SWS_TIMELINE_TEST_DURATION);
}

const expected_timeline_values = {};

function sendTestRequestsOnce(iteration, deferred) {
  if (iteration <= 0) {
    setTimeout(deferred.resolve, 1100); // Make sure time interval finished before we get stats
    return;
  }

  const methods = ["get", "post", "put", "delete"];

  const ts = Date.now();
  debug("Iter(%d): starting at %s (%s) ", iteration, ts, ts % 1000);
  const timelineid = Math.floor(ts / timeline_bucket_duration);
  expected_timeline_values[timelineid] = new swsReqResStats();
  const timelineCurrent = expected_timeline_values[timelineid];

  // Generate random number of requests each iteration
  let reqcntr = 0;

  methods.forEach((method) => {
    const numReq = swsTestUtils.getRandomArbitrary(0, 5);
    for (var i = 0; i < numReq; i++) {
      reqcntr++;

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
        for (var i = 0; i < reqPayloadSize; i++) str += "r";
        body = JSON.stringify([str]);
        options.headers["Content-Type"] = "application/json";
        options.headers["Content-Length"] = Buffer.byteLength(body);
      }

      // Store in expected values
      timelineCurrent.requests++;
      timelineCurrent[swsUtil.getStatusCodeClass(randomcode)]++;
      if (swsUtil.isError(randomcode)) timelineCurrent.errors++;
      const req_clen = body !== null ? Buffer.byteLength(body) : 0;
      timelineCurrent.total_req_clength += req_clen;
      const res_clen = hdr.payloadsize;
      timelineCurrent.total_res_clength += res_clen;
      if (req_clen > timelineCurrent.max_req_clength)
        timelineCurrent.max_req_clength = req_clen;
      if (res_clen > timelineCurrent.max_res_clength)
        timelineCurrent.max_res_clength = res_clen;
      timelineCurrent.avg_req_clength = Math.floor(
        timelineCurrent.total_req_clength / timelineCurrent.requests,
      );
      timelineCurrent.avg_res_clength = Math.floor(
        timelineCurrent.total_res_clength / timelineCurrent.requests,
      );
      timelineCurrent.req_rate = timelineCurrent.requests;
      timelineCurrent.err_rate = timelineCurrent.errors;

      const req = http.request(options, (res) => {
        reqcntr--;
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
  setTimeout(
    sendTestRequestsOnce,
    startdelay,
    timeline_test_duration,
    deferred,
  );
  return deferred.promise;
}

setImmediate(() => {
  describe("Timeline statistics test", function () {
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
                process.env.SWS_TEST_TIMEBUCKET = timeline_bucket_duration;
                appTimelineTest = require("../examples/testapp/testapp");
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

            res.body.should.not.be.empty;
            res.body.should.have.property("timeline");
            res.body.timeline.should.have.property("data");
            timelineStatsInitial = res.body.timeline.data;
            done();
          });
      });
    });

    describe("Send Test Requests", () => {
      it(`should send random number of test requests each second for ${timeline_test_duration} seconds`, (done) => {
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

            res.body.should.not.be.empty;
            res.body.should.have.property("timeline");
            res.body.timeline.should.have.property("data");
            timelineStatsCurrent = res.body.timeline.data;
            done();
          });
      });

      it("should have correct values of timeline statistics", (done) => {
        for (const tid in expected_timeline_values) {
          debug(
            "Comparing[%s]: Expected %s Actual:%s",
            tid,
            JSON.stringify(expected_timeline_values[tid]),
            JSON.stringify(timelineStatsCurrent[tid]),
          );
          timelineStatsCurrent.should.have.property(tid);
          timelineStatsCurrent[tid].should.have.property("stats");
          expected_timeline_values[tid].requests.should.be.equal(
            timelineStatsCurrent[tid].stats.requests,
          );
          expected_timeline_values[tid].errors.should.be.equal(
            timelineStatsCurrent[tid].stats.errors,
          );
          expected_timeline_values[tid].success.should.be.equal(
            timelineStatsCurrent[tid].stats.success,
          );
          expected_timeline_values[tid].redirect.should.be.equal(
            timelineStatsCurrent[tid].stats.redirect,
          );
          expected_timeline_values[tid].client_error.should.be.equal(
            timelineStatsCurrent[tid].stats.client_error,
          );
          expected_timeline_values[tid].server_error.should.be.equal(
            timelineStatsCurrent[tid].stats.server_error,
          );
          expected_timeline_values[tid].total_req_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.total_req_clength,
          );
          expected_timeline_values[tid].total_res_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.total_res_clength,
          );
          expected_timeline_values[tid].avg_req_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.avg_req_clength,
          );
          expected_timeline_values[tid].avg_res_clength.should.be.equal(
            timelineStatsCurrent[tid].stats.avg_res_clength,
          );
          expected_timeline_values[tid].req_rate.should.be.equal(
            timelineStatsCurrent[tid].stats.req_rate,
          );
          expected_timeline_values[tid].err_rate.should.be.equal(
            timelineStatsCurrent[tid].stats.err_rate,
          );
        }

        done();
      });
    });
  });

  run();
});
