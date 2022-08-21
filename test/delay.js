const chai = require("chai");

chai.should();
const { expect } = chai;
const supertest = require("supertest");

const swsTestFixture = require("./testfixture");

setImmediate(() => {
  describe("Delay 1 second", () => {
    it("should delay for 1 second", (done) => {
      setTimeout(() => {
        done();
      }, 1000);
    });
  });
  run();
});
