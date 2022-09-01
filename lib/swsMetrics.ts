/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* swagger=stats Prometheus metrics */
import promClient from "prom-client";

import { AllMetrics } from "./interfaces/all-metrics.interface";

interface MetricConfig {
  name: string;
  help: string;
  labelName?: string;
  labelNames?: string[];
  buckets?: number[];
}

interface MetricDefs {
  [key: string]: MetricDef;
}

interface MetricDef {
  help: string;
  type: string;
  labelNames?: string[];
  buckets?: number[];
}

/* swagger=stats Prometheus metrics */
class SwsMetrics {
  // Core API Metrics
  public coreMetricsDefs = {
    api_all_request_total: {
      type: "counter",
      help: "The total number of all API requests received",
    },
    api_all_success_total: {
      type: "counter",
      help: "The total number of all API requests with success response",
    },
    api_all_errors_total: {
      type: "counter",
      help: "The total number of all API requests with error response",
    },
    api_all_client_error_total: {
      type: "counter",
      help: "The total number of all API requests with client error response",
    },
    api_all_server_error_total: {
      type: "counter",
      help: "The total number of all API requests with server error response",
    },
    api_all_request_in_processing_total: {
      type: "gauge",
      help: "The total number of all API requests currently in processing (no response yet)",
    },
  };

  // System metrics for node process
  public systemMetricsDefs = {
    nodejs_process_memory_rss_bytes: {
      type: "gauge",
      help: "Node.js process resident memory (RSS) bytes ",
    },
    nodejs_process_memory_heap_total_bytes: {
      type: "gauge",
      help: "Node.js process memory heapTotal bytes",
    },
    nodejs_process_memory_heap_used_bytes: {
      type: "gauge",
      help: "Node.js process memory heapUsed bytes",
    },
    nodejs_process_memory_external_bytes: {
      type: "gauge",
      help: "Node.js process memory external bytes",
    },
    nodejs_process_cpu_usage_percentage: {
      type: "gauge",
      help: "Node.js process CPU usage percentage",
    },
  };

  public apiMetricsDefs = {
    // API Operation counters, labeled with method, path and code
    api_request_total: {
      type: "counter",
      help: "The total number of all API requests",
      labelNames: ["method", "path", "code"],
    },

    // API request duration histogram, labeled with method, path and code
    api_request_duration_milliseconds: {
      type: "histogram",
      help: "API requests duration",
      labelNames: ["method", "path", "code"],
      buckets: [] as number[],
    },

    // API request size histogram, labeled with method, path and code
    api_request_size_bytes: {
      type: "histogram",
      help: "API requests size",
      labelNames: ["method", "path", "code"],
      buckets: [] as number[],
    },

    // API response size histogram, labeled with method, path and code
    api_response_size_bytes: {
      type: "histogram",
      help: "API requests size",
      labelNames: ["method", "path", "code"],
      buckets: [] as number[],
    },
  };

  // Create Prometheus metrics based on passed definition
  public getPrometheusMetrics(
    prefix: string,
    metricDefs: MetricDefs,
  ): AllMetrics {
    const allMetrics: AllMetrics = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const metricId of Object.keys(metricDefs)) {
      const metricDef = metricDefs[metricId];
      let metric;
      const metricConfig: MetricConfig = {
        name: prefix + metricId,
        help: metricDef.help,
      };
      if ("labelNames" in metricDef) {
        metricConfig.labelNames = metricDef.labelNames;
      }
      if ("buckets" in metricDef) {
        metricConfig.buckets = metricDef.buckets;
      }
      switch (metricDef.type) {
        case "counter": {
          metric = new promClient.Counter(metricConfig);
          break;
        }
        case "gauge": {
          metric = new promClient.Gauge(metricConfig);
          break;
        }
        case "histogram": {
          metric = new promClient.Histogram(metricConfig);
          break;
        }
        default:
          throw new Error("default case should not be happening");
      }
      allMetrics[metricId] = metric;
    }
    return allMetrics;
  }

  public clearPrometheusMetrics(metrics): void {
    // eslint-disable-next-line no-restricted-syntax
    for (const metricId of Object.keys(metrics)) {
      const metric = metrics[metricId];
      promClient.register.removeSingleMetric(metric.name);
      // eslint-disable-next-line no-param-reassign
      delete metrics[metricId];
    }
  }
}

const swsMetrics = new SwsMetrics();
export default swsMetrics;
