// Metrics: minimal Prometheus text-format registry (no prom-client dependency), served at
// token-gated GET /metrics. Route labels go through `normalizeRoute` to keep
// cardinality bounded.

import { monitorEventLoopDelay } from "node:perf_hooks";

type Labels = Record<string, string | number>;

const PID = String(process.pid);
const INSTANCE = process.env.INSTANCE_ID ?? process.env.pm_id ?? PID;
const PROCESS_LABELS: Labels = { pid: PID, instance: INSTANCE };

const labelsKey = (labels: Labels): string =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(",");

const formatLabels = (labels: Labels): string => {
  const entries = Object.entries(labels);
  if (!entries.length) return "";
  return `{${entries
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
    .join(",")}}`;
};

class Counter {
  private values = new Map<string, { labels: Labels; value: number }>();

  constructor(public readonly name: string, public readonly help: string) {}

  inc(labels: Labels = {}, by = 1): void {
    const k = labelsKey(labels);
    const existing = this.values.get(k);
    if (existing) existing.value += by;
    else this.values.set(k, { labels, value: by });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

class Gauge {
  private values = new Map<string, { labels: Labels; value: number }>();

  constructor(public readonly name: string, public readonly help: string) {}

  set(value: number, labels: Labels = {}): void {
    this.values.set(labelsKey(labels), { labels, value });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

const DEFAULT_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

class Histogram {
  private buckets = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly bucketBounds: number[] = DEFAULT_BUCKETS_MS
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const k = labelsKey(labels);
    let entry = this.buckets.get(k);
    if (!entry) {
      entry = {
        labels,
        counts: new Array(this.bucketBounds.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.buckets.set(k, entry);
    }
    for (let i = 0; i < this.bucketBounds.length; i++) {
      if (value <= this.bucketBounds[i]) entry.counts[i] += 1;
    }
    entry.sum += value;
    entry.count += 1;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.buckets.values()) {
      for (let i = 0; i < this.bucketBounds.length; i++) {
        const le = this.bucketBounds[i];
        lines.push(
          `${this.name}_bucket${formatLabels({ ...labels, le })} ${counts[i]}`
        );
      }
      lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: "+Inf" })} ${count}`);
      lines.push(`${this.name}_sum${formatLabels(labels)} ${sum}`);
      lines.push(`${this.name}_count${formatLabels(labels)} ${count}`);
    }
    return lines.join("\n");
  }
}

export const httpRequestsTotal = new Counter(
  "http_requests_total",
  "Total HTTP requests, labelled by method, route, and status."
);

export const httpRequestDurationMs = new Histogram(
  "http_request_duration_ms",
  "HTTP request duration in milliseconds, labelled by method, route, status."
);

export const queueDepth = new Gauge(
  "queue_depth",
  "Current depth of a BullMQ queue, labelled by queue and state (waiting/active/delayed/failed)."
);

export const queueDlqTotal = new Counter(
  "queue_jobs_dlq_total",
  "Total jobs that exhausted all retries and were sent to the DLQ."
);

export const cacheHitsTotal = new Counter(
  "cache_hits_total",
  "Cache hits via cache.aside, labelled by domain."
);

export const cacheMissesTotal = new Counter(
  "cache_misses_total",
  "Cache misses via cache.aside (loader invoked), labelled by domain."
);

// Process-level gauges, sampled in renderMetrics() at scrape time.

export const processResidentMemoryBytes = new Gauge(
  "process_resident_memory_bytes",
  "Resident set size (RSS) of the Node process in bytes, labelled by pid and instance."
);

export const nodejsHeapUsedBytes = new Gauge(
  "nodejs_heap_used_bytes",
  "V8 heap used in bytes, labelled by pid and instance."
);

export const nodejsHeapTotalBytes = new Gauge(
  "nodejs_heap_total_bytes",
  "V8 heap total (allocated) in bytes, labelled by pid and instance."
);

export const nodejsEventLoopLagSeconds = new Gauge(
  "nodejs_eventloop_lag_seconds",
  "Mean event-loop lag in seconds since the previous scrape, labelled by pid and instance."
);

// Reset each scrape so the mean covers the interval since the last scrape, not the process lifetime.
const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
eventLoopDelay.enable();

const sampleProcessMetrics = (): void => {
  const mem = process.memoryUsage();
  processResidentMemoryBytes.set(mem.rss, PROCESS_LABELS);
  nodejsHeapUsedBytes.set(mem.heapUsed, PROCESS_LABELS);
  nodejsHeapTotalBytes.set(mem.heapTotal, PROCESS_LABELS);

  // `mean` is in ns and NaN before the first sample.
  const meanNs = eventLoopDelay.mean;
  nodejsEventLoopLagSeconds.set(
    Number.isFinite(meanNs) ? meanNs / 1e9 : 0,
    PROCESS_LABELS
  );
  eventLoopDelay.reset();
};

export const renderMetrics = (): string => {
  sampleProcessMetrics();
  return [
    httpRequestsTotal.render(),
    httpRequestDurationMs.render(),
    queueDepth.render(),
    queueDlqTotal.render(),
    cacheHitsTotal.render(),
    cacheMissesTotal.render(),
    processResidentMemoryBytes.render(),
    nodejsHeapUsedBytes.render(),
    nodejsHeapTotalBytes.render(),
    nodejsEventLoopLagSeconds.render(),
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Route template for the metric label (bounds cardinality). Uses `req.route.path`
 * when matched, else replaces id-like path segments.
 */
export const normalizeRoute = (req: {
  baseUrl?: string;
  route?: { path?: string };
  path?: string;
}): string => {
  const tpl = req.route?.path;
  if (tpl) {
    const base = req.baseUrl || "";
    return `${base}${tpl}`;
  }
  const p = req.path || "";
  return p
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
};
