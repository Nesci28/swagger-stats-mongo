/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * API Statistics
 */

const { pathToRegexp } = require("path-to-regexp");
const debug = require("debug")("sws:apistats");
const { stringify } = require("qs");
const { isPromiseAlike } = require("q");
const swsSettings = require("./swsSettings.js");
const swsMetrics = require("./swsMetrics.js");
const swsUtil = require("./swsUtil.js");
const SwsReqResStats = require("./swsReqResStats.js");
const SwsBucketStats = require("./swsBucketStats.js");

// API Statistics
// Stores Definition of API based on Swagger Spec
// Stores API Statistics, for both Swagger spec-based API, as well as for detected Express APIs (route.path)
// Stores Detailed Stats for each API request
class SwsAPIStats {
  constructor(swsMongo) {
    this.swsMongo = swsMongo;

    // Options
    this.options = null;

    // API Base path per swagger spec
    this.basePath = "/";

    // Array of possible API path matches, populated based on Swagger spec
    // Contains regex to match URI to Swagger path
    this.apiMatchIndex = {};

    // API definition - entry per API request from swagger spec
    // Stores attributes of known Swagger APIs - description, summary, tags, parameters
    this.apidefs = {};

    // API statistics - entry per API request from swagger
    // Paths not covered by swagger will be added on demand as used
    this.apistats = {};

    // Detailed API stats
    // TODO Consider: individual timelines (?), parameters (query/path?)
    this.apidetails = {};

    // Buckets for histograms, with default bucket values
    this.durationBuckets = [
      5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
    ];
    this.requestSizeBuckets = [
      5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
    ];
    this.responseSizeBuckets = [
      5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
    ];

    // Prometheus metrics in prom-client
    this.promClientMetrics = {};
  }

  getAPIDefs() {
    return this.apidefs;
  }

  getAPIStats() {
    return this.apistats;
  }

  getAPIOperationStats(path, method) {
    if (typeof path === "undefined" || !path || path === "") return {};
    if (typeof method === "undefined" || !method || method === "") return {};

    const res = {};
    res[path] = {};
    res[path][method] = {};

    // api op defs
    if (path in this.apidefs && method in this.apidefs[path]) {
      res[path][method].defs = this.apidefs[path][method];
    }

    // api op stats
    // apistats collection
    // {
    //   path: string;
    //   method: string;
    // }

    if (path in this.apistats && method in this.apistats[path]) {
      res[path][method].stats = this.apistats[path][method];
    }

    // api op details
    // apidetails collection
    // {
    //   path: string;
    //   method: string;
    // }
    if (path in this.apidetails && method in this.apidetails[path]) {
      res[path][method].details = this.apidetails[path][method];
    }

    return res;
  }

  initBasePath(swaggerSpec, swsOptions) {
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
  getFullPath(path) {
    let fullPath = this.basePath;
    if (path.charAt(0) === "/") {
      fullPath += path.substring(1);
    } else {
      fullPath += path;
    }
    return fullPath;
  }

  async initialize(swsOptions) {
    // TODO remove
    if (!swsOptions) return;
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
      const keys = [];
      let re = null;

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
          const opMethod = op.toUpperCase();

          const apiOpDef = {}; // API Operation definition
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
          if (!(fullPath in this.apidefs)) this.apidefs[fullPath] = {};
          this.apidefs[fullPath][opMethod] = apiOpDef;

          // Create Stats for this API Operation; stats stored separately so only stats can be retrieved
          // eslint-disable-next-line no-await-in-loop
          await this.getAPIOpStats(fullPath, opMethod);

          // Create entry in apidetails
          // eslint-disable-next-line no-await-in-loop
          await this.getApiOpDetails(fullPath, opMethod);

          // Process parameters for this op
          // eslint-disable-next-line no-await-in-loop
          await this.processParameters(
            swaggerSpec,
            pathDef,
            opDef,
            fullPath,
            opMethod,
          );

          debug(
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
  async processParameters(swaggerSpec, pathDef, opDef, fullPath, opMethod) {
    const apidetailsEntry = await this.getApiOpDetails(fullPath, opMethod);

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

  processSingleParameter(apidetailsEntry, param) {
    // eslint-disable-next-line no-param-reassign
    if (!("parameters" in apidetailsEntry)) apidetailsEntry.parameters = {};
    const params = apidetailsEntry.parameters;

    const pname = "name" in param ? param.name : null;
    if (pname === null) return;

    if (!(pname in params)) params[pname] = { name: pname };
    const paramEntry = params[pname];

    // Process all supported parameter properties
    // eslint-disable-next-line no-restricted-syntax
    for (const supportedProp of Object.keys(swsUtil.swsParameterProperties)) {
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
  async getApiOpDetails(path, method) {
    // Find or Create the Document
    let document = await this.swsMongo.findDetailsByPathMethod(path, method);
    if (!document) {
      document = this.swsMongo.insertDetails(path, method);
    }

    return document;
  }

  // Get or create API Operation Stats
  async getAPIOpStats(path, method) {
    // Find or Create the Document
    let document = await this.swsMongo.findStatsByPathMethod(path, method);
    if (!document) {
      document = this.swsMongo.insertStats(
        path,
        method,
        this.options.apdexThreshold,
      );
    }

    return document;
  }

  // Update and stats per tick
  async tick(ts, totalElapsedSec) {
    const promises = [];
    // Update Rates in apistats
    // eslint-disable-next-line no-restricted-syntax
    for (const path of Object.keys(this.apistats)) {
      // eslint-disable-next-line no-restricted-syntax
      for (const method of Object.keys(this.apistats[path])) {
        // eslint-disable-next-line no-await-in-loop
        promises.push(this.swsMongo.updateRates(path, method, totalElapsedSec));
      }
    }

    await Promise.all(promises);
  }

  // Extract path parameter values based on successful path match results
  extractPathParams(matchResult, keys) {
    const pathParams = {};
    for (let i = 0; i < keys.length; i += 1) {
      if ("name" in keys[i]) {
        const vidx = i + 1; // first element in match result is URI
        if (vidx < matchResult.length) {
          pathParams[keys[i].name] = swsUtil.swsStringValue(matchResult[vidx]);
        }
      }
    }
    return pathParams;
  }

  // Try to match request to API to known API definition
  matchRequest(req) {
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

    let matchEntry = null;
    let apiPath = null;
    let apiPathParams = null;
    let apiInfo = null;

    // First check if we can find exact match in apiMatchIndex
    if (url in this.apiMatchIndex) {
      matchEntry = this.apiMatchIndex[url];
      apiPath = url;
      debug("SWS:MATCH: %s exact match", url);
    } else {
      // if not, search by regex matching
      // eslint-disable-next-line no-restricted-syntax
      for (const swPath of Object.keys(this.apiMatchIndex)) {
        if (this.apiMatchIndex[swPath].re !== null) {
          const matchResult = this.apiMatchIndex[swPath].re.exec(url);
          if (matchResult && matchResult instanceof Array) {
            matchEntry = this.apiMatchIndex[swPath];
            apiPath = swPath;
            apiPathParams = this.extractPathParams(
              matchResult,
              this.apiMatchIndex[swPath].keys,
            );
            debug("SWS:MATCH: %s matched to %s", url, swPath);
            break; // Done
          }
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
  async countParametersStats(path, method, req) {
    if (!("swagger" in req.sws) || !req.sws.swagger) return; // Only counting for swagger-defined API Ops

    const apiOpDetails = await this.getApiOpDetails(path, method);

    if (!("parameters" in apiOpDetails)) return; // Only counting if parameters spec is there

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
  getApiOpParameterValues(path, method, req) {
    if (!("swagger" in req.sws) || !req.sws.swagger) return null; // Only for swagger-defined API Ops

    const apiOpDetails = this.getApiOpDetails(path, method);

    if (!("parameters" in apiOpDetails)) return null; // Only if parameters spec is there

    const paramValues = {};

    // eslint-disable-next-line no-restricted-syntax
    for (const pname of Object.keys(apiOpDetails.parameters)) {
      const param = apiOpDetails.parameters[pname];

      if ("in" in param) {
        switch (param.in) {
          case "path":
            if ("path_params" in req.sws && pname in req.sws.path_params) {
              paramValues[pname] = swsUtil.swsStringValue(
                req.sws.path_params[pname],
              );
            }
            break;

          case "query":
            if ("query" in req.sws && pname in req.sws.query) {
              paramValues[pname] = swsUtil.swsStringValue(req.sws.query[pname]);
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
  async countRequest(req, res) {
    // Count request if it was matched to API Operation
    if ("match" in req.sws && req.sws.match) {
      const totals = await this.swsMongo.getTotals();

      const increases = {
        request: 1,
        totalReqClength: req.sws.req_clength,
        avgReqClength: Math.floor(
          (totals.total_req_clength + req.sws.req_clength) /
            (totals.requests + 1),
        ),
      };
      const isMaxReqClengthGreate =
        req.sws.req_clength > totals.max_req_clength;
      if (isMaxReqClengthGreate) {
        increases.maxReqClength = req.sws.req_clength;
      }

      await this.swsMongo.setTotals(increases);

      await this.countParametersStats(req.sws.api_path, req.method, req, res);
    }
  }

  // Count finished response
  countResponse(res) {
    const req = res._swsReq;
    const codeclass = swsUtil.getStatusCodeClass(res.statusCode);

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
    this.promClientMetrics.api_request_total
      .labels(req.method, req.sws.api_path, res.statusCode)
      .inc();

    this.promClientMetrics.api_request_duration_milliseconds
      .labels(req.method, req.sws.api_path, res.statusCode)
      .observe(req.sws.duration);
    this.promClientMetrics.api_request_size_bytes
      .labels(req.method, req.sws.api_path, res.statusCode)
      .observe(req.sws.req_clength);
    this.promClientMetrics.api_response_size_bytes
      .labels(req.method, req.sws.api_path, res.statusCode)
      .observe(req.sws.res_clength);
  }
}

module.exports = SwsAPIStats;
