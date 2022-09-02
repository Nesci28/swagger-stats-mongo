/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import Redis from "ioredis";

import { SwsOptions } from "./interfaces/options.interface";

export class SwsRedis {
  public redis: Redis;

  constructor(options: SwsOptions) {
    const { redisHost, redisPort } = options;
    if (!redisHost || !redisPort) {
      throw new Error("Missing Swagger-Stats variables");
    }
    this.redis = new Redis({
      port: redisPort,
      host: redisHost,
    });
  }
}
