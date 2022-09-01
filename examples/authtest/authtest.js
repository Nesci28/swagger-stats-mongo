const http = require("http");
const path = require("path");
const debug = require("debug")("sws:authtest");

// Prometheus Client
const promClient = require("prom-client");
const SwaggerParser = require("swagger-parser");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Express and middlewares
const express = require("express");
const expressBodyParser = require("body-parser");
const swStats = require("../../dist/index.js"); // require('swagger-stats');

const { collectDefaultMetrics } = promClient;
// Probe every 1 second
collectDefaultMetrics({ timeout: 1000 });

// Server
let server = null;

// eslint-disable-next-line no-multi-assign
const app = (module.exports = express());
app.use(expressBodyParser.json());
app.use(expressBodyParser.urlencoded({ extended: true }));

// JSON formatting
app.set("json spaces", 2);
app.set("json replacer", null);

// all environments
app.set("port", process.env.PORT || 3050);

// Suppress cache on the GET API responses
app.disable("etag");

app.get("/", (req, res) => {
  res.redirect("/swagger-stats/");
});

// Return Prometheus metrics from prom-client
app.get("/metrics", (req, res) => {
  res.status(200).set("Content-Type", "text/plain");
  Promise.resolve(promClient.register.metrics()).then((x) => {
    res.end(x);
  });
});

const specLocation = path.join(__dirname, "petstore.json");

let maxAge = 900;
if (process.env.SWS_AUTHTEST_MAXAGE) {
  maxAge = +process.env.SWS_AUTHTEST_MAXAGE;
}

debug(`Loading Swagger Spec from ${specLocation}`);

// eslint-disable-next-line import/no-dynamic-require
const swaggerSpec = require(specLocation);

const parser = new SwaggerParser();

parser.validate(swaggerSpec, async (err) => {
  if (!err) {
    debug("Success validating swagger file!");

    await MongoMemoryServer.create({
      instance: {
        port: 27027,
        dbName: "swagger-stats",
      },
    });

    app.use(
      await swStats.getMiddleware({
        name: "swagger-stats-authtest",
        version: "0.99.2",
        hostname: "hostname",
        ip: "127.0.0.1",
        swaggerSpec,
        swaggerOnly: true,
        uriPath: "/swagger-stats",
        durationBuckets: [10, 25, 50, 100, 200],
        requestSizeBuckets: [10, 25, 50, 100, 200],
        responseSizeBuckets: [10, 25, 50, 100, 200],
        apdexThreshold: 100,
        MONGO_URL: "127.0.0.1:27027",
        SWAGGER_STATS_MONGO_DB: "swagger-stats",
        onResponseFinish(req, res, rrr) {
          debug("onResponseFinish: %s", JSON.stringify(rrr));
        },
        authentication: true,
        sessionMaxAge: maxAge,
        onAuthenticate(req, username, password) {
          // simple check for username and password
          if (username === "swagger-stats") {
            const isAuth =
              username === "swagger-stats" && password === "swagger-stats";
            return isAuth;
          }
          if (username === "swagger-promise") {
            return new Promise((resolve) => {
              setTimeout(() => {
                resolve(
                  username === "swagger-promise" &&
                    password === "swagger-promise",
                );
              }, 1000);
            });
          }

          return false;
        },
      }),
    );
  }

  // Implement mock API
  app.use(mockApiImplementation);

  // Setup server
  server = http.createServer(app);
  server.listen(app.get("port"));
  debug(
    `Server started on port ${app.get("port")} http://localhost:${app.get(
      "port",
    )}`,
  );
});

// Mock implementation of any API request
// Supports the following parameters in x-sws-res header:
// x-sws-res={ code:<response code>,
//             message:<message to provide in response>,
//             delay:<delay to respond>,
//             payloadsize:<size of payload JSON to generate>
//           }
function mockApiImplementation(req, res) {
  let code = 500;
  let message = "MOCK API RESPONSE";
  let delay = 0;
  let payloadsize = 0;

  // get header
  const hdrSwsRes = req.header("x-sws-res");

  if (typeof hdrSwsRes !== "undefined") {
    const swsRes = JSON.parse(hdrSwsRes);
    if ("code" in swsRes) code = swsRes.code;
    if ("message" in swsRes) message = swsRes.message;
    if ("delay" in swsRes) delay = swsRes.delay;
    if ("payloadsize" in swsRes) payloadsize = swsRes.payloadsize;
  }

  if (delay > 0) {
    setTimeout(() => {
      mockApiSendResponse(res, code, message, payloadsize);
    }, delay);
  } else {
    mockApiSendResponse(res, code, message, payloadsize);
  }
}

function mockApiSendResponse(res, code, message, payloadsize) {
  if (payloadsize <= 0) {
    res.status(code).send(message);
  } else {
    // generate dummy payload of approximate size
    const dummyPayload = [];
    let adjSize = payloadsize - 4;
    if (adjSize <= 0) adjSize = 1;
    let str = "";
    for (let i = 0; i < adjSize; i += 1) str += "a";
    dummyPayload.push(str);
    res.status(code).json(dummyPayload);
  }
}

process.on("unhandledRejection", (error) => {
  debug("unhandledRejection", error.message, error.stack);
});

module.exports.app = app;
