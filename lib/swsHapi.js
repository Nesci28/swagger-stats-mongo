/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* swagger-stats Hapi plugin */
const path = require("path");
const url = require("url");
const qs = require("qs");
const send = require("send");
const promClient = require("prom-client");
const debug = require("debug")("sws:hapi");
const swsSettings = require("./swssettings.js");
const swsProcessor = require("./swsProcessor.js");
const swsAuth = require("./swsAuth.js");

/* HAPI Plugin */
class SwsHapi {
  constructor() {
    this.effectiveOptions = {};
    this.processor = swsProcessor;
  }

  // Registers Hapi Plugin
  async register(server, options) {
    const { processor } = this;
    // eslint-disable-next-line prefer-arrow-callback, func-names
    server.events.on("response", function (request) {
      const nodeReq = request.raw.req;
      // Check if tracking
      if (
        "sws" in nodeReq &&
        "track" in nodeReq.sws &&
        nodeReq.sws.track === false
      ) {
        return;
      }
      const nodeRes = request.raw.res;
      try {
        processor.processResponse(nodeRes);
      } catch (e) {
        debug(`processResponse:ERROR: ${e}`);
      }
    });
    await server.ext("onRequest", async (request, h) => {
      const nodeReq = request.raw.req;
      const nodeRes = request.raw.res;
      nodeRes._swsReq = nodeReq;
      nodeReq.sws = {};
      nodeReq.sws.query = qs.parse(url.parse(nodeReq.url).query);
      const reqUrl = nodeReq.url;
      if (reqUrl.startsWith(swsSettings.uriPath)) {
        // Don't track sws requests
        nodeReq.sws.track = false;
        /*
                if(reqUrl.startsWith(swsSettings.pathStats)){
                    let authResult  = await swsAuth.processAuth(request.raw.req,request.raw.res);
                    if( authResult ){
                        //return h.continue;
                        return processor.getStats(request.raw.req.sws.query);
                    }
                } */
        return h.continue;
      }
      try {
        processor.processRequest(nodeReq, nodeRes);
      } catch (e) {
        debug(`processRequest:ERROR: ${e}`);
      }
      return h.continue;
    });
    // Return statistics
    server.route({
      method: "GET",
      path: swsSettings.pathStats,
      async handler(request, h) {
        const authResult = await swsAuth.processAuth(
          request.raw.req,
          request.raw.res,
        );
        if (!authResult) {
          return h.abandon;
        }
        if ("sws-auth" in request.raw.req && request.raw.req["sws-auth"]) {
          request.raw.res.setHeader("x-sws-authenticated", "true");
        }
        return processor.getStats(request.raw.req.sws.query);
      },
      options: options.routeOptions,
    });
    // Return metrics
    server.route({
      method: "GET",
      path: swsSettings.pathMetrics,
      async handler(request, h) {
        const authResult = await swsAuth.processAuth(
          request.raw.req,
          request.raw.res,
        );
        if (!authResult) {
          return h.abandon;
        }
        const response = h.response(await promClient.register.metrics());
        response.code(200);
        response.header("Content-Type", "text/plain");
        return response;
      },
      options: options.routeOptions,
    });
    // Logout
    server.route({
      method: "GET",
      path: swsSettings.pathLogout,
      handler(request, h) {
        swsAuth.processLogout(request.raw.req, request.raw.res);
        return h.abandon;
      },
      options: options.routeOptions,
    });
    // Return UX
    server.route({
      method: "GET",
      path: `${swsSettings.pathUX}{file*}`,
      handler(request, h) {
        let fileName = request.params.file;
        if (!fileName) {
          fileName = "index.html";
        }
        const opt = {
          root: path.join(__dirname, "..", "ux"),
          dotfiles: "deny",
          // TODO Caching
        };
        request.raw.res.setHeader(
          "Content-Type",
          send.mime.lookup(path.basename(fileName)),
        );
        send(request.raw.req, fileName, opt).pipe(request.raw.res);
        return h.abandon;
      },
      options: options.routeOptions,
    });
  }
}

const swsHapi = new SwsHapi();
module.exports = swsHapi;
