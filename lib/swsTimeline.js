/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Timeline Statistics
 */

const swsUtil = require("./swsUtil.js");
const SwsReqResStats = require("./swsReqResStats.js");

class SwsTimeline {
  constructor() {
    // Options
    this.options = null;

    // Timeline Settings
    this.settings = {
      bucket_duration: 60000, // Timeline bucket duration in milliseconds
      bucket_current: 0, // Current Timeline bucket ID
      length: 60, // Timeline length - number of buckets to keep
    };

    // Timeline of req / res statistics, one entry per minute for past 60 minutes
    // Hash by timestamp divided by settings.bucket_duration, so we can match finished response to bucket
    this.data = {};

    this.startTime = process.hrtime();
    this.startUsage = process.cpuUsage();

    // average memory usage values on time interval
    this.memorySum = process.memoryUsage();
    this.memoryMeasurements = 1;

    // current max event loop lag
    this.lag = 0;
  }

  getStats() {
    return { settings: this.settings, data: this.data };
  }

  initialize(swsOptions) {
    this.options = swsOptions;

    const curr = Date.now();
    if (swsUtil.supportedOptions.timelineBucketDuration in swsOptions) {
      this.settings.bucket_duration =
        swsOptions[swsUtil.supportedOptions.timelineBucketDuration];
    }
    let timelineid = Math.floor(curr / this.settings.bucket_duration);
    this.settings.bucket_current = timelineid;
    for (let i = 0; i < this.settings.length; i += 1) {
      this.openTimelineBucket(timelineid);
      timelineid -= 1;
    }
  }

  tick(ts) {
    const timelineid = Math.floor(ts / this.settings.bucket_duration);
    this.settings.bucket_current = timelineid;

    const currBucket = this.getTimelineBucket(timelineid);
    this.expireTimelineBucket(timelineid - this.settings.length);

    // Update rates in timeline, only in current bucket
    const currBucketElapsedSec =
      (ts - timelineid * this.settings.bucket_duration) / 1000;
    currBucket.stats.updateRates(currBucketElapsedSec);

    // Update sys stats in current bucket
    const cpuPercent = swsUtil.swsCPUUsagePct(this.startTime, this.startUsage);
    currBucket.sys.cpu = cpuPercent;

    this.updateMemoryUsage(process.memoryUsage());
    this.setMemoryStats(currBucket);
    const start = process.hrtime();
    setImmediate(this.setMaxEvenLoopLag, start, this);
  }

  setMaxEvenLoopLag(start, dest) {
    const delta = process.hrtime(start);
    const nanosec = delta[0] * 1e9 + delta[1];
    const mseconds = nanosec / 1e6;
    if (mseconds > dest.lag) {
      // eslint-disable-next-line no-param-reassign
      dest.lag = mseconds;
    }
  }

  getTimelineBucket(timelineid) {
    if (timelineid > 0 && !(timelineid in this.data)) {
      // Open new bucket
      this.openTimelineBucket(timelineid);

      // Close previous bucket
      this.closeTimelineBucket(timelineid - 1);
    }
    return this.data[timelineid];
  }

  openTimelineBucket(timelineid) {
    // Open new bucket
    this.data[timelineid] = {
      stats: new SwsReqResStats(this.options.apdexThreshold),
      sys: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, cpu: 0 },
    };
  }

  closeTimelineBucket(timelineid) {
    if (!(timelineid in this.data)) return;

    // Close bucket

    // update rates in previous timeline bucket: it becomes closed
    this.data[timelineid].stats.updateRates(
      this.settings.bucket_duration / 1000,
    );

    // Update sys stats
    const cpuPercent = swsUtil.swsCPUUsagePct(this.startTime, this.startUsage);
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
    setImmediate(this.setMaxEvenLoopLag, this.startTime, this.data[timelineid]);

    this.startUsage = process.cpuUsage();
  }

  expireTimelineBucket(timelineid) {
    delete this.data[timelineid];
  }

  updateMemoryUsage(currMem) {
    this.memoryMeasurements += 1;
    this.memorySum.rss += currMem.rss;
    this.memorySum.heapTotal += currMem.heapTotal;
    this.memorySum.heapUsed += currMem.heapUsed;
    this.memorySum.external += currMem.external;
    // debug('Mem: %s - CURR %s - UPDATE %d', Math.round(this.memorySum.heapUsed/this.memoryMeasurements),currMem.heapUsed,this.memoryMeasurements);
  }

  setMemoryStats(bucket) {
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

  countRequest(req) {
    // Count in timeline
    this.getTimelineBucket(req.sws.timelineid).stats.countRequest(
      req.sws.req_clength,
    );
  }

  countResponse(res) {
    const req = res._swsReq;

    // Update timeline stats
    this.getTimelineBucket(req.sws.timelineid).stats.countResponse(
      res.statusCode,
      swsUtil.getStatusCodeClass(res.statusCode),
      req.sws.duration,
      req.sws.res_clength,
    );
  }
}

module.exports = SwsTimeline;
