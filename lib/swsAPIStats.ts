/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * API Statistics
 */
import Debug from "debug";
import { Key, pathToRegexp } from "path-to-regexp";
import promClient from "prom-client";

import { AllMetrics } from "./interfaces/all-metrics.interface";
import {
  ApiDef,
  ApiDefs,
  ApiDefsMethod,
} from "./interfaces/api-defs.interface";
import {
  ApiDetail,
  ApiDetails,
  ApiDetailsMethod,
} from "./interfaces/api-details.interface";
import { APIOperationStats } from "./interfaces/api-operation-stats.interface";
import { ApiStats, ApiStatsMethod } from "./interfaces/api-stats.interface";
import { HTTPMethod } from "./interfaces/http-method.interface";
import { SwsRequest } from "./interfaces/request.interface";
import { SwsResponse } from "./interfaces/response.interface";
import { SwsBucketStats } from "./swsBucketStats";
import swsMetrics from "./swsMetrics";
import { SwsReqResStats } from "./swsReqResStats";
import swsSettings from "./swsSettings";
import { SwsUtil } from "./swsUtil";

// API Statistics
// Stores Definition of API based on Swagger Spec
// Stores API Statistics, for both Swagger spec-based API, as well as for detected Express APIs (route.path)
// Stores Detailed Stats for each API request
export class SwsAPIStats {
  private debug = Debug("sws:apistats");

  private options: any;

  private basePath = "/";

  private apiMatchIndex = {};

  private apidefs: ApiDefs = {};

  private apistats: ApiStats = {};

  private apidetails: ApiDetails = {};

  private durationBuckets = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  private requestSizeBuckets = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  private responseSizeBuckets = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  private promClientMetrics: AllMetrics = {};

  public getAPIDefs(): ApiDefs {
    return this.apidefs;
  }

  public getAPIStats(): ApiStats {
    return this.apistats;
  }

  public getAPIOperationStats(
    path: string,
    method: HTTPMethod,
  ): APIOperationStats {
    if (typeof path === "undefined" || !path) return {};
    if (typeof method === "undefined" || !method) return {};

    const res = {};
    res[path] = {};
    res[path][method] = {};

    // api op defs
    if (path in this.apidefs && method in this.apidefs[path]) {
      res[path][method].defs = this.apidefs[path][method];
    }

    // api op stats
    if (path in this.apistats && method in this.apistats[path]) {
      res[path][method].stats = this.apistats[path][method];
    }

    // api op details
    if (path in this.apidetails && method in this.apidetails[path]) {
      res[path][method].details = this.apidetails[path][method];
    }

    return res;
  }

  private initBasePath(swaggerSpec, swsOptions): void {
    if ("basePath" in swsOptions && swsOptions.basePath !== "") {
      this.basePath = swsOptions.basePath;
    } else if (swaggerSpec.openapi && swaggerSpec.openapi.startsWith("3")) {
      this.basePath = "/";
    } else {
      this.basePath = swaggerSpec.basePath ? swaggerSpec.basePath : "/";
      if (this.basePath.charAt(0) !== "/") {
        this.basePath = `/${this.basePath}`;
      }
    }
    if (this.basePath.charAt(this.basePath.length - 1) !== "/") {
      this.basePath += "/";
    }
  }

  // Get full swagger Path
  private getFullPath(path: string): string {
    let fullPath = this.basePath;
    if (path.charAt(0) === "/") {
      fullPath += path.substring(1);
    } else {
      fullPath += path;
    }
    return fullPath;
  }

  public initialize(swsOptions): void {
    if (!swsOptions) {
      return;
    }

    this.options = swsOptions;

    this.durationBuckets = swsSettings.durationBuckets;
    this.requestSizeBuckets = swsSettings.requestSizeBuckets;
    this.responseSizeBuckets = swsSettings.responseSizeBuckets;

    // Update buckets to reflect passed options
    swsMetrics.apiMetricsDefs.api_request_duration_milliseconds.buckets =
      this.durationBuckets;
    swsMetrics.apiMetricsDefs.api_request_size_bytes.buckets =
      this.requestSizeBuckets;
    swsMetrics.apiMetricsDefs.api_response_size_bytes.buckets =
      this.responseSizeBuckets;

    swsMetrics.clearPrometheusMetrics(this.promClientMetrics);
    this.promClientMetrics = swsMetrics.getPrometheusMetrics(
      swsSettings.metricsPrefix,
      swsMetrics.apiMetricsDefs,
    );

    if (!("swaggerSpec" in swsOptions)) return;
    if (swsOptions.swaggerSpec === null) return;

    const { swaggerSpec } = swsOptions;

    this.initBasePath(swaggerSpec, swsOptions);

    if (!swaggerSpec.paths) return;

    // Enumerate all paths entries
    // eslint-disable-next-line no-restricted-syntax
    for (const path of Object.keys(swaggerSpec.paths)) {
      const pathDef = swaggerSpec.paths[path];

      // Create full path
      const fullPath = this.getFullPath(path);

      // by default, regex is null
      const keys: Key[] = [];
      let re: RegExp | undefined;

      // Convert to express path
      let fullExpressPath = fullPath;

      // Create regex if we have path parameters
      if (fullExpressPath.indexOf("{") !== -1) {
        fullExpressPath = fullExpressPath.replace(/\{/g, ":");
        fullExpressPath = fullExpressPath.replace(/\}/g, "");
        fullExpressPath = fullExpressPath.replace(/\?(\w+=)/g, "\\?$1");
        re = pathToRegexp(fullExpressPath, keys);
      }

      // Add to API Match Index, leveraging express style matching
      this.apiMatchIndex[fullPath] = {
        re,
        keys,
        expressPath: fullExpressPath,
        methods: {},
      };

      const operations = [
        "get",
        "put",
        "post",
        "delete",
        "options",
        "head",
        "patch",
      ];
      for (let i = 0; i < operations.length; i += 1) {
        const op = operations[i];
        if (op in pathDef) {
          const opDef = pathDef[op];
          const opMethod = op.toUpperCase() as HTTPMethod;

          const apiOpDef: ApiDef = {}; // API Operation definition
          apiOpDef.swagger = true; // by definition
          apiOpDef.deprecated =
            "deprecated" in opDef ? opDef.deprecated : false;
          if ("description" in opDef) apiOpDef.description = opDef.description;
          if ("operationId" in opDef) apiOpDef.operationId = opDef.operationId;
          if ("summary" in opDef) apiOpDef.summary = opDef.summary;
          if ("tags" in opDef) apiOpDef.tags = opDef.tags;

          // Store in match index
          this.apiMatchIndex[fullPath].methods[opMethod] = apiOpDef;

          // Store in API Operation definitions. Stored separately so only definition can be retrieved
          if (!(fullPath in this.apidefs)) {
            this.apidefs[fullPath] = {} as ApiDefsMethod;
          }
          this.apidefs[fullPath][opMethod] = apiOpDef;

          // Create Stats for this API Operation; stats stored separately so only stats can be retrieved
          this.getAPIOpStats(fullPath, opMethod);

          // Create entry in apidetails
          this.getApiOpDetails(fullPath, opMethod);

          // Process parameters for this op
          this.processParameters(pathDef, opDef, fullPath, opMethod);

          this.debug(
            "SWS:Initialize API:added %s %s (%s)",
            op,
            fullPath,
            fullExpressPath,
          );
        }
      }
    }
  }

  // Process parameterss for given operation
  // Take into account parameters defined as common for path (from pathDef)
  private processParameters(
    pathDef,
    opDef,
    path: string,
    method: HTTPMethod,
  ): void {
    const apidetailsEntry = this.getApiOpDetails(path, method);

    // Params from path
    if ("parameters" in pathDef && pathDef.parameters instanceof Array) {
      const pathParams = pathDef.parameters;
      for (let j = 0; j < pathParams.length; j += 1) {
        const param = pathParams[j];
        this.processSingleParameter(apidetailsEntry, param);
      }
    }

    // Params from Op, overriding parameters from path
    if ("parameters" in opDef && opDef.parameters instanceof Array) {
      const opParams = opDef.parameters;
      for (let k = 0; k < opParams.length; k += 1) {
        const param = opParams[k];
        this.processSingleParameter(apidetailsEntry, param);
      }
    }
  }

  private processSingleParameter(apidetailsEntry: ApiDetail, param): void {
    if (!("parameters" in apidetailsEntry)) {
      // eslint-disable-next-line no-param-reassign
      apidetailsEntry.parameters = {};
    }
    const params = apidetailsEntry.parameters;

    const pname = "name" in param ? param.name : null;
    if (pname === null) return;

    if (!(pname in params)) params[pname] = { name: pname };
    const paramEntry = params[pname];

    // Process all supported parameter properties
    // eslint-disable-next-line no-restricted-syntax
    for (const supportedProp of Object.keys(SwsUtil.swsParameterProperties)) {
      if (supportedProp in param) {
        paramEntry[supportedProp] = param[supportedProp];
      }
    }

    // Process all vendor extensions
    // eslint-disable-next-line no-restricted-syntax
    for (const paramProp of Object.keys(param)) {
      if (paramProp.startsWith("x-")) {
        paramEntry[paramProp] = param[paramProp];
      }
    }

    // Add standard stats
    paramEntry.hits = 0;
    paramEntry.misses = 0;
  }

  // Get or create API Operation Details
  private getApiOpDetails(path: string, method: HTTPMethod): ApiDetail {
    if (!(path in this.apidetails)) {
      this.apidetails[path] = {} as ApiDetailsMethod;
    }
    if (!(method in this.apidetails[path]))
      this.apidetails[path][method] = {
        duration: new SwsBucketStats(this.durationBuckets),
        req_size: new SwsBucketStats(this.requestSizeBuckets),
        res_size: new SwsBucketStats(this.responseSizeBuckets),
        code: { 200: { count: 0 } },
      };

    return this.apidetails[path][method];
  }

  // Get or create API Operation Stats
  private getAPIOpStats(path: string, method: HTTPMethod): SwsReqResStats {
    if (!(path in this.apistats)) {
      this.apistats[path] = {} as ApiStatsMethod;
    }
    if (!(method in this.apistats[path]))
      this.apistats[path][method] = new SwsReqResStats(
        this.options!.apdexThreshold,
      );

    return this.apistats[path][method];
  }

  // Update and stats per tick
  public tick(totalElapsedSec: number): void {
    // Update Rates in apistats
    // eslint-disable-next-line no-restricted-syntax
    for (const path of Object.keys(this.apistats)) {
      // eslint-disable-next-line no-restricted-syntax
      for (const method of Object.keys(this.apistats[path])) {
        this.apistats[path][method as HTTPMethod].updateRates(totalElapsedSec);
      }
    }
  }

  // Extract path parameter values based on successful path match results
  private extractPathParams(
    matchResult: any[],
    keys: { name: string }[],
  ): {
    [key: string]: string;
  } {
    const pathParams: { [key: string]: string } = {};
    for (let i = 0; i < keys.length; i += 1) {
      if ("name" in keys[i]) {
        const vidx = i + 1; // first element in match result is URI
        if (vidx < matchResult.length) {
          pathParams[keys[i].name] = SwsUtil.swsStringValue(matchResult[vidx]);
        }
      }
    }

    return pathParams;
  }

  // Try to match request to API to known API definition
  public matchRequest(req: SwsRequest): void {
    let url = req.sws.originalUrl;
    // Handle "/pets" and "/pets/" the same way - #105
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }

    req.sws.match = false; // No match by default

    // Strip query string parameters
    const qidx = url.indexOf("?");
    if (qidx !== -1) {
      url = url.substring(0, qidx);
    }

    let matchEntry;
    let apiPath;
    let apiPathParams;
    let apiInfo;

    // First check if we can find exact match in apiMatchIndex
    if (url in this.apiMatchIndex) {
      matchEntry = this.apiMatchIndex[url];
      apiPath = url;
      this.debug("SWS:MATCH: %s exact match", url);
    } else {
      // if not, search by regex matching
      // eslint-disable-next-line no-restricted-syntax
      for (const swPath of Object.keys(this.apiMatchIndex)) {
        if (!this.apiMatchIndex[swPath].re) {
          // eslint-disable-next-line no-continue
          continue;
        }

        const matchResult = this.apiMatchIndex[swPath].re.exec(url);
        if (matchResult && matchResult instanceof Array) {
          matchEntry = this.apiMatchIndex[swPath];
          apiPath = swPath;
          apiPathParams = this.extractPathParams(
            matchResult,
            this.apiMatchIndex[swPath].keys,
          );
          this.debug("SWS:MATCH: %s matched to %s", url, swPath);
          break; // Done
        }
      }
    }

    if (matchEntry) {
      if (req.method in matchEntry.methods) {
        apiInfo = matchEntry.methods[req.method];

        req.sws.match = true; // Match is found
        req.sws.api_path = apiPath;
        req.sws.swagger = true;

        // When matched, attach only subset of information to request,
        // so we don't overload reqresinfo with repeated description, etc
        if ("deprecated" in apiInfo) req.sws.deprecated = apiInfo.deprecated;
        if ("operationId" in apiInfo) req.sws.operationId = apiInfo.operationId;
        if ("tags" in apiInfo) req.sws.tags = apiInfo.tags;

        // Store path parameters from match result
        if (apiPathParams) req.sws.path_params = apiPathParams;
      }
    }
  }

  // Count Api Operation Parameters Statistics
  // Only count hits and misses
  // Hit: parameter present
  // Miss: mandatory parameter is missing
  // Only supported path and query parameters
  private countParametersStats(
    path: string,
    method: HTTPMethod,
    req: SwsRequest,
  ): void {
    if (!("swagger" in req.sws) || !req.sws.swagger) return; // Only counting for swagger-defined API Ops

    const apiOpDetails = this.getApiOpDetails(path, method);

    if (!("parameters" in apiOpDetails) || !apiOpDetails.parameters) {
      return; // Only counting if parameters spec is there
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const pname of Object.keys(apiOpDetails.parameters)) {
      const param = apiOpDetails.parameters[pname];
      const isRrequired = "required" in param ? param.required : false;

      if ("in" in param) {
        switch (param.in) {
          case "path":
            // Path param is always there, or request will not be matched
            param.hits += 1;
            break;
          case "query":
            if ("query" in req.sws && pname in req.sws.query) {
              param.hits += 1;
            } else if (isRrequired) {
              param.misses += 1;
            }
            break;
          default:
            throw new Error("default case should not be happening");
        }
      }
    }
  }

  // Get Api Operation Parameter Values per specification
  // Only supported path and query parameters
  getApiOpParameterValues(
    path: string,
    method: HTTPMethod,
    req: SwsRequest,
  ): { [key: string]: string } | null {
    if (!("swagger" in req.sws) || !req.sws.swagger) return null; // Only for swagger-defined API Ops

    const apiOpDetails = this.getApiOpDetails(path, method);

    if (!("parameters" in apiOpDetails) || !apiOpDetails.parameters) {
      return null; // Only if parameters spec is there
    }

    const paramValues: { [key: string]: string } = {};

    // eslint-disable-next-line no-restricted-syntax
    for (const pname of Object.keys(apiOpDetails.parameters)) {
      const param = apiOpDetails.parameters[pname];

      if ("in" in param) {
        switch (param.in) {
          case "path":
            if ("path_params" in req.sws && pname in req.sws.path_params) {
              paramValues[pname] = SwsUtil.swsStringValue(
                req.sws.path_params[pname],
              );
            }
            break;

          case "query":
            if ("query" in req.sws && pname in req.sws.query) {
              paramValues[pname] = SwsUtil.swsStringValue(req.sws.query[pname]);
            }
            break;

          default:
            throw new Error("default case should not be happening");
        }
      }
    }
    return paramValues;
  }

  // Count request
  public countRequest(req: SwsRequest): void {
    // Count request if it was matched to API Operation
    if ("match" in req.sws && req.sws.match) {
      const apiOpStats = this.getAPIOpStats(
        req.sws.api_path,
        req.method as HTTPMethod,
      );
      apiOpStats.countRequest(req.sws.req_clength);
      this.countParametersStats(
        req.sws.api_path,
        req.method as HTTPMethod,
        req,
      );
    }
  }

  // Count finished response
  public countResponse(res: SwsResponse): void {
    const req = res._swsReq;
    const codeclass = SwsUtil.getStatusCodeClass(res.statusCode);

    // Only intersted in updating stats here
    const apiOpStats = this.getAPIOpStats(req.sws.api_path, req.method);

    // If request was not matched to API operation,
    // do both count request and count response here,
    // as only at this time we know path so can map request / response to API entry
    // This allows supporting API statistics on non-swagger express route APIs, like /path/:param
    // as express router would attach route.path to request
    if (!("match" in req.sws) || !req.sws.match) {
      apiOpStats.countRequest(req.sws.req_clength);
    }

    // In all cases, count response here
    apiOpStats.countResponse(
      res.statusCode,
      codeclass,
      req.sws.duration,
      req.sws.res_clength,
    );

    // Count metrics
    const apiOpDetails = this.getApiOpDetails(req.sws.api_path, req.method);

    // Metrics by response code
    if (!("code" in apiOpDetails)) {
      apiOpDetails.code = {};
    }

    if (!(res.statusCode in apiOpDetails.code)) {
      apiOpDetails.code[res.statusCode] = { count: 0 };
    }

    apiOpDetails.code[res.statusCode].count += 1;
    apiOpDetails.duration.countValue(req.sws.duration);
    apiOpDetails.req_size.countValue(req.sws.req_clength);
    apiOpDetails.res_size.countValue(req.sws.res_clength);

    // update Prometheus metrics
    (this.promClientMetrics.api_request_total as promClient.Gauge<string>)
      .labels(req.method, req.sws.api_path, res.statusCode.toString())
      .inc();

    (
      this.promClientMetrics.api_request_duration_milliseconds.labels(
        req.method,
        req.sws.api_path,
        res.statusCode.toString(),
      ) as promClient.Histogram<string>
    ).observe(req.sws.duration);
    (
      this.promClientMetrics.api_request_size_bytes.labels(
        req.method,
        req.sws.api_path,
        res.statusCode.toString(),
      ) as promClient.Histogram<string>
    ).observe(req.sws.req_clength);
    (
      this.promClientMetrics.api_response_size_bytes.labels(
        req.method,
        req.sws.api_path,
        res.statusCode.toString(),
      ) as promClient.Histogram<string>
    ).observe(req.sws.res_clength);
  }
}
