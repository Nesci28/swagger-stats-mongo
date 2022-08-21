/* eslint-disable no-unused-expressions */
const chai = require("chai");

chai.should();
const supertest = require("supertest");
const cuid = require("cuid");

// SWS test fixture
const swsTestFixture = require("./testfixture.js");

// SWS Utils
const swsUtil = require("../lib/swsUtil.js");

setImmediate(() => {
  describe("Baseline test", () => {
    // this.timeout(20000);

    let app = null;
    let api = null;

    let apiStatsInitial = null;
    let apiStatsCurrent = null;
    let apiLastErrorsInitial = null;
    let apiLastErrorsCurrent = null;
    let apiLongestReqCurrent = null;

    const clientErrorId = cuid();
    const serverErrorId = cuid();
    const longRequestId = cuid();
    const xfwdRequestId = cuid();

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
                api = supertest
                  .agent(swsTestFixture.SWS_TEST_DEFAULT_URL)
                  .auth("swagger-stats", "swagger-stats");
                done();
              } else {
                process.env.SWS_TEST_TIMEBUCKET = timelineBucketDuration;
                // eslint-disable-next-line global-require
                app = require("../examples/testapp/testapp.js");
                api = supertest(`http://localhost:${app.app.get("port")}`);
                setTimeout(done, 500);
              }
            } else {
              api = supertest(swsTestFixture.SWS_TEST_DEFAULT_URL);
              done();
            }
          });
      });
      it("should collect initial statistics values", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "method" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            apiStatsInitial = res.body;
            done();
          });
      });
      it("should collect initial set of last errors", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "lasterrors" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            res.body.should.have.property("lasterrors");
            apiLastErrorsInitial = res.body.lasterrors;
            done();
          });
      });
    });

    describe("Send Test Requests", () => {
      it("/success should respond with 200 Success Response", (done) => {
        api
          .get("/v2/success")
          .set("Content-Type", "text/html")
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.text.should.equal("OK");
            done();
          });
      });

      it("/redirect should respond with 302 Redirect Response", (done) => {
        api
          .get("/v2/redirect")
          .expect(302)
          .end((err, res) => {
            if (err) return done(err);

            res.headers.location.should.equal("/v2/success");
            done();
          });
      });

      it("/client_error should respond with 404 Not Found Response", (done) => {
        api
          .get("/v2/client_error")
          .set({ "x-test-id": clientErrorId })
          .expect(404)
          .end((err, res) => {
            if (err) return done(err);

            res.text.should.equal("Not found");
            done();
          });
      });

      it("/server_error should respond with 500 Server Error Response", (done) => {
        api
          .get("/v2/server_error")
          .set({ "x-test-id": serverErrorId })
          .expect(500)
          .end((err, res) => {
            if (err) return done(err);

            res.text.should.equal("Server Error");
            done();
          });
      });
    });

    // Get API Stats, and check that number of requests / responses is correctly calculated
    describe("Check Statistics", () => {
      it("should return collected statistics", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "method" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            apiStatsCurrent = res.body;
            done();
          });
      });

      it("should have correct values of statistics: all", (done) => {
        apiStatsCurrent.all.requests.should.be.equal(
          apiStatsInitial.all.requests + 4,
        );
        apiStatsCurrent.all.errors.should.be.equal(
          apiStatsInitial.all.errors + 2,
        );
        apiStatsCurrent.all.client_error.should.be.equal(
          apiStatsInitial.all.client_error + 1,
        );
        apiStatsCurrent.all.server_error.should.be.equal(
          apiStatsInitial.all.server_error + 1,
        );
        apiStatsCurrent.all.total_time.should.be.at.least(
          apiStatsInitial.all.total_time,
        );
        apiStatsCurrent.all.max_time.should.be.at.least(
          apiStatsInitial.all.max_time,
        );
        apiStatsCurrent.all.avg_time
          .toFixed(4)
          .should.be.equal(
            (
              apiStatsCurrent.all.total_time / apiStatsCurrent.all.requests
            ).toFixed(4),
          );
        done();
      });

      it("should have correct values of statistics: method.GET", (done) => {
        apiStatsCurrent.method.GET.requests.should.be.equal(
          apiStatsInitial.method.GET.requests + 4,
        );
        apiStatsCurrent.method.GET.errors.should.be.equal(
          apiStatsInitial.method.GET.errors + 2,
        );
        apiStatsCurrent.method.GET.client_error.should.be.equal(
          apiStatsInitial.method.GET.client_error + 1,
        );
        apiStatsCurrent.method.GET.server_error.should.be.equal(
          apiStatsInitial.method.GET.server_error + 1,
        );
        apiStatsCurrent.method.GET.total_time.should.be.at.least(
          apiStatsInitial.method.GET.total_time,
        );
        apiStatsCurrent.method.GET.max_time.should.be.at.least(
          apiStatsInitial.method.GET.max_time,
        );
        apiStatsCurrent.method.GET.avg_time
          .toFixed(4)
          .should.be.equal(
            (
              apiStatsCurrent.method.GET.total_time /
              apiStatsCurrent.method.GET.requests
            ).toFixed(4),
          );
        done();
      });

      it("should retrirve collected last errors", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "lasterrors" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            res.body.should.have.property("lasterrors");
            apiLastErrorsCurrent = res.body.lasterrors;
            done();
          });
      });

      it("should capture last errors", (done) => {
        apiLastErrorsCurrent.should.be.instanceof(Array);
        apiLastErrorsCurrent.should.not.be.empty;
        apiLastErrorsCurrent.should.have.length.of.at.least(2);
        (
          apiLastErrorsCurrent.length === apiLastErrorsInitial.length + 2 ||
          apiLastErrorsCurrent.length === 100
        ).should.be.true;
        const len = apiLastErrorsCurrent.length;
        let errorInfo = apiLastErrorsCurrent[len - 1];
        errorInfo.path.should.be.equal("/v2/server_error");
        errorInfo.method.should.be.equal("GET");
        errorInfo.should.have.property("http");
        errorInfo.http.should.have.property("request");
        errorInfo.http.request.should.have.property("headers");
        errorInfo.http.request.headers.should.have.property("x-test-id");
        errorInfo.http.request.headers["x-test-id"].should.be.equal(
          serverErrorId,
        );
        errorInfo = apiLastErrorsCurrent[len - 2];
        errorInfo.path.should.be.equal("/v2/client_error");
        errorInfo.method.should.be.equal("GET");
        errorInfo.should.have.property("http");
        errorInfo.http.request.should.have.property("headers");
        errorInfo.http.request.headers.should.have.property("x-test-id");
        errorInfo.http.request.headers["x-test-id"].should.be.equal(
          clientErrorId,
        );
        done();
      });

      it("should get collected statistics via module API", (done) => {
        api
          .get("/stats")
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            // TODO Implement in full
            res.body.should.not.be.empty;

            done();
          });
      });

      it("should execute long request", (done) => {
        api
          .get("/v2/paramstest/200/and/none?delay=500")
          .set({ "x-test-id": longRequestId })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.text.should.equal(
              '{"code":200,"message":"Request Method:GET, params.code: 200"}',
            );
            done();
          });
      });

      it("should retrieve longest requests", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "longestreq" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            res.body.should.have.property("longestreq");
            apiLongestReqCurrent = res.body.longestreq;
            done();
          });
      });

      it("should capture longest request", (done) => {
        apiLongestReqCurrent.should.be.instanceof(Array);
        apiLongestReqCurrent.should.not.be.empty;
        apiLongestReqCurrent.should.have.length.of.at.least(1);
        const len = apiLongestReqCurrent.length;
        const longestRequest = apiLongestReqCurrent[len - 1];
        longestRequest.should.have.property("http");
        longestRequest.http.should.have.property("request");
        longestRequest.path.should.be.equal(
          "/v2/paramstest/200/and/none?delay=500",
        );
        longestRequest.method.should.be.equal("GET");
        longestRequest.http.request.should.have.property("headers");
        longestRequest.http.request.headers.should.have.property("x-test-id");
        longestRequest.http.request.headers["x-test-id"].should.be.equal(
          longRequestId,
        );
        longestRequest.should.have.property("responsetime");
        longestRequest.responsetime.should.be.at.least(500);
        done();
      });

      it("should process x-forwarded-for", (done) => {
        api
          .get("/v2/paramstest/404/and/none")
          .set({ "x-test-id": xfwdRequestId })
          .set({ "x-forwarded-for": "1.1.1.1" })
          .expect(404)
          .end((err, res) => {
            if (err) return done(err);

            res.text.should.equal(
              '{"code":404,"message":"Request Method:GET, params.code: 404"}',
            );
            done();
          });
      });

      it("should retrieve last error with x-forwarded-for", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "lasterrors" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            res.body.should.have.property("lasterrors");
            apiLastErrorsCurrent = res.body.lasterrors;
            done();
          });
      });

      it("should capture remoteaddress from x-forwarded-for", (done) => {
        apiLastErrorsCurrent.should.be.instanceof(Array);
        apiLastErrorsCurrent.should.not.be.empty;
        const len = apiLastErrorsCurrent.length;
        const errorInfo = apiLastErrorsCurrent[len - 1];
        errorInfo.http.request.headers.should.have.property("x-test-id");
        errorInfo.http.request.headers["x-test-id"].should.be.equal(
          xfwdRequestId,
        );
        errorInfo.should.have.property("real_ip");
        errorInfo.real_ip.should.be.equal("1.1.1.1");
        done();
      });

      it("should retrieve errors stats", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_STATS_API)
          .query({ fields: "errors" })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            res.body.should.not.be.empty;
            res.body.should.have.property("errors");
            done();
          });
      });

      // TODO Check errors content
    });

    // Get API Stats, and check that number of requests / responses is correctly calculated
    describe("Check Metrics", () => {
      it("should return metrics", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_METRICS_API)
          .expect(200)
          .expect("Content-Type", /plain/)
          .end((err, res) => {
            if (err) return done(err);

            res.text.should.not.be.empty;

            // TODO Validate metric values

            done();
          });
      });
    });

    // swsUtils
    describe("Check swsUtils", () => {
      it("should convert data to string by type", (done) => {
        swsUtil.swsStringValue("test").should.equal("test");
        swsUtil.swsStringValue(true).should.equal("true");
        swsUtil.swsStringValue(12345).should.equal("12345");
        swsUtil.swsStringValue(null).should.equal("");
        swsUtil.swsStringValue().should.equal("");
        swsUtil
          .swsStringValue({ test: "test" })
          .should.equal(JSON.stringify({ test: "test" }));

        const me = { id: 1, name: "Luke" };
        const him = { id: 2, name: "Darth Vader" };
        me.father = him;
        him.father = me; // time travel assumed :-)
        swsUtil.swsStringValue(me).should.equal("");
        done();
      });

      it("should return status code class", (done) => {
        swsUtil.getStatusCodeClass(100).should.equal("info");
        swsUtil.getStatusCodeClass(200).should.equal("success");
        swsUtil.getStatusCodeClass(201).should.equal("success");
        swsUtil.getStatusCodeClass(300).should.equal("redirect");
        swsUtil.getStatusCodeClass(302).should.equal("redirect");
        swsUtil.getStatusCodeClass(400).should.equal("client_error");
        swsUtil.getStatusCodeClass(404).should.equal("client_error");
        swsUtil.getStatusCodeClass(500).should.equal("server_error");
        swsUtil.getStatusCodeClass(501).should.equal("server_error");
        done();
      });
    });

    // Get API Stats, and check that number of requests / responses is correctly calculated
    describe("Check Embedded UX", () => {
      it("should return HTML for embedded UX", (done) => {
        api
          .get(swsTestFixture.SWS_TEST_UX)
          .expect(200)
          .expect("Content-Type", /html/)
          .end((err) => {
            if (err) return done(err);
            done();
          });
      });
    });
  });

  run();
});
