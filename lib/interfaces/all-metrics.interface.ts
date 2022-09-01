import promClient from "prom-client";

export interface AllMetrics {
  [key: string]:
    | promClient.Counter<string>
    | promClient.Gauge<string>
    | promClient.Histogram<string>;
}
