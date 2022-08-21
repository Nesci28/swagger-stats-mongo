const chai = require("chai");

chai.should();
const { expect } = chai;

const Q = require("q");
const http = require("http");
const fs = require("fs");
const cuid = require("cuid");
const path = require("path");
const supertest = require("supertest");
const cp = require("child_process");
const swaggerParser = require("swagger-parser");

const swsTestFixture = require("../testfixture");
const swsTestUtils = require("../testutils");

let appRandomTest = null;
let apiRandomTest = null;

const debug = require("debug")("swstest:randomtest");

let swaggerSpecUrl = "./examples/spectest/petstore.yaml";
// var swaggerSpecUrl = './examples/spectest/petstore3.yaml';   // Default
// var swaggerSpecUrl = './test/randomtest/petstore_small.yaml';

if (process.env.SWS_SPECTEST_URL) {
  swaggerSpecUrl = process.env.SWS_SPECTEST_URL;
}
debug("Using Swagger Specification: %s", swaggerSpecUrl);

let swaggerSpec = null;
const parser = new swaggerParser();

let apiOperationsList = [];

const elasticURL = "http://127.0.0.1:9200";

// implementation of sending random requests in a loop with varying frequency

function sendRandomRequestsOnce(iteration, deferred) {
  if (iteration <= 0) {
    deferred.resolve();
    return;
  }

  // Generate one requests for each API operation
  let reqcntr = 0;
  let opcntr = 0;
  apiOperationsList.forEach((apiop) => {
    opcntr++;
    const yesno = 100; // swsTestUtils.getRandomArbitrary(0,100);
    // give preference to first operations in the list
    // if(yesno>=(opcntr*33)){//50) {
    if (yesno >= 50) {
      reqcntr++;
      const randomcode = swsTestUtils.getRandomHttpStatusCode();
      const hdr = {
        code: randomcode,
        message: swsTestUtils.getHttpStatusMessage(randomcode),
        delay: swsTestUtils.getRandomArbitrary(0, 100),
        payloadsize: swsTestUtils.getRandomArbitrary(0, 200),
      };
      const { opCallDef } = apiop;
      const xswsResHdr = JSON.stringify(hdr);

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
      let body = null;
      if (opCallDef.method === "post" || opCallDef.method === "put") {
        const reqPayloadSize = swsTestUtils.getRandomArbitrary(0, 200);
        let str = "";
        for (let i = 0; i < reqPayloadSize; i++) str += "r";
        body = JSON.stringify({ data: str });
        options.headers["Content-Type"] = "application/json";
        options.headers["Content-Length"] = Buffer.byteLength(body);
      }
      const req = http.request(options, (res) => {
        // TODO Check status code validness ????
        // res.should.have.property('statusCode');
        // res.statusCode.should.be.equal(parseInt(randomcode));
        reqcntr--;
        if (reqcntr <= 0) {
          // got all responses for requests sent in this iteration
          // var delay = swsTestUtils.getRandomArbitrary(100, 500);
          let delay = Math.floor(Math.abs(Math.sin(iteration / 25) * 100));
          delay = delay < 55 ? 10 : delay;
          // repeat after varying delay
          setTimeout(sendRandomRequestsOnce, delay, iteration - 1, deferred);
        }
      });
      body !== null ? req.end(body) : req.end();
    }
  });
  // If no requests were sent
  /*
    if(reqcntr==0){
        //let delay = swsTestUtils.getRandomArbitrary(100, 500);
        //setTimeout(sendRandomRequestsOnce, delay, iteration - 1, deferred);
        let delay = Math.floor(Math.abs(Math.sin(iteration/50)*100));
        console.log(`Delay(${iteration}) = ${delay}`);
        setTimeout(sendRandomRequestsOnce, 100, iteration - 1, deferred);
    }
    */
}

function generateRandomRequests() {
  const deferred = Q.defer();
  sendRandomRequestsOnce(10000, deferred);
  return deferred.promise;
}

// First we need to load and validate swagger spec
// Use --delay mocha flag

parser.validate(swaggerSpecUrl, (err, api) => {
  if (err) {
    debug(`Error validating swagger spec: ${err}`);
    return;
  }

  swaggerSpec = api;
  apiOperationsList = swsTestUtils.generateApiOpList(swaggerSpec);

  describe("Swagger API Random Test", function () {
    this.timeout(6000000);

    it("should initialize spectest app", (done) => {
      supertest(swsTestFixture.SWS_SPECTEST_DEFAULT_URL)
        .get(swsTestFixture.SWS_TEST_STATS_API)
        .expect(200)
        .end((err, res) => {
          if (err || (res && res.status !== 200)) {
            // support case when authorization is enabled
            process.env.SWS_ELASTIC = elasticURL;
            process.env.SWS_SPECTEST_URL = swaggerSpecUrl;
            appRandomTest = require("../../examples/spectest/spectest");
            apiRandomTest = supertest(
              `http://localhost:${appRandomTest.app.get("port")}`,
            );
            setTimeout(done, 500);
          } else {
            apiRandomTest = supertest(swsTestFixture.SWS_SPECTEST_DEFAULT_URL);
            done();
          }
        });
    });

    it("should send random API requests", (done) => {
      generateRandomRequests().then(() => {
        debug("generateRandomRequests - finished!");
        done();
      });
    });
  });

  run();
});
