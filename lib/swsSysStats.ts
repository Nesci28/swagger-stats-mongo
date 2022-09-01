/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * API usage statistics data
 */
import promClient from "prom-client";

import { AllMetrics } from "./interfaces/all-metrics.interface";
import { CpuUsage } from "./interfaces/cpu-usage.interface";
import { Sys } from "./interfaces/sys.interface";
import swsMetrics from "./swsMetrics";
import swsSettings from "./swsSettings";
import { SwsUtil } from "./swsUtil";
/* swagger=stats Prometheus metrics */
export class SwsSysStats {
  // System statistics
  private sys: Sys;

  // CPU
  private startTime: [number, number];

  private startUsage: CpuUsage;

  // Array with last 5 hrtime / cpuusage, to calculate CPU usage during the last second sliding window ( 5 ticks )
  private startTimeAndUsage;

  // Prometheus metrics
  private promClientMetrics: AllMetrics = {};

  public initialize(): void {
    // System statistics
    this.sys = {
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      cpu: 0,
      lag: 0,
      maxlag: 0,
    };

    // CPU
    this.startTime = process.hrtime();
    this.startUsage = process.cpuUsage();

    // Array with last 5 hrtime / cpuusage, to calculate CPU usage during the last second sliding window ( 5 ticks )
    this.startTimeAndUsage = [
      { hrtime: process.hrtime(), cpuUsage: process.cpuUsage() },
      { hrtime: process.hrtime(), cpuUsage: process.cpuUsage() },
      { hrtime: process.hrtime(), cpuUsage: process.cpuUsage() },
      { hrtime: process.hrtime(), cpuUsage: process.cpuUsage() },
      { hrtime: process.hrtime(), cpuUsage: process.cpuUsage() },
    ];

    this.promClientMetrics = swsMetrics.getPrometheusMetrics(
      swsSettings.metricsPrefix,
      swsMetrics.systemMetricsDefs,
    );
  }

  setEventLoopLag(start: [number, number], sys: Sys): void {
    const delta = process.hrtime(start);
    const nanosec = delta[0] * 1e9 + delta[1];
    const mseconds = nanosec / 1e6;
    // eslint-disable-next-line no-param-reassign
    sys.lag = mseconds;
    if (mseconds > sys.maxlag) {
      // eslint-disable-next-line no-param-reassign
      sys.maxlag = mseconds;
    }
  }

  public getStats(): Sys {
    return this.sys;
  }

  public tick(): void {
    // System stats
    this.calculateSystemStats();
  }

  // Calculate and store system statistics
  private calculateSystemStats(): void {
    // Memory
    const memUsage = process.memoryUsage();

    // See https://stackoverflow.com/questions/12023359/what-do-the-return-values-of-node-js-process-memoryusage-stand-for
    // #22 Handle properly if any property is missing
    this.sys.rss = "rss" in memUsage ? memUsage.rss : 0;
    this.sys.heapTotal = "heapTotal" in memUsage ? memUsage.heapTotal : 0;
    this.sys.heapUsed = "heapUsed" in memUsage ? memUsage.heapUsed : 0;
    this.sys.external = "external" in memUsage ? memUsage.external : 0;

    const startTU = this.startTimeAndUsage.shift();

    const cpuPercent = SwsUtil.swsCPUUsagePct(startTU.hrtime, startTU.cpuUsage);

    const startTime = process.hrtime();
    setImmediate(this.setEventLoopLag, startTime, this.sys);

    const startUsage = process.cpuUsage();
    this.startTimeAndUsage.push({ hrtime: startTime, cpuUsage: startUsage });

    this.sys.cpu = cpuPercent;

    // Update prom-client metrics
    (
      this.promClientMetrics
        .nodejs_process_memory_rss_bytes as promClient.Gauge<string>
    ).set(this.sys.rss);
    (
      this.promClientMetrics
        .nodejs_process_memory_heap_total_bytes as promClient.Gauge<string>
    ).set(this.sys.heapTotal);
    (
      this.promClientMetrics
        .nodejs_process_memory_heap_used_bytes as promClient.Gauge<string>
    ).set(this.sys.heapUsed);
    (
      this.promClientMetrics
        .nodejs_process_memory_external_bytes as promClient.Gauge<string>
    ).set(this.sys.external);
    (
      this.promClientMetrics
        .nodejs_process_cpu_usage_percentage as promClient.Gauge<string>
    ).set(this.sys.cpu);
  }
}
