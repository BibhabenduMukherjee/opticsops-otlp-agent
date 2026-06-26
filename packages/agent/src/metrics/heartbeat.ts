import type { HeartbeatEdge, ResolvedConfig } from '../types.js';

/**
 * Aggregates healthy (fast, 2xx/3xx) service-to-service calls into periodic
 * heartbeat summaries instead of exporting full traces.
 *
 * This is the primary cost-control mechanism from the MVP plan:
 * "Service A called Service B 500 times" every N seconds.
 */
export class HeartbeatAggregator {
  /** source → destination → call count in the current window */
  private readonly counts = new Map<string, Map<string, number>>();
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private windowStartMs = Date.now();
  private readonly onFlush: (edges: HeartbeatEdge[]) => void;

  constructor(
    private readonly config: ResolvedConfig,
    onFlush: (edges: HeartbeatEdge[]) => void = defaultHeartbeatLogger,
  ) {
    this.onFlush = onFlush;
  }

  /** Record a successful outbound call from source to destination. */
  record(source: string, destination: string): void {
    let destMap = this.counts.get(source);
    if (!destMap) {
      destMap = new Map();
      this.counts.set(source, destMap);
    }
    destMap.set(destination, (destMap.get(destination) ?? 0) + 1);
  }

  /** Begin periodic flushing. Called once during agent init. */
  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.flush(), this.config.heartbeatIntervalMs);
    // Allow the Node process to exit even if the interval is still active.
    this.intervalHandle.unref();
  }

  /** Flush immediately and stop the interval (used during shutdown). */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.flush();
  }

  /** @internal Returns a snapshot without clearing — for tests. */
  snapshot(): HeartbeatEdge[] {
    return this.toEdges();
  }

  private flush(): void {
    const edges = this.toEdges();
    if (edges.length > 0) {
      this.onFlush(edges);
    }
    this.counts.clear();
    this.windowStartMs = Date.now();
  }

  private toEdges(): HeartbeatEdge[] {
    const edges: HeartbeatEdge[] = [];
    for (const [source, destMap] of this.counts) {
      for (const [destination, count] of destMap) {
        edges.push({ source, destination, count, windowStartMs: this.windowStartMs });
      }
    }
    return edges;
  }
}

function defaultHeartbeatLogger(edges: HeartbeatEdge[]): void {
  const summary = edges
    .map((e) => `${e.source} → ${e.destination}: ${e.count} calls`)
    .join(', ');

  console.log(`[opticsops] 💓 Heartbeat (${edges[0]?.windowStartMs ?? Date.now()}): ${summary}`);
}