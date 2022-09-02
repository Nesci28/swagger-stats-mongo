/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Timeline Statistics
 */
import { Request, Response } from "express";
import Redis from "ioredis";

import { SwsOptions } from "./interfaces/options.interface";
import { SwsReqResStats } from "./swsReqResStats";
import { SwsUtil } from "./swsUtil";

interface GetStats {
  settings: {
    bucket_duration: number;
    bucket_current: number;
    length: number;
  };
  data: {};
}

interface Datas {
  [key: number]: Data;
}

interface Data {
  stats: SwsReqResStats;
  sys: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    cpu: number;
    lag?: number;
  };
}

export class SwsTimeline {
  // Options
  private options: SwsOptions;

  // Timeline Settings
  public settings = {
    bucket_duration: 60000, // Timeline bucket duration in milliseconds
    bucket_current: 0, // Current Timeline bucket ID
    length: 60, // Timeline length - number of buckets to keep
  };

  // Timeline of req / res statistics, one entry per minute for past 60 minutes
  // Hash by timestamp divided by settings.bucket_duration, so we can match finished response to bucket
  private data: Datas = {};

  private startTime = process.hrtime();

  private startUsage = process.cpuUsage();

  // average memory usage values on time interval
  private memorySum = process.memoryUsage();

  private memoryMeasurements = 1;

  // current max event loop lag
  private lag = 0;

  constructor(private readonly redis: Redis) {}

  public getStats(): GetStats {
    const res = { settings: this.settings, data: this.data };
    return res;
  }

  public initialize(swsOptions): void {
    this.options = swsOptions;

    const curr = Date.now();
    if (SwsUtil.supportedOptions.timelineBucketDuration in swsOptions) {
      this.settings.bucket_duration =
        swsOptions[SwsUtil.supportedOptions.timelineBucketDuration];
    }
    let timelineid = Math.floor(curr / this.settings.bucket_duration);
    this.settings.bucket_current = timelineid;
    for (let i = 0; i < this.settings.length; i += 1) {
      this.openTimelineBucket(timelineid);
      timelineid -= 1;
    }
  }

  public tick(ts: number): void {
    const timelineid = Math.floor(ts / this.settings.bucket_duration);
    this.settings.bucket_current = timelineid;

    const currBucket = this.getTimelineBucket(timelineid);
    this.expireTimelineBucket(timelineid - this.settings.length);

    // Update rates in timeline, only in current bucket
    const currBucketElapsedSec =
      (ts - timelineid * this.settings.bucket_duration) / 1000;
    currBucket.stats.updateRates(currBucketElapsedSec);

    // Update sys stats in current bucket
    const cpuPercent = SwsUtil.swsCPUUsagePct(this.startTime, this.startUsage);
    currBucket.sys.cpu = cpuPercent;

    this.updateMemoryUsage(process.memoryUsage());
    this.setMemoryStats(currBucket);
    const start = process.hrtime();
    setImmediate(this.setMaxEvenLoopLag, start, this as any);
  }

  private setMaxEvenLoopLag(
    start: [number, number],
    dest: { lag: number },
  ): void {
    const delta = process.hrtime(start);
    const nanosec = delta[0] * 1e9 + delta[1];
    const mseconds = nanosec / 1e6;
    if (mseconds > dest.lag) {
      // eslint-disable-next-line no-param-reassign
      dest.lag = mseconds;
    }
  }

  private getTimelineBucket(timelineid: number): Data {
    if (timelineid > 0 && !(timelineid in this.data)) {
      // Open new bucket
      this.openTimelineBucket(timelineid);

      // Close previous bucket
      this.closeTimelineBucket(timelineid - 1);
    }
    return this.data[timelineid];
  }

  private openTimelineBucket(timelineid: number): void {
    // Open new bucket
    this.data[timelineid] = {
      stats: new SwsReqResStats(
        this.options?.apdexThreshold,
        this.redis,
        timelineid.toString(),
      ),
      sys: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, cpu: 0 },
    };
  }

  private closeTimelineBucket(timelineid: number): void {
    if (!(timelineid in this.data)) return;

    // Close bucket

    // update rates in previous timeline bucket: it becomes closed
    this.data[timelineid].stats.updateRates(
      this.settings.bucket_duration / 1000,
    );

    // Update sys stats
    const cpuPercent = SwsUtil.swsCPUUsagePct(this.startTime, this.startUsage);
    this.data[timelineid].sys.cpu = cpuPercent;

    // debug('CPU: %s on %d', cpuPercent.toFixed(4), timelineid);

    const currMem = process.memoryUsage();
    this.updateMemoryUsage(currMem);
    this.setMemoryStats(this.data[timelineid]);
    // debug('Mem: %s - CLOSE', this.data[timelineid].sys.heapUsed.toFixed(0));

    // start from last
    this.memorySum = currMem;
    this.memoryMeasurements = 1;
    // debug('Mem: %s - CURR %s - START %d', this.memorySum.heapUsed.toFixed(0),currMem.heapUsed,this.memoryMeasurements);

    // Lag
    this.data[timelineid].sys.lag = this.lag;
    this.lag = 0;

    this.startTime = process.hrtime();
    setImmediate(
      this.setMaxEvenLoopLag,
      this.startTime,
      this.data[timelineid] as any,
    );

    this.startUsage = process.cpuUsage();
  }

  private expireTimelineBucket(timelineid: number): void {
    delete this.data[timelineid];
  }

  private updateMemoryUsage(currMem): void {
    this.memoryMeasurements += 1;
    this.memorySum.rss += currMem.rss;
    this.memorySum.heapTotal += currMem.heapTotal;
    this.memorySum.heapUsed += currMem.heapUsed;
    this.memorySum.external += currMem.external;
    // debug('Mem: %s - CURR %s - UPDATE %d', Math.round(this.memorySum.heapUsed/this.memoryMeasurements),currMem.heapUsed,this.memoryMeasurements);
  }

  private setMemoryStats(bucket): void {
    if (!("sys" in bucket)) return;
    // eslint-disable-next-line no-param-reassign
    bucket.sys.rss = Math.round(this.memorySum.rss / this.memoryMeasurements);
    // eslint-disable-next-line no-param-reassign
    bucket.sys.heapTotal = Math.round(
      this.memorySum.heapTotal / this.memoryMeasurements,
    );
    // eslint-disable-next-line no-param-reassign
    bucket.sys.heapUsed = Math.round(
      this.memorySum.heapUsed / this.memoryMeasurements,
    );
    // eslint-disable-next-line no-param-reassign
    bucket.sys.external = Math.round(
      this.memorySum.external / this.memoryMeasurements,
    );
  }

  public async countRequest(req: Request & { sws: any }): Promise<void> {
    // Count in timeline
    const timelineBucket = this.getTimelineBucket(req.sws.timelineid).stats;
    await timelineBucket.countRequest(req.sws.req_clength);
  }

  public async countResponse(res: Response & { _swsReq: any }): Promise<void> {
    const req = res._swsReq;

    // Update timeline stats
    const timelineBucket = this.getTimelineBucket(req.sws.timelineid).stats;
    await timelineBucket.countResponse(
      res.statusCode,
      SwsUtil.getStatusCodeClass(res.statusCode),
      req.sws.duration,
      req.sws.res_clength,
    );
  }
}
