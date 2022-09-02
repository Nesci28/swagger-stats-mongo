const chai = require("chai");
const { MongoMemoryServer } = require("mongodb-memory-server");

chai.should();
const { expect } = chai;

const SwsMongo = require("../dist/swsMongo.js");

setImmediate(() => {
  describe("SwsMongo test", () => {
    let mongod = null;
    let swsMongo = null;

    describe("Init", () => {
      it("should create a mongo instance", async () => {
        mongod = await MongoMemoryServer.create({
          instance: {
            port: 27027,
            dbName: "swagger-stats",
          },
        });

        swsMongo = new SwsMongo({
          mongoUrl: "127.0.0.1:27027",
          swaggerStatsMongoDb: "swagger-stats",
        });

        await swsMongo.init();
        expect(typeof mongod).to.equal("object");
        expect(typeof swsMongo).to.equal("object");
      });
    });
  });

  // eslint-disable-next-line no-undef
  run();
});
