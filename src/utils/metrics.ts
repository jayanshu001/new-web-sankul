// src/utils/metrics.ts
//
// Minimal Prometheus-compatible metrics registry. We don't pull `prom-client`
// as a dependency — RED metrics + a handful of gauges are simple enough to
// emit in the text exposition format ourselves.
//
// Exposed via GET /metrics (token-gated; see app.ts). Scrape with Prometheus
// or any compatible agent.
//
// Metric inventory:
//   http_requests_total{method,route,status}      counter
//   http_request_duration_ms{method,route,status} histogram (bucketed)
//   queue_depth{queue,state}                      gauge
//   queue_jobs_dlq_total{queue}                   counter
//   cache_hits_total{domain}                      counter
//   cache_misses_total{domain}                    counter
//
// Label cardinality is bounded by funnelling unknown routes through the
// `normalizeRoute` helper before recording.

type Labels = Record<string, string | number>;

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

// ──────────────────────────────────────────────────────────────────────────────
// Counter
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Gauge
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Histogram (fixed buckets)
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────────

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

export const renderMetrics = (): string => {
  return [
    httpRequestsTotal.render(),
    httpRequestDurationMs.render(),
    queueDepth.render(),
    queueDlqTotal.render(),
    cacheHitsTotal.render(),
    cacheMissesTotal.render(),
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Collapse Express routes with path params to their template form so we
 * don't blow up label cardinality on `/courses/507f1f77...`. Express
 * exposes `req.route.path` for matched routes; we fall back to a coarse
 * normalization for unmatched ones.
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
  // Fallback: replace any segment that looks like an ObjectId / UUID / number.
  const p = req.path || "";
  return p
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
};
