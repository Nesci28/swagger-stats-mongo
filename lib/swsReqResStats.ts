/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Request / Response statistics
 */

import { SwsUtil } from "./swsUtil";

// Request / Response statistics
// apdex_threshold: Thresold for apdex calculation, in milliseconds 50 (ms) by default
export class SwsReqResStats {
  private requests = 0; // Total number of requests received

  private responses = 0; // Total number of responses sent

  private errors = 0; // Total number of error responses

  private info = 0; // Total number of informational responses

  private success = 0; // Total number of success responses

  private redirect = 0; // Total number of redirection responses

  private client_error = 0; // Total number of client error responses

  private server_error = 0; // Total number of server error responses

  private total_time = 0; // Sum of total processing time (from request received to response finished)

  private max_time = 0; // Maximum observed processed time

  private avg_time = 0; // Average processing time

  private total_req_clength = 0; // Total (Sum) of Content Lengths of received requests

  private max_req_clength = 0; // Maximum observed Content length in received requests

  private avg_req_clength = 0; // Average Content Length in received requests

  private total_res_clength = 0; // Total (Sum) of Content Lengths of sent responses

  private max_res_clength = 0; // Maximum observed Content Length in sent responses

  private avg_res_clength = 0; // Average Content Length in sent responses

  private req_rate = 0; // Request Rate

  private err_rate = 0; // Error Rate

  private apdex_threshold = Number.isNaN(this.apdexThreshold)
    ? this.apdexThreshold
    : 50; // Apdex threshold

  private apdex_satisfied = 0; // Total number of "satisfied" responses for Apdex: time <= apdex_threshold

  private apdex_tolerated = 0; // Total number of "tolerated" responses for Apdex: time <= (apdex_threshold*4)

  private apdex_score = 0; // Apdex score: (apdex_satisfied + (apdex_tolerated/2))/responses

  constructor(private readonly apdexThreshold: number | undefined) {}

  public countRequest(clength: number): void {
    this.requests += 1;
    console.log("this.requests :>> ", this.requests);
    this.total_req_clength += clength;
    if (this.max_req_clength < clength) this.max_req_clength = clength;
    this.avg_req_clength = Math.floor(this.total_req_clength / this.requests);
  }

  public countResponse(
    code: number,
    codeclass,
    duration: number,
    clength: number,
  ): void {
    this.responses += 1;
    this[codeclass] += 1;
    const isError = SwsUtil.isError(code);
    if (isError) this.errors += 1;
    this.total_time += duration;
    this.avg_time = this.total_time / this.requests;
    if (this.max_time < duration) this.max_time = duration;
    this.total_res_clength += clength;
    if (this.max_res_clength < clength) this.max_res_clength = clength;
    this.avg_res_clength = Math.floor(this.total_res_clength / this.responses);

    // Apdex: https://en.wikipedia.org/wiki/Apdex
    if (codeclass === "success" || codeclass === "redirect") {
      if (duration <= this.apdex_threshold) {
        this.apdex_satisfied += 1;
      } else if (duration <= this.apdex_threshold * 4) {
        this.apdex_tolerated += 1;
      }
    }
    this.apdex_score =
      (this.apdex_satisfied + this.apdex_tolerated / 2) / this.responses;
  }

  public updateRates(elapsed: number): void {
    // this.req_rate = Math.round( (this.requests / elapsed) * 1e2 ) / 1e2; //;
    this.req_rate = this.requests / elapsed;
    this.err_rate = this.errors / elapsed;
  }
}
