/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* swagger=stats egress http monitor */

const debug = require("debug")("sws:egress");
const http = require("http");
const swsSettings = require("./swssettings.js");

let originalRequest = null;

/* swagger=stats egress http monitor */
class SwsEgress {
  init() {
    // Process Options
    if (swsSettings.enableEgress) {
      this.enableEgressMonitoring();
    }
  }

  enableEgressMonitoring() {
    originalRequest = http.request;
    http.request = wrapMethodRequest;
  }

  handleRequest(req) {
    const h = req.getHeader("host");
    debug(`Got request: ${req.method} ${h} ${req.path}`);
    req.once("response", (res) => {
      debug(`Got response to request: ${res.statusCode} ${res.statusMessage}`);
      // Consume response object
    });
  }
}

const swsEgress = new SwsEgress();

function wrapMethodRequest(...args) {
  const req = originalRequest.apply(this, args);
  swsEgress.handleRequest(req);
  return req;
}
// TODO get

module.exports = swsEgress;
