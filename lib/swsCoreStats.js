/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * API usage statistics data
 */

const swsSettings = require("./swssettings.js");
const swsMetrics = require("./swsmetrics.js");
const swsUtil = require("./swsUtil.js");
const SwsReqResStats = require("./swsReqResStats.js");

/* swagger=stats Prometheus metrics */
class SwsCoreStats {
  constructor() {
    // Statistics for all requests
    this.all = null;

    // Statistics for requests by method
    // Initialized with most frequent ones, other methods will be added on demand if actually used
    this.method = null;

    // Additional prefix for prometheus metrics. Used if this coreStats instance
    // plays special role, i.e. count stats for egress
    this.metricsRolePrefix = "";

    // Prometheus metrics
    this.promClientMetrics = {};
  }

  // Initialize
  initialize(metricsRolePrefix) {
    this.metricsRolePrefix = metricsRolePrefix || "";

    // Statistics for all requests
    this.all = new SwsReqResStats(swsSettings.apdexThreshold);

    // Statistics for requests by method
    // Initialized with most frequent ones, other methods will be added on demand if actually used
    this.method = {
      GET: new SwsReqResStats(swsSettings.apdexThreshold),
      POST: new SwsReqResStats(swsSettings.apdexThreshold),
      PUT: new SwsReqResStats(swsSettings.apdexThreshold),
      DELETE: new SwsReqResStats(swsSettings.apdexThreshold),
    };

    // metrics
    swsMetrics.clearPrometheusMetrics(this.promClientMetrics);

    const prefix = swsSettings.metricsPrefix + this.metricsRolePrefix;
    this.promClientMetrics = swsMetrics.getPrometheusMetrics(
      prefix,
      swsMetrics.coreMetricsDefs,
    );
  }

  getStats() {
    return this.all;
  }

  getMethodStats() {
    return this.method;
  }

  // Update timeline and stats per tick
  tick(ts, totalElapsedSec) {
    // Rates
    this.all.updateRates(totalElapsedSec);
    // eslint-disable-next-line no-restricted-syntax
    for (const mname of Object.keys(this.method)) {
      this.method[mname].updateRates(totalElapsedSec);
    }
  }

  // Count request
  countRequest(req) {
    // Count in all
    this.all.countRequest(req.sws.req_clength);

    // Count by method
    const { method } = req;
    if (!(method in this.method)) {
      this.method[method] = new SwsReqResStats();
    }
    this.method[method].countRequest(req.sws.req_clength);

    // Update prom-client metrics
    this.promClientMetrics.api_all_request_total.inc();
    this.promClientMetrics.api_all_request_in_processing_total.inc();
    req.sws.inflightTimer = setTimeout(() => {
      this.promClientMetrics.api_all_request_in_processing_total.dec();
    }, 250000);
  }

  countResponse(res) {
    const req = res._swsReq;

    // Defaults
    const duration = req.sws.duration || 0;
    const resContentLength = req.sws.res_clength || 0;
    // let timelineid = req.sws.timelineid || 0;
    // let path = req.sws.api_path || req.sws.originalUrl || req.originalUrl;

    /*
        if("sws" in req) {
            startts = req.sws.startts;
            timelineid = req.sws.timelineid;
            var endts = Date.now();
            req['sws'].endts = endts;
            duration = endts - startts;
            req['sws'].duration = duration;
            req['sws'].res_clength = resContentLength;
            path = req['sws'].api_path;
            clearTimeout(req.sws.inflightTimer);
        }
        */

    // Determine status code type
    const codeclass = swsUtil.getStatusCodeClass(res.statusCode);

    // update counts for all requests
    this.all.countResponse(
      res.statusCode,
      codeclass,
      duration,
      resContentLength,
    );

    // Update method-specific stats
    const { method } = req;
    if (method in this.method) {
      const mstat = this.method[method];
      mstat.countResponse(
        res.statusCode,
        codeclass,
        duration,
        resContentLength,
      );
    }

    // Update Prometheus metrics
    switch (codeclass) {
      case "success":
        this.promClientMetrics.api_all_success_total.inc();
        break;
      case "redirect":
        // NOOP //
        break;
      case "client_error":
        this.promClientMetrics.api_all_errors_total.inc();
        this.promClientMetrics.api_all_client_error_total.inc();
        break;
      case "server_error":
        this.promClientMetrics.api_all_errors_total.inc();
        this.promClientMetrics.api_all_server_error_total.inc();
        break;
      default:
        throw new Error("default case should not be happening");
    }
    this.promClientMetrics.api_all_request_in_processing_total.dec();
  }
}

module.exports = SwsCoreStats;
