const http = require("http");
const debug = require("debug")("sws:testapp");

// Server
let server = null;

// Express and middlewares
const express = require("express");
const expressBodyParser = require("body-parser");

const SwaggerParser = require("swagger-parser");

const { swsInterface } = require("../../dist/index.js");
// require('swagger-stats');

// Mockup API implementation
const API = require("./api.js");

// eslint-disable-next-line no-multi-assign
const app = (module.exports = express());
app.use(expressBodyParser.json()); // for parsing application/json
app.use(expressBodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// all environments
app.set("port", process.env.PORT || 3040);

// Suppress cache on the GET API responses
app.disable("etag");

app.get("/", (req, res) => {
  res.redirect("/swagger-stats/");
});

app.get("/apidoc.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

let tlBucket = 60000;
if (process.env.SWS_TEST_TIMEBUCKET) {
  tlBucket = +process.env.SWS_TEST_TIMEBUCKET;
}

const swaggerSpec = require("./petstore.json");

// Testing validation of 3rd-party API spec
const parser = new SwaggerParser();

parser.validate(swaggerSpec, async (err) => {
  try {
    if (!err) {
      debug("Success validating swagger file!");
      // swaggerSpec = api;

      // Enable swagger-stats middleware
      app.use(
        await swsInterface.getMiddleware({
          name: "swagger-stats-testapp",
          version: "0.99.2",
          timelineBucketDuration: tlBucket,
          uriPath: "/swagger-stats",
          swaggerSpec,
          elasticsearch: "http://swagger-stats-elasticsearch:9200",
          mongoUrl: "127.0.0.1:27027",
          swaggerStatsMongoDb: "swagger-stats",
          redisHost: "swagger-stats-redis",
          redisPort: 6379,
        }),
      );

      // Implement custom API in application to return collected statistics
      app.get("/stats", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.send(await swsInterface.getCoreStats());
      });

      // Connect API Router - it should be the end of the chain
      app.use("/v2", API);

      // Setup server
      server = http.createServer(app);
      server.listen(app.get("port"));
      debug(
        `Server started on port ${app.get("port")} http://localhost:${app.get(
          "port",
        )}`,
      );
    }
  } catch (error) {
    console.log("error :>> ", error);
  }
});

module.exports.app = app;
