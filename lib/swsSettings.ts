/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* swagger-stats Settings */

import { Request } from "express";
import * as os from "os";

/* swagger=stats settings */
class SwsSettings {
  // Hostname. Will attempt to detect if not explicitly provided
  public hostname = os.hostname();

  // Name. Defaults to hostname if not specified
  public name = this.hostname;

  // Version
  public version = "";

  // IP Address. Will attempt to detect if not provided
  public ip = "";

  // Base path for API described in swagger spec.
  // Specify this when using openapi: "3.0.0" specifications
  // For example, setting basePath='/api' with petrstore spec would match requests /api/pet/{id}, etc ...
  public basePath = "";

  // Base path for swagger-stats internal APIs.
  // If specified, will be used to serve UI, stats and metrics like this:
  // /<uriPath>/ui, /<uriPath>/stats, /<uriPath>/metrics
  // overriding default /swagger-stats/ui
  public uriPath = "/swagger-stats";

  // Buckets for duration histogram metrics, in Milliseconds
  // Optional. Default value:
  // [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  // The default buckets are tailored to broadly measure API response time.
  // Most likely needs to be defined per app to account for application specifics.
  public durationBuckets = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  // Buckets for request size histogram metric, in Bytes.
  // Optional. Default value:
  // [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  // The default buckets are tailored to broadly measure API request size.
  // Most likely needs to be defined per app to account for application specifics.
  public requestSizeBuckets = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  // Buckets for response size histogram metric, in Bytes
  // Optional. Default value:
  // [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  // The default buckets are tailored to broadly measure API response size.
  // Most likely needs to be defined per app to account for application specifics.
  public responseSizeBuckets = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  // Apdex threshold, in milliseconds
  // 25 ms by default
  public apdexThreshold = 25;

  // Callback to invoke when response is finished - https://github.com/slanatech/swagger-stats/issues/5
  // Application may implement it to trace Request Response Record (RRR), which is passed as parameter
  // the following parameters are passed to this callback:
  // onResponseFinish(req,res,rrr)
  // - req - request
  // - res - response
  // - rrr - Request Response Record (RRR)
  public onResponseFinish = null;

  // Enable Basic authentication: true or false. Default false.
  // Basic & custom authentication are supported
  public authentication = false;

  // Enable Your own authentication: a function that takes
  // customAuth(req)
  // - req - request
  // must return true if user authenticated, false if not
  // eg: (req) => { if(req.user.isAdmin) {return true;} else {return false }}
  public customAuth: (req: Request) => boolean;

  // Callback to invoke to authenticate request to /swagger-stats/stats and /swagger-stats/metrics
  // If authentication is enabled (option authentication=true),
  // Application must implement onAuthenticate to validate user credentials
  // the following parameters are passed to this callback:
  // onAuthenticate(req,username,password)
  // - req - request
  // - username - username
  // - password - password
  // callback must return true if user authenticated, false if not
  public onAuthenticate: (
    req: Request,
    username: string,
    password: string,
  ) => boolean;

  // Max Age of the session, if authentication is enabled, in seconds
  // Default is 900 seconds
  public sessionMaxAge = 900;

  // Set to true to track only requests defined in swagger spec. Default false.
  public swaggerOnly = false;

  // Prometheus metrics prefix. Will be prepended to metric name if specified.
  public metricsPrefix = "";

  // Enables Egress HTTP monitoring, true or false. Disabled by default.
  public enableEgress = false;

  private pathUI = "/swagger-stats/ui";

  private pathDist = "/swagger-stats/dist";

  public pathUX = "/swagger-stats/ux";

  public pathStats = "/swagger-stats/stats";

  public pathMetrics = "/swagger-stats/metrics";

  public pathLogout = "/swagger-stats/logout";

  public init(options): void {
    if (typeof options === "undefined" || !options) {
      return;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const op of Object.keys(this)) {
      if (op in options) {
        this[op] = options[op];
      }
    }

    // Set or detect node address
    if (!("ip" in options)) {
      // Attempt to detect network address
      // Use first found interface name which starts from "e" ( en0, em0 ... )
      let address;
      const ifaces = os.networkInterfaces();
      // eslint-disable-next-line no-restricted-syntax
      for (const ifacename of Object.keys(ifaces)) {
        const iface = ifaces[ifacename];
        if (!address && ifacename.charAt(0) === "e") {
          if (iface instanceof Array && iface.length > 0) {
            address = iface[0].address;
          }
        }
      }
      this.ip = address || "127.0.0.1";
    }

    this.pathUI = `${this.uriPath}/ui`;
    this.pathDist = `${this.uriPath}/dist`;
    this.pathUX = `${this.uriPath}/`;
    this.pathStats = `${this.uriPath}/stats`;
    this.pathMetrics = `${this.uriPath}/metrics`;
    this.pathLogout = `${this.uriPath}/logout`;
  }
}

const swsSettings = new SwsSettings();
export = swsSettings;
