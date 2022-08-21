const chai = require("chai");

chai.should();
const { expect } = chai;
const supertest = require("supertest");

const swsTestFixture = require("./testfixture");

setImmediate(() => {
  describe("Stop Test App", () => {
    it("should stop test app", (done) => {
      supertest(swsTestFixture.SWS_SPECTEST_DEFAULT_URL)
        .get("/stop")
        .expect(200)
        .end((err, res) => {
          setTimeout(() => {
            done();
          }, 1000);
        });
    });
  });
  run();
});
