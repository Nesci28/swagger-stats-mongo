/* eslint-disable no-unused-expressions */
const chai = require("chai");

chai.should();
const supertest = require("supertest");

const swsTestFixture = require("./testfixture.js");

const swaggerSpecUrl = "./examples/authtest/petstore3.yaml"; // Default

let appAuthTest = null;
let apiAuthTest = null;

let initialStatRequests = 0;

function isNonEmptyString(str) {
  return typeof str === "string" && !!str.trim();
}

function parseSetCookie(setCookieValue) {
  const parts = setCookieValue.split(";").filter(isNonEmptyString);
  const nameValue = parts.shift().split("=");
  const name = nameValue.shift();
  const value = nameValue.join("="); // everything after the first =, joined by a "=" if there was more than one part
  const cookie = {
    name, // grab everything before the first =
    value,
  };

  parts.forEach((part) => {
    const sides = part.split("=");
    const key = sides.shift().trimLeft().toLowerCase();
    const v = sides.join("=");
    if (key === "expires") {
      cookie.expires = new Date(v);
    } else if (key === "max-age") {
      cookie.maxAge = parseInt(value, 10);
    } else if (key === "secure") {
      cookie.secure = true;
    } else if (key === "httponly") {
      cookie.httpOnly = true;
    } else {
      cookie[key] = v;
    }
  });

  return cookie;
}

setImmediate(() => {
  describe("Authentication test", () => {
    let sessionIdCookie;

    describe("Initialize", () => {
      it("should initialize example app", (done) => {
        supertest(swsTestFixture.SWS_AUTHTEST_DEFAULT_URL)
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .expect(403)
          .end((err) => {
            if (err) {
              process.env.SWS_AUTHTEST_MAXAGE = 2;
              process.env.SWS_SPECTEST_URL = swaggerSpecUrl;
              // eslint-disable-next-line global-require
              appAuthTest = require("../examples/authtest/authtest.js");
              const dest = `http://localhost:${appAuthTest.app.get("port")}`;
              apiAuthTest = supertest(dest);
              setTimeout(done, 1000);
            } else {
              apiAuthTest = supertest(swsTestFixture.SWS_AUTHTEST_DEFAULT_URL);
              done();
            }
          });
      }).timeout(5000);

      it("should get 403 response for /stats", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .expect(403)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });

      it("should get 403 response for /metrics", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_METRICS_API)
          .expect(403)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });

      it("should not authenticate with wrong credentials", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .auth("wrong", "wrong")
          .expect(403)
          .end((err) => {
            if (err) return done(err);
            done();
          });
      });

      it("should authenticate with correct credentials", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .auth("swagger-stats", "swagger-stats")
          .expect(200)
          .expect("set-cookie", /sws-session-id/)
          .end((err, res) => {
            if (err) return done(err);

            const setCookie = res.headers["set-cookie"][0]; // Setting the cookie
            const parsed = parseSetCookie(setCookie);
            sessionIdCookie = parsed.value;

            done();
          });
      }).timeout(10000);

      it("should get statistics values", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .set("Cookie", [`sws-session-id=${sessionIdCookie}`])
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            initialStatRequests = res.body.all.requests;
            done();
          });
      });

      it("should send test request from swagger spec", (done) => {
        apiAuthTest
          .get("/v2/pet/findByTags")
          .set(
            "x-sws-res",
            '{"code":"200","message":"TEST","delay":"50","payloadsize":"5"}',
          )
          .expect(200)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });

      it("should logout", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_LOGOUT_API)
          .set("Cookie", [`sws-session-id=${sessionIdCookie}`])
          .expect(200)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });

      it("should not get statistics after logout", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .set("Cookie", [`sws-session-id=${sessionIdCookie}`])
          .expect(403)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });

      it("should not login with wrong credentials using promise based auth method", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .auth("swagger-promise", "wrong")
          .expect(403)
          .end((err) => {
            if (err) return done(err);
            done();
          });
      });

      it("should login again using promise based auth method", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .auth("swagger-promise", "swagger-promise")
          .expect(200)
          .expect("set-cookie", /sws-session-id/)
          .expect("x-sws-authenticated", /true/)
          .end((err, res) => {
            if (err) return done(err);

            const setCookie = res.headers["set-cookie"][0]; // Setting the cookie
            const parsed = parseSetCookie(setCookie);
            sessionIdCookie = parsed.value;

            done();
          });
      });

      it("should get statistics after second login", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .set("Cookie", [`sws-session-id=${sessionIdCookie}`])
          .expect(200)
          .expect("x-sws-authenticated", /true/)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            // Should see exactly one request: non-swagger requests monitoring is disabled in this test
            res.body.all.requests.should.be.equal(initialStatRequests + 1);
            done();
          });
      });

      it("should wait for session to expire", (done) => {
        setTimeout(() => {
          done();
        }, 2000);
      }).timeout(2500);

      it("should not get statistics after session expired", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .set("Cookie", [`sws-session-id=${sessionIdCookie}`])
          .expect(403)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });

      it("should not authenticate /metrics with wrong credentials", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_METRICS_API)
          .auth("wrong", "wrong")
          .expect(403)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });

      it("should authenticate and return /metrics with right credentials", (done) => {
        apiAuthTest
          .get(swsTestFixture.SWS_TEST_METRICS_API)
          .auth("swagger-stats", "swagger-stats")
          .expect(200)
          .end((err) => {
            if (err) return done(err);

            done();
          });
      });
    });

    /*
        // Get API Stats, and check that number of requests / responses is correctly calculated
        describe('Check Statistics', function () {

            it('should return collected statistics', function (done) {
                apiTimelineTest.get(swsTestFixture.SWS_TEST_STATS_API)
                    .query({fields: 'timeline'})
                    .expect(200)
                    .end(function (err, res) {
                        if (err) return done(err);

                        res.body.should.not.be.empty;
                        res.body.should.have.property('timeline');
                        res.body.timeline.should.have.property('data');
                        //timelineStatsCurrent = res.body.timeline.data;
                        done();
                    });
            });

            it('should have correct values of timeline statistics', function (done) {


                for( var tid in expected_timeline_values) {
                    debug('Comparing[%s]: Expected %s Actual:%s', tid, JSON.stringify(expected_timeline_values[tid]),JSON.stringify(timelineStatsCurrent[tid]) );
                    timelineStatsCurrent.should.have.property(tid);
                    timelineStatsCurrent[tid].should.have.property('stats');
                    (expected_timeline_values[tid].requests).should.be.equal(timelineStatsCurrent[tid].stats.requests);
                    (expected_timeline_values[tid].errors).should.be.equal(timelineStatsCurrent[tid].stats.errors);
                    (expected_timeline_values[tid].success).should.be.equal(timelineStatsCurrent[tid].stats.success);
                    (expected_timeline_values[tid].redirect).should.be.equal(timelineStatsCurrent[tid].stats.redirect);
                    (expected_timeline_values[tid].client_error).should.be.equal(timelineStatsCurrent[tid].stats.client_error);
                    (expected_timeline_values[tid].server_error).should.be.equal(timelineStatsCurrent[tid].stats.server_error);
                    (expected_timeline_values[tid].total_req_clength).should.be.equal(timelineStatsCurrent[tid].stats.total_req_clength);
                    (expected_timeline_values[tid].total_res_clength).should.be.equal(timelineStatsCurrent[tid].stats.total_res_clength);
                    (expected_timeline_values[tid].avg_req_clength).should.be.equal(timelineStatsCurrent[tid].stats.avg_req_clength);
                    (expected_timeline_values[tid].avg_res_clength).should.be.equal(timelineStatsCurrent[tid].stats.avg_res_clength);
                    (expected_timeline_values[tid].req_rate).should.be.equal(timelineStatsCurrent[tid].stats.req_rate);
                    (expected_timeline_values[tid].err_rate).should.be.equal(timelineStatsCurrent[tid].stats.err_rate);
                }

                done();
            });

        });
*/
  });

  // eslint-disable-next-line no-undef
  run();
});
