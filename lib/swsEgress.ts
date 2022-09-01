/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* swagger=stats egress http monitor */

import Debug from "debug";
import http from "http";

import { SwsRequest } from "./interfaces/request.interface";
import swsSettings from "./swsSettings";

/* swagger=stats egress http monitor */
class SwsEgress {
  private debug = Debug("sws:egress");

  private originalRequest: (
    options: string | http.RequestOptions | URL,
    callback?: ((res: http.IncomingMessage) => void) | undefined,
  ) => http.ClientRequest;

  public init(): void {
    // Process Options
    if (swsSettings.enableEgress) {
      this.enableEgressMonitoring();
    }
  }

  private enableEgressMonitoring(): void {
    this.originalRequest = http.request;
    http.request = wrapMethodRequest;
  }

  public handleRequest(req: SwsRequest): void {
    // const h = req.getHeader("host");
    const h = req.headers.host;
    this.debug(`Got request: ${req.method} ${h} ${req.path}`);
    req.once("response", (res) => {
      this.debug(
        `Got response to request: ${res.statusCode} ${res.statusMessage}`,
      );
      // Consume response object
    });
  }
}

const swsEgress = new SwsEgress();
export default swsEgress;

export function wrapMethodRequest(...args): http.ClientRequest {
  // eslint-disable-next-line prefer-spread
  const req = (this as any).originalRequest.apply(this, args);
  swsEgress.handleRequest(req);
  return req;
}
