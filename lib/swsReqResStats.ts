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

  constructor(
    private readonly apdexThreshold: number | undefined,
    private readonly redis: Redis,
    private readonly redisKey: string,
  ) {}

  public async countRequest(clength: number): Promise<void> {
    try {
      const promises: Promise<"OK">[] = [];
      this.requests += 1;
      promises.push(
        this.redis.set(`${this.redisKey}-requests`, this.requests.toString()),
      );

      this.total_req_clength += clength;
      promises.push(
        this.redis.set(
          `${this.redisKey}-total_req_clength`,
          this.total_req_clength.toString(),
        ),
      );

      if (this.max_req_clength < clength) {
        this.max_req_clength = clength;
        promises.push(
          this.redis.set(
            `${this.redisKey}-max_req_clength`,
            this.max_req_clength.toString(),
          ),
        );
      }

      this.avg_req_clength = Math.floor(this.total_req_clength / this.requests);
      promises.push(
        this.redis.set(
          `${this.redisKey}-avg_req_clength`,
          this.avg_req_clength.toString(),
        ),
      );

      await Promise.all(promises);
    } catch (err) {
      console.log("err :>> ", err);
    }
  }

  public async countResponse(
    code: number,
    codeclass,
    duration: number,
    clength: number,
  ): Promise<void> {
    try {
      const promises: Promise<"OK">[] = [];

      this.responses += 1;
      promises.push(
        this.redis.set(`${this.redisKey}-responses`, this.responses.toString()),
      );

      this[codeclass] += 1;
      promises.push(
        this.redis.set(
          `${this.redisKey}-${codeclass}`,
          this[codeclass].toString(),
        ),
      );

      const isError = SwsUtil.isError(code);
      if (isError) {
        this.errors += 1;
        promises.push(
          this.redis.set(`${this.redisKey}-errors`, this.errors.toString()),
        );
      }

      this.total_time += duration;
      promises.push(
        this.redis.set(
          `${this.redisKey}-total_time`,
          this.total_time.toString(),
        ),
      );

      this.avg_time = this.total_time / this.requests;
      promises.push(
        this.redis.set(`${this.redisKey}-avg_time`, this.avg_time.toString()),
      );

      if (this.max_time < duration) {
        this.max_time = duration;
        promises.push(
          this.redis.set(`${this.redisKey}-max_time`, this.max_time.toString()),
        );
      }

      this.total_res_clength += clength;
      promises.push(
        this.redis.set(
          `${this.redisKey}-total_res_clength`,
          this.total_res_clength.toString(),
        ),
      );

      if (this.max_res_clength < clength) {
        this.max_res_clength = clength;
        promises.push(
          this.redis.set(
            `${this.redisKey}-max_res_clength`,
            this.max_res_clength.toString(),
          ),
        );
      }

      this.avg_res_clength = Math.floor(
        this.total_res_clength / this.responses,
      );
      promises.push(
        this.redis.set(
          `${this.redisKey}-avg_res_clength`,
          this.avg_res_clength.toString(),
        ),
      );

      // Apdex: https://en.wikipedia.org/wiki/Apdex
      if (codeclass === "success" || codeclass === "redirect") {
        if (duration <= this.apdex_threshold) {
          this.apdex_satisfied += 1;
          promises.push(
            this.redis.set(
              `${this.redisKey}-apdex_satisfied`,
              this.apdex_satisfied.toString(),
            ),
          );
        } else if (duration <= this.apdex_threshold * 4) {
          this.apdex_tolerated += 1;
          promises.push(
            this.redis.set(
              `${this.redisKey}-apdex_tolerated`,
              this.apdex_tolerated.toString(),
            ),
          );
        }
      }
      this.apdex_score =
        (this.apdex_satisfied + this.apdex_tolerated / 2) / this.responses;
      promises.push(
        this.redis.set(
          `${this.redisKey}-apdex_score`,
          this.apdex_score.toString(),
        ),
      );

      await Promise.all(promises);
    } catch (err) {
      console.log("err :>> ", err);
    }
  }

  public async updateRates(elapsed: number): Promise<void> {
    // this.req_rate = Math.round( (this.requests / elapsed) * 1e2 ) / 1e2; //;
    const promises: Promise<"OK">[] = [];
    this.req_rate = this.requests / elapsed;
    promises.push(this.redis.set(`${this.redisKey}-req_rate`, this.req_rate));
    this.err_rate = this.errors / elapsed;
    promises.push(this.redis.set(`${this.redisKey}-err_rate`, this.err_rate));

    await Promise.all(promises);
  }
}
