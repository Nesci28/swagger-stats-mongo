/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Request / Response statistics
 */

import Redis from "ioredis";

import { SwsUtil } from "./swsUtil";

// Request / Response statistics
// apdex_threshold: Thresold for apdex calculation, in milliseconds 50 (ms) by default
export class SwsReqResStats {
  constructor(
    private readonly apdexThreshold: number | undefined,
    private readonly redis: Redis,
    private readonly redisKey: string,
  ) {}

  public async init(): Promise<void> {
    await Promise.all([
      this.redis.set(`${this.redisKey}-requests`, 0),
      this.redis.set(`${this.redisKey}-total_req_clength`, 0),
      this.redis.set(`${this.redisKey}-max_req_clength`, 0),
      this.redis.set(`${this.redisKey}-avg_req_clength`, 0),
      this.redis.set(`${this.redisKey}-responses`, 0),
      this.redis.set(`${this.redisKey}-info`, 0),
      this.redis.set(`${this.redisKey}-success`, 0),
      this.redis.set(`${this.redisKey}-redirect`, 0),
      this.redis.set(`${this.redisKey}-client_error`, 0),
      this.redis.set(`${this.redisKey}-server_error`, 0),
      this.redis.set(`${this.redisKey}-errors`, 0),
      this.redis.set(`${this.redisKey}-total_time`, 0),
      this.redis.set(`${this.redisKey}-avg_time`, 0),
      this.redis.set(`${this.redisKey}-max_time`, 0),
      this.redis.set(`${this.redisKey}-total_res_clength`, 0),
      this.redis.set(`${this.redisKey}-max_res_clength`, 0),
      this.redis.set(`${this.redisKey}-avg_res_clength`, 0),
      this.redis.set(
        `${this.redisKey}-apdex_threshold`,
        Number.isNaN(this.apdexThreshold) ? this.apdexThreshold : 50,
      ),
      this.redis.set(`${this.redisKey}-apdex_satisfied`, 0),
      this.redis.set(`${this.redisKey}-apdex_tolerated`, 0),
      this.redis.set(`${this.redisKey}-apdex_score`, 0),
    ]);
  }

  public async getStats(): Promise<any> {
    const results = await Promise.all([
      this.redis.get(`${this.redisKey}-requests`),
      this.redis.get(`${this.redisKey}-total_req_clength`),
      this.redis.get(`${this.redisKey}-max_req_clength`),
      this.redis.get(`${this.redisKey}-avg_req_clength`),
      this.redis.get(`${this.redisKey}-responses`),
      this.redis.get(`${this.redisKey}-info`),
      this.redis.get(`${this.redisKey}-success`),
      this.redis.get(`${this.redisKey}-redirect`),
      this.redis.get(`${this.redisKey}-client_error`),
      this.redis.get(`${this.redisKey}-server_error`),
      this.redis.get(`${this.redisKey}-errors`),
      this.redis.get(`${this.redisKey}-total_time`),
      this.redis.get(`${this.redisKey}-avg_time`),
      this.redis.get(`${this.redisKey}-max_time`),
      this.redis.get(`${this.redisKey}-total_res_clength`),
      this.redis.get(`${this.redisKey}-max_res_clength`),
      this.redis.get(`${this.redisKey}-avg_res_clength`),
      this.redis.get(`${this.redisKey}-apdex_satisfied`),
      this.redis.get(`${this.redisKey}-apdex_tolerated`),
      this.redis.get(`${this.redisKey}-apdex_score`),
      this.redis.get(`${this.redisKey}-req_rate`),
      this.redis.get(`${this.redisKey}-err_rate`),
    ]);

    return {
      requests: +results[0],
      total_req_clength: +results[1],
      max_req_clength: +results[2],
      avg_req_clength: +results[3],
      responses: +results[4],
      info: +results[5],
      success: +results[6],
      redirect: +results[7],
      client_error: +results[8],
      server_error: +results[9],
      errors: +results[10],
      total_time: +results[11],
      avg_time: +results[12],
      max_time: +results[13],
      total_res_clength: +results[14],
      max_res_clength: +results[15],
      avg_res_clength: +results[16],
      apdex_satisfied: +results[17],
      apdex_tolerated: +results[18],
      apdex_score: +results[19],
      req_rate: +results[20],
      err_rate: +results[21],
    };
  }

  public async countRequest(clength: number): Promise<void> {
    const promises: Promise<number | "OK">[] = [];
    promises.push(this.redis.incr(`${this.redisKey}-requests`));

    promises.push(
      this.redis.incrby(`${this.redisKey}-total_req_clength`, clength),
    );

    const [maxReqClength, requests, totalReqClength] = await Promise.all([
      this.redis.get(`${this.redisKey}-max_req_clength`),
      this.redis.get(`${this.redisKey}-requests`),
      this.redis.get(`${this.redisKey}-total_req_clength`),
    ]);

    const isMaxReqClengthSmaller = +maxReqClength < clength;
    if (isMaxReqClengthSmaller) {
      promises.push(
        this.redis.set(`${this.redisKey}-max_req_clength`, clength),
      );
    }

    const avgReqClength = Math.floor(+totalReqClength / (+requests + 1));
    promises.push(
      this.redis.set(`${this.redisKey}-avg_req_clength`, avgReqClength),
    );

    await Promise.all(promises);
  }

  public async countResponse(
    code: number,
    codeclass,
    duration: number,
    clength: number,
  ): Promise<void> {
    const promises: Promise<"OK" | number>[] = [];

    promises.push(this.redis.incr(`${this.redisKey}-responses`));
    promises.push(this.redis.incr(`${this.redisKey}-${codeclass}`));

    const isError = SwsUtil.isError(code);
    if (isError) {
      promises.push(this.redis.incr(`${this.redisKey}-errors`));
    }

    promises.push(this.redis.incrby(`${this.redisKey}-total_time`, duration));

    const [
      totalTime,
      requests,
      maxTime,
      totalResClength,
      maxResClength,
      responses,
      apdexThreshold,
    ] = await Promise.all([
      this.redis.get(`${this.redisKey}-total_time`),
      this.redis.get(`${this.redisKey}-requests`),
      this.redis.get(`${this.redisKey}-max_time`),
      this.redis.get(`${this.redisKey}-total_res_clength`),
      this.redis.get(`${this.redisKey}-max_res_clength`),
      this.redis.get(`${this.redisKey}-responses`),
      this.redis.get(`${this.redisKey}-apdex_threshold`),
    ]);

    const avgTime = +totalTime / +requests;
    promises.push(this.redis.set(`${this.redisKey}-avg_time`, avgTime));

    const isMaxTimeSmaller = +maxTime < duration;
    if (isMaxTimeSmaller) {
      promises.push(this.redis.set(`${this.redisKey}-max_time`, duration));
    }

    promises.push(
      this.redis.incrby(
        `${this.redisKey}-total_res_clength`,
        +totalResClength + clength,
      ),
    );

    const isMaxResClengthSmaller = +maxResClength < clength;
    if (isMaxResClengthSmaller) {
      promises.push(
        this.redis.set(`${this.redisKey}-max_res_clength`, clength),
      );
    }

    const avgResClength = Math.floor((+totalResClength + clength) / +responses);
    promises.push(
      this.redis.set(`${this.redisKey}-avg_res_clength`, avgResClength),
    );

    // Apdex: https://en.wikipedia.org/wiki/Apdex
    if (codeclass === "success" || codeclass === "redirect") {
      if (duration <= +apdexThreshold) {
        promises.push(this.redis.incr(`${this.redisKey}-apdex_satisfied`));
      } else if (duration <= +apdexThreshold * 4) {
        promises.push(this.redis.incr(`${this.redisKey}-apdex_tolerated`));
      }
    }

    const [apdexSatisfied, apdexTolerated] = await Promise.all([
      this.redis.get(`${this.redisKey}-apdex_satisfied`),
      this.redis.get(`${this.redisKey}-apdex_tolerated`),
    ]);

    const apdexScore = (+apdexSatisfied + +apdexTolerated / 2) / +responses;
    promises.push(this.redis.set(`${this.redisKey}-apdex_score`, apdexScore));

    await Promise.all(promises);
  }

  public async updateRates(elapsed: number): Promise<void> {
    // this.req_rate = Math.round( (this.requests / elapsed) * 1e2 ) / 1e2; //;
    const [requests, errors] = await Promise.all([
      this.redis.get(`${this.redisKey}-requests`),
      this.redis.get(`${this.redisKey}-errors`),
    ]);

    const promises: Promise<"OK">[] = [];
    promises.push(
      this.redis.set(`${this.redisKey}-req_rate`, +requests / elapsed),
    );
    promises.push(
      this.redis.set(`${this.redisKey}-err_rate`, +errors / elapsed),
    );

    await Promise.all(promises);
  }
}
