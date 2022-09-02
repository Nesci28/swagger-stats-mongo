/**
 * Created by sv2 on 2/16/17.
 */

import Debug from "debug";
import { NextFunction } from "express";
import path from "path";
import promClient from "prom-client";
import qs from "qs";
import send from "send";
import url from "url";

import { SwsRequest } from "./interfaces/request.interface";
import { SwsResponse } from "./interfaces/response.interface";
import { SwsAuth } from "./swsAuth";
import { swsEgress } from "./swsEgress";
import { SwsMongo } from "./swsMongo";
import swsProcessor from "./swsProcessor";
import swsSettings from "./swsSettings";

let swsMongo;
let swsAuth;
const debug = Debug("sws:interface");

// Request hanlder
function handleRequest(req: SwsRequest, res: SwsResponse): void {
  console.log("handling");
  try {
    swsProcessor.processRequest(req);
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
    handleResponseFinished(this as any);
  });
}

// Response finish hanlder
function handleResponseFinished(res: SwsResponse): void {
  try {
    swsProcessor.processResponse(res);
  } catch (e) {
    debug(`SWS:processResponse:ERROR: ${e}`);
  }
}

// Process /swagger-stats/stats request
// Return statistics according to request parameters
// Query parameters (fields, path, method) defines which stat fields to return
async function processGetStats(
  req: SwsRequest,
  res: SwsResponse,
): Promise<void> {
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
async function processGetMetrics(
  req: SwsRequest,
  res: SwsResponse,
): Promise<void> {
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
function processGetUX(req: SwsRequest, res: SwsResponse): void {
  // alwauys serve ux, it will perform auth as needed
  let fileName;
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
async function expressMiddleware(
  options,
): Promise<
  (req: SwsRequest, res: SwsResponse, next: NextFunction) => Promise<void>
> {
  // Init settings
  swsSettings.init(options);

  // Init Mongo Connection
  swsMongo = new SwsMongo(options);
  await swsMongo.init();

  // Init Auth
  swsAuth = new SwsAuth(swsMongo);

  // Init probes
  swsEgress.init();

  swsProcessor.init();

  const fn = async (
    req: SwsRequest,
    res: SwsResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      res._swsReq = req;
      req.sws = {};
      req.sws.query = qs.parse(url.parse(req.url).query!);

      // Respond to requests handled by swagger-stats
      // swagger-stats requests will not be counted in statistics
      if (req.url === swsSettings.uriPath) {
        res.redirect(`${swsSettings.uriPath}/`);
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

export = {
  getMiddleware: expressMiddleware,

  // TODO Support specifying which stat fields to return
  // Returns object with collected statistics
  getCoreStats(): {
    startts: number;
  } {
    return swsProcessor.getStats();
  },

  // Allow get stats as prometheus format
  async getPromStats(): Promise<string> {
    return promClient.register.metrics();
  },

  // Expose promClient to allow for custom metrics by application
  getPromClient(): typeof promClient {
    return promClient;
  },

  // Stop the processor so that Node.js can exit
  stop(): void {
    return swsProcessor.stop();
  },
};
