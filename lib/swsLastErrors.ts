/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Last Errors
 */

import safeStringify from "fast-safe-stringify";
import Redis from "ioredis";

import { RequestResponseRecord } from "./interfaces/request-response-record.interface";
import { SwsUtil } from "./swsUtil";

export class SwsLastErrors {
  private last_errors: any[] = [];

  constructor(private readonly redis: Redis) {}

  public async getStats(): Promise<any[]> {
    const result = await this.redis.get("last_errors");
    const parsed = JSON.parse(result);
    return parsed;
  }

  public async init(): Promise<void> {
    await this.redis.set("last_errors", safeStringify([]));
  }

  // Add information about last error
  public async addError(rrr: RequestResponseRecord): Promise<void> {
    const errors = await this.getStats();
    errors.push(rrr);
    await this.redis.set("last_errors", safeStringify(errors));
  }

  // Check if this qualifies as longest request, and store is yes
  public async processReqResData(rrr: RequestResponseRecord): Promise<void> {
    if (SwsUtil.isError(+rrr.http.response.code)) {
      await this.addError(rrr);
    }
  }
}
