/* eslint-disable no-bitwise */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * swagger-stats Processor. Processes requests / responses and maintains metrics
 */
import Redis from "ioredis";
import moment from "moment";

import { SwsRequest } from "./interfaces/request.interface";
import { RequestResponseRecord } from "./interfaces/request-response-record.interface";
import { SwsResponse } from "./interfaces/response.interface";
import { SwsAPIStats } from "./swsAPIStats";
import { SwsCoreStats } from "./swsCoreStats";
import { SwsElasticEmitter } from "./swsElasticEmitter";
import { SwsErrors } from "./swsErrors";
import { SwsLastErrors } from "./swsLastErrors";
import { SwsLongestRequests } from "./swsLongestReq";
import swsSettings from "./swsSettings";
import { SwsSysStats } from "./swsSysStats";
import { SwsTimeline } from "./swsTimeline";
import { SwsUtil } from "./swsUtil";

// swagger-stats Processor. Processes requests / responses and maintains metrics
export class SwsProcessor {
  // Timestamp when collecting statistics started
  private startts = Date.now();

  // Name: Should be name of the service provided by this component
  private name = "sws";

  // Options
  // private options = null;

  private hostname = "";

  private ip = "";

  // Version of this component
  private version = "";

  // This node hostname
  private nodehostname = "";

  // Node name: there could be multiple nodes in this service
  private nodename = "";

  // Node address: there could be multiple nodes in this service
  private nodeaddress = "";

  // onResponseFinish callback, if specified in options
  private onResponseFinish;

  // If set to true via options, track only API defined in swagger spec
  private swaggerOnly = false;

  // System statistics
  private sysStats = new SwsSysStats();

  // Core statistics
  private coreStats: SwsCoreStats;

  // Core Egress statistics
  private coreEgressStats: SwsCoreStats;

  // Timeline
  private timeline: SwsTimeline;

  // API Stats
  private apiStats: SwsAPIStats;

  // Errors
  private errorsStats = new SwsErrors();

  // Last Errors
  private lastErrors = new SwsLastErrors();

  // Longest Requests
  private longestRequests = new SwsLongestRequests();

  // ElasticSearch Emitter
  private elasticsearchEmitter = new SwsElasticEmitter();

  private timer: any;

  constructor(private readonly redis: Redis) {
    this.apiStats = new SwsAPIStats(this.redis);
    this.coreStats = new SwsCoreStats(this.redis);
    this.coreEgressStats = new SwsCoreStats(this.redis);
    this.timeline = new SwsTimeline(this.redis);
  }

  public async init(): Promise<void> {
    this.processOptions();

    this.sysStats.initialize();

    await this.coreStats.initialize();

    await this.coreEgressStats.initialize("egress_");

    await this.timeline.initialize(swsSettings);

    await this.apiStats.initialize(swsSettings);

    this.elasticsearchEmitter.initialize(swsSettings);

    // Start tick
    this.timer = setInterval(this.tick, 200, this);
  }

  // Stop
  public stop(): void {
    clearInterval(this.timer);
  }

  private processOptions(): void {
    this.name = swsSettings.name;
    this.hostname = swsSettings.hostname;
    this.version = swsSettings.version;
    this.ip = swsSettings.ip;
    this.onResponseFinish = swsSettings.onResponseFinish;
    this.swaggerOnly = swsSettings.swaggerOnly;
  }

  // Tick - called with specified interval to refresh timelines
  public tick(that): void {
    const ts = Date.now();
    const totalElapsedSec = (ts - that.startts) / 1000;
    that.sysStats.tick(ts, totalElapsedSec);
    that.coreStats.tick(ts, totalElapsedSec);
    that.timeline.tick(ts, totalElapsedSec);
    that.apiStats.tick(ts, totalElapsedSec);
    that.elasticsearchEmitter.tick(ts, totalElapsedSec);
  }

  // Collect all data for request/response pair
  // TODO Support option to add arbitrary extra properties to sws request/response record
  private collectRequestResponseData(res: SwsResponse): RequestResponseRecord {
    const req = res._swsReq;

    const codeclass = SwsUtil.getStatusCodeClass(res.statusCode);

    const rrr: Partial<RequestResponseRecord> = {
      path: req.sws.originalUrl,
      method: req.method,
      query: `${req.method} ${req.sws.originalUrl}`,
      startts: 0,
      endts: 0,
      responsetime: 0,
      node: {
        name: this.name,
        version: this.version,
        hostname: this.hostname,
        ip: this.ip,
      },
      http: {
        request: {
          url: req.url,
        },
        response: {
          code: res.statusCode.toString(),
          class: codeclass,
          phrase: res.statusMessage,
        },
      },
    };

    // Request Headers
    if ("headers" in req) {
      rrr.http.request.headers = {};
      // eslint-disable-next-line no-restricted-syntax
      for (const hdr of Object.keys(req.headers)) {
        rrr.http.request.headers[hdr] = req.headers[hdr];
      }
      // TODO Split Cookies
    }

    // Response Headers
    const responseHeaders = res.getHeaders();
    if (responseHeaders) {
      rrr.http.response.headers = responseHeaders;
    }

    // Additional details from collected info per request / response pair

    if ("sws" in req) {
      rrr.ip = req.sws.ip;
      rrr.real_ip = req.sws.real_ip;
      rrr.port = req.sws.port;

      rrr["@timestamp"] = moment(req.sws.startts).toISOString();
      // rrr.end = moment(req.sws.endts).toISOString();
      rrr.startts = req.sws.startts;
      rrr.endts = req.sws.endts;
      rrr.responsetime = req.sws.duration;
      rrr.http.request.clength = req.sws.req_clength;
      rrr.http.response.clength = req.sws.res_clength;
      rrr.http.request.route_path = req.sws.route_path;

      // Add detailed swagger API info
      rrr.api = {} as RequestResponseRecord["api"];
      rrr.api.path = req.sws.api_path;
      rrr.api.query = `${req.method} ${req.sws.api_path}`;
      if ("swagger" in req.sws) rrr.api.swagger = req.sws.swagger;
      if ("deprecated" in req.sws) rrr.api.deprecated = req.sws.deprecated;
      if ("operationId" in req.sws) rrr.api.operationId = req.sws.operationId;
      if ("tags" in req.sws) rrr.api.tags = req.sws.tags;

      // Get API parameter values per definition in swagger spec
      const apiParams = this.apiStats.getApiOpParameterValues(
        req.sws.api_path,
        req.method,
        req,
      );
      if (apiParams !== null) {
        rrr.api.params = apiParams as any;
      }

      // TODO Support Arbitrary extra properties added to request under sws
      // So app can add any custom data to request, and it will be emitted in record
    }

    // Express/Koa parameters: req.params (router) and req.body (body parser)
    if (Object.prototype.hasOwnProperty.call(req, "params")) {
      rrr.http.request.params = {};
      SwsUtil.swsStringRecursive(rrr.http.request.params, req.params);
    }

    if (req.sws && Object.prototype.hasOwnProperty.call(req.sws, "query")) {
      rrr.http.request.query = {};
      SwsUtil.swsStringRecursive(rrr.http.request.query, req.sws.query);
    }

    if (Object.prototype.hasOwnProperty.call(req, "body")) {
      rrr.http.request.body = { ...req.body };
      // SwsUtil.swsStringRecursive(rrr.http.request.body, req.body);
    }

    return rrr as RequestResponseRecord;
  }

  private getRemoteIP(req: SwsRequest): string {
    let ip;
    try {
      ip = req.connection.remoteAddress;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("e :>> ", e);
    }
    return ip;
  }

  private getPort(req: SwsRequest): number {
    let p;
    try {
      p = req.connection.localPort;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("e :>> ", e);
    }
    return p;
  }

  private getRemoteRealIP(req: SwsRequest): string {
    let remoteaddress;
    const xfwd = req.headers["x-forwarded-for"];
    if (xfwd && typeof xfwd === "string") {
      const fwdaddrs = xfwd.split(","); // Could be "client IP, proxy 1 IP, proxy 2 IP"
      // eslint-disable-next-line prefer-destructuring
      remoteaddress = fwdaddrs[0];
    }
    if (!remoteaddress) {
      remoteaddress = this.getRemoteIP(req);
    }
    return remoteaddress;
  }

  private getResponseContentLength(req: SwsRequest, res: SwsResponse): number {
    if ("contentLength" in res && res._contentLength !== null) {
      return res._contentLength;
    }

    // Try to get header
    const hcl = res.getHeader("content-length");
    if (hcl !== undefined && hcl && !Number.isNaN(hcl)) {
      return +hcl;
    }

    // If this does not work, calculate using bytesWritten
    // taking into account res._header
    const initial = req.sws.initialBytesWritten || 0;
    let written = req.socket.bytesWritten - initial;
    if ("_header" in res) {
      const hbuf = Buffer.from(res._header);
      const hslen = hbuf.length;
      written -= hslen;
    }
    return written;
  }

  public async processRequest(req: SwsRequest): Promise<void> {
    // Placeholder for sws-specific attributes
    req.sws = req.sws || {};

    // Setup sws props and pass to stats processors
    const ts = Date.now();

    let reqContentLength = 0;
    if ("content-length" in req.headers) {
      reqContentLength = +(req.headers?.["content-length"] || 0);
    }

    req.sws.originalUrl = req.originalUrl || req.url;
    req.sws.track = true;
    req.sws.startts = ts;
    req.sws.timelineid = Math.floor(
      ts / this.timeline.settings.bucket_duration,
    );
    req.sws.req_clength = reqContentLength;
    req.sws.ip = this.getRemoteIP(req);
    req.sws.real_ip = this.getRemoteRealIP(req);
    req.sws.port = this.getPort(req);
    req.sws.initialBytesWritten = req.socket.bytesWritten;

    // Try to match to API right away
    this.apiStats.matchRequest(req);

    // if no match, and tracking of non-swagger requests is disabled, return
    if (!req.sws.match && this.swaggerOnly) {
      req.sws.track = false;
      return;
    }

    // Core stats
    await this.coreStats.countRequest(req);

    // Timeline
    await this.timeline.countRequest(req);

    // TODO Check if needed
    await this.apiStats.countRequest(req);
  }

  public async processResponse(res: SwsResponse): Promise<void> {
    try {
      const req = res._swsReq;

      req.sws = req.sws || {};

      const startts = req.sws.startts || 0;
      req.sws.endts = Date.now();
      req.sws.duration = req.sws.endts - startts;
      // let timelineid = req.sws.timelineid || 0;

      if ("inflightTimer" in req.sws) {
        clearTimeout(req.sws.inflightTimer);
      }

      req.sws.res_clength = this.getResponseContentLength(req, res);

      let routePath = "";
      if ("route_path" in req.sws) {
        // Route path could be pre-set in sws by previous handlers/hooks ( Fastify )
        routePath = req.sws.route_path;
      }
      if ("route" in req && "path" in req.route) {
        // Capture route path for the request, if set by router (Express)
        if ("baseUrl" in req && req.baseUrl !== undefined)
          routePath = req.baseUrl;
        routePath += req.route.path;
        req.sws.route_path = routePath;
      }

      // If request was not matched to Swagger API, set API path:
      // Use route_path, if exist; if not, use sws.originalUrl
      if (!("api_path" in req.sws)) {
        req.sws.api_path = routePath !== "" ? routePath : req.sws.originalUrl;
      }

      // Pass through Core Statistics
      await this.coreStats.countResponse(res);

      // Pass through Timeline
      await this.timeline.countResponse(res);

      // Pass through API Statistics
      await this.apiStats.countResponse(res);

      // Pass through Errors
      this.errorsStats.countResponse(res);

      // Collect request / response record
      const rrr = this.collectRequestResponseData(res);

      // Pass through last errors
      this.lastErrors.processReqResData(rrr);

      // Pass through longest request
      this.longestRequests.processReqResData(rrr);

      // Pass to app if callback is specified
      if (this.onResponseFinish !== null) {
        this.onResponseFinish(req, res, rrr);
      }

      // Push Request/Response Data to Emitter(s)
      this.elasticsearchEmitter.processRecord(rrr);

      // debugrrr('%s', JSON.stringify(rrr));
    } catch (err) {
      console.log("err :>> ", err);
    }
  }

  // Get stats according to fields and params specified in query
  public async getStats(
    query?: any,
  ): Promise<{ startts: number } & Record<string, unknown>> {
    // eslint-disable-next-line no-param-reassign
    query = typeof query !== "undefined" ? query : {};
    // eslint-disable-next-line no-param-reassign
    query = query !== null ? query : {};

    let statfields = []; // Default

    // Check if we have query parameter "fields"
    if ("fields" in query) {
      if (query.fields instanceof Array) {
        statfields = query.fields;
      } else {
        const fieldsstr = query.fields;
        statfields = fieldsstr.split(",");
      }
    }

    // sys, ingress and egress core statistics are returned always
    const result: { startts: number } & Record<string, unknown> = {
      startts: this.startts,
    };
    result.all = this.coreStats.getStats();
    result.egress = this.coreEgressStats.getStats();
    result.sys = this.sysStats.getStats();

    // add standard properties, returned always
    result.name = this.name;
    result.version = this.version;
    result.hostname = this.hostname;
    result.ip = this.ip;
    result.apdexThreshold = swsSettings.apdexThreshold;

    let fieldMask = 0;
    for (let i = 0; i < statfields.length; i += 1) {
      const fld = statfields[i];
      if (fld in SwsUtil.swsStatFields) {
        fieldMask |= SwsUtil.swsStatFields[fld];
      }
    }

    // console.log('Field mask:' + fieldMask.toString(2) );

    // Populate per mask
    if (fieldMask & SwsUtil.swsStatFields.method)
      result.method = this.coreStats.getMethodStats();
    if (fieldMask & SwsUtil.swsStatFields.timeline)
      result.timeline = this.timeline.getStats();
    if (fieldMask & SwsUtil.swsStatFields.lasterrors)
      result.lasterrors = this.lastErrors.getStats();
    if (fieldMask & SwsUtil.swsStatFields.longestreq)
      result.longestreq = this.longestRequests.getStats();
    if (fieldMask & SwsUtil.swsStatFields.apidefs)
      result.apidefs = this.apiStats.getAPIDefs();
    if (fieldMask & SwsUtil.swsStatFields.apistats)
      result.apistats = await this.apiStats.getAPIStats();
    if (fieldMask & SwsUtil.swsStatFields.errors)
      result.errors = this.errorsStats.getStats();

    if (fieldMask & SwsUtil.swsStatFields.apiop) {
      if ("path" in query && "method" in query) {
        result.apiop = await this.apiStats.getAPIOperationStats(
          query.path,
          query.method,
        );
      }
    }

    return result;
  }
}
