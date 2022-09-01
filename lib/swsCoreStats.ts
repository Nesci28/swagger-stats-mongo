/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * API usage statistics data
 */
import promClient from "prom-client";

import { CoreMethods } from "./interfaces/core-methods.interface";
import { SwsRequest } from "./interfaces/request.interface";
import { SwsResponse } from "./interfaces/response.interface";
import swsMetrics from "./swsMetrics";
import { SwsReqResStats } from "./swsReqResStats";
import swsSettings from "./swsSettings";
import { SwsUtil } from "./swsUtil";

/* swagger=stats Prometheus metrics */
export class SwsCoreStats {
  // Statistics for all requests
  private all = new SwsReqResStats(swsSettings.apdexThreshold);

  // Statistics for requests by method
  // Initialized with most frequent ones, other methods will be added on demand if actually used
  private method: CoreMethods = {};

  // Additional prefix for prometheus metrics. Used if private coreStats instance
  // plays special role, i.e. count stats for egress
  private metricsRolePrefix = "";

  // Prometheus metrics
  private promClientMetrics: {
    [key: string]:
      | promClient.Counter<string>
      | promClient.Gauge<string>
      | promClient.Histogram<string>;
    // | promClient.Histogram<string>;
  } = {};

  // Initialize
  public initialize(metricsRolePrefix?: string): void {
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

  public getStats(): SwsReqResStats {
    return this.all;
  }

  public getMethodStats(): CoreMethods {
    return this.method;
  }

  // Update timeline and stats per tick
  public tick(totalElapsedSec: number): void {
    // Rates
    this.all.updateRates(totalElapsedSec);
    // eslint-disable-next-line no-restricted-syntax
    for (const mname of Object.keys(this.method)) {
      this.method[mname].updateRates(totalElapsedSec);
    }
  }

  // Count request
  public countRequest(req: SwsRequest): void {
    // Count in all
    this.all.countRequest(req.sws.req_clength);

    // Count by method
    const { method } = req;
    if (!(method in this.method)) {
      this.method[method] = new SwsReqResStats(swsSettings.apdexThreshold);
    }
    this.method[method].countRequest(req.sws.req_clength);

    // Update prom-client metrics
    (
      this.promClientMetrics.api_all_request_total as promClient.Gauge<string>
    ).inc();
    (
      this.promClientMetrics
        .api_all_request_in_processing_total as promClient.Gauge<string>
    ).inc();
    req.sws.inflightTimer = setTimeout(() => {
      (
        this.promClientMetrics
          .api_all_request_in_processing_total as promClient.Gauge<string>
      ).dec();
    }, 250000);
  }

  public countResponse(res: SwsResponse): void {
    const req = res._swsReq;

    // Defaults
    const duration = req.sws.duration || 0;
    const resContentLength = req.sws.res_clength || 0;
    // let timelineid = req.sws.timelineid || 0;
    // let path = req.sws.api_path || req.sws.originalUrl || req.originalUrl;

    // Determine status code type
    const codeclass = SwsUtil.getStatusCodeClass(res.statusCode);

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
        (
          this.promClientMetrics
            .api_all_success_total as promClient.Gauge<string>
        ).inc();
        break;
      case "redirect":
        // NOOP //
        break;
      case "client_error":
        (
          this.promClientMetrics
            .api_all_errors_total as promClient.Gauge<string>
        ).inc();
        (
          this.promClientMetrics
            .api_all_client_error_total as promClient.Gauge<string>
        ).inc();
        break;
      case "server_error":
        (
          this.promClientMetrics
            .api_all_errors_total as promClient.Gauge<string>
        ).inc();
        (
          this.promClientMetrics
            .api_all_server_error_total as promClient.Gauge<string>
        ).inc();
        break;
      default:
        throw new Error("default case should not be happening");
    }
    (
      this.promClientMetrics
        .api_all_request_in_processing_total as promClient.Gauge<string>
    ).dec();
  }
}
