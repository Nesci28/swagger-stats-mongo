/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Errors stats
 */
import { Response } from "express";

import { StatusCodeCount } from "./interfaces/status-code-count.interface";
import { SwsUtil } from "./swsUtil";

interface StatsResponse {
  statuscode: StatusCodeCount;
  topnotfound: {
    [key: string]: number;
  };
  topservererror: {
    [key: string]: number;
  };
}

export class SwsErrors {
  // Store counts per each error code
  private statuscode_count: StatusCodeCount = {};

  // Store Top not found path
  private top_not_found: { [key: string]: number } = {};

  // Store Top server error path
  private top_server_error: { [key: string]: number } = {};

  public getStats(): StatsResponse {
    const res = {
      statuscode: this.statuscode_count,
      topnotfound: this.top_not_found,
      topservererror: this.top_server_error,
    };
    return res;
  }

  // Add information about error
  public countResponse(res: Response & { _swsReq: any }): void {
    if (!SwsUtil.isError(res.statusCode)) return;

    // Increase count by code
    if (!(res.statusCode in this.statuscode_count)) {
      this.statuscode_count[res.statusCode] = 0;
    }
    this.statuscode_count[res.statusCode] += 1;

    if (res.statusCode === 404) {
      this.countPathHit(res._swsReq.sws.originalUrl, this.top_not_found);
    } else if (res.statusCode === 500) {
      this.countPathHit(res._swsReq.sws.originalUrl, this.top_server_error);
    }
  }

  // Check if this qualifies as longest request, and store is yes
  private countPathHit(path: string, store: Record<string, number>): void {
    if (!(path in store)) {
      // eslint-disable-next-line no-param-reassign
      store[path] = 0;
    }
    // eslint-disable-next-line no-param-reassign
    store[path] += 1;
  }
}
