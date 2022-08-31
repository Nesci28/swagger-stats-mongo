/**
 * Created by sv2 on 2/16/17.
 */

const path = require("path");
const url = require("url");
const debug = require("debug")("sws:interface");
const promClient = require("prom-client");
const send = require("send");
const qs = require("qs");
const swsSettings = require("./swsSettings.js");
const swsProcessor = require("./swsProcessor.js");
const swsEgress = require("./swsEgress.js");
const SwsAuth = require("./swsAuth.js");
const SwsMongo = require("./swsMongo.js");

let swsMongo;
let swsAuth;

// Request hanlder
function handleRequest(req, res) {
  try {
    swsProcessor.processRequest(req, res);
  } catch (e) {
    debug(`SWS:processRequest:ERROR: ${e}`);
    return;
  }

  if ("sws" in req && "track" in req.sws && !req.sws.track) {
    // Tracking disabled for this request
    return;
  }

  // Setup handler for finishing reponse
  // eslint-disable-next-line func-names
  res.on("finish", function () {
    handleResponseFinished(this);
  });
}

// Response finish hanlder
function handleResponseFinished(res) {
  try {
    swsProcessor.processResponse(res);
  } catch (e) {
    debug(`SWS:processResponse:ERROR: ${e}`);
  }
}

// Process /swagger-stats/stats request
// Return statistics according to request parameters
// Query parameters (fields, path, method) defines which stat fields to return
async function processGetStats(req, res) {
  const authResult = await swsAuth.processAuth(req, res);
  if (!authResult) {
    return;
  }
  res.statusCode = 200;
  if ("sws-auth" in req && req["sws-auth"]) {
    res.setHeader("x-sws-authenticated", "true");
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(swsProcessor.getStats(req.sws.query)));
}

// Process /swagger-stats/metrics request
// Return all metrics for Prometheus
async function processGetMetrics(req, res) {
  const authResult = await swsAuth.processAuth(req, res);
  if (!authResult) {
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  // [sv2] This should handle both non-promise (prom-client 11,12) and promise results (prom-client 13+)
  const x = await Promise.resolve(promClient.register.metrics());
  res.end(x);
}

// Process /swagger-stats/ux request
function processGetUX(req, res) {
  // alwauys serve ux, it will perform auth as needed
  let fileName = null;
  if (req.url === swsSettings.pathUX) {
    fileName = "index.html";
  } else {
    fileName = req.url.replace(swsSettings.pathUX, "");
    const qidx = fileName.indexOf("?");
    if (qidx !== -1) {
      fileName = fileName.substring(0, qidx);
    }
  }
  const options = {
    root: path.join(__dirname, "..", "ux"),
    dotfiles: "deny",
    // TODO Caching
  };
  res.setHeader("Content-Type", send.mime.lookup(path.basename(fileName)));
  send(req, fileName, options).pipe(res);
}

// Express Middleware
async function expressMiddleware(options) {
  // Init settings
  swsSettings.init(options);

  // Init Mongo Connection
  swsMongo = new SwsMongo(options);
  await swsMongo.init();

  // Init Auth
  swsAuth = new SwsAuth(swsMongo);

  // Init probes
  swsEgress.init();

  swsProcessor.init(swsMongo);

  const fn = async (req, res, next) => {
    try {
      res._swsReq = req;
      req.sws = {};
      req.sws.query = qs.parse(url.parse(req.url).query);

      // Respond to requests handled by swagger-stats
      // swagger-stats requests will not be counted in statistics
      if (req.url === swsSettings.uriPath) {
        if ("serverName" in req && req.serverName === "restify") {
          res.redirect(`${swsSettings.uriPath}/`, next);
        } else {
          res.redirect(`${swsSettings.uriPath}/`);
        }
        return;
      }
      if (req.url.startsWith(swsSettings.pathStats)) {
        return processGetStats(req, res);
      }
      if (req.url.startsWith(swsSettings.pathMetrics)) {
        return processGetMetrics(req, res);
      }
      if (req.url.startsWith(swsSettings.pathLogout)) {
        await swsAuth.processLogout(req, res);
        return;
      }
      if (req.url.startsWith(swsSettings.pathUX)) {
        return processGetUX(req, res);
      }

      handleRequest(req, res);

      return next();
    } catch (err) {
      console.log("err :>> ", err);
    }
  };

  return fn;
}

module.exports = {
  getMiddleware: expressMiddleware,

  // TODO Support specifying which stat fields to return
  // Returns object with collected statistics
  getCoreStats() {
    return swsProcessor.getStats();
  },

  // Allow get stats as prometheus format
  getPromStats() {
    return promClient.register.metrics();
  },

  // Expose promClient to allow for custom metrics by application
  getPromClient() {
    return promClient;
  },

  // Stop the processor so that Node.js can exit
  stop() {
    return swsProcessor.stop();
  },
};
