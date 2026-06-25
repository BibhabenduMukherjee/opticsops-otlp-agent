/**
 * Configuration options for the OpticsOps telemetry agent.
 *
 * All fields can also be set via environment variables (see README).
 */
export interface OpticsOpsConfig {
  /** Logical name of this service (e.g. "checkout-api"). Required. */
  serviceName: string;

  /**
   * OTLP HTTP endpoint for trace export.
   * @default "http://localhost:4318/v1/traces"
   */
  otlpEndpoint?: string;

  /**
   * Requests slower than this threshold (ms) are treated as anomalies
   * and their full trace is exported (tail-based sampling).
   * @default 500
   */
  latencyThresholdMs?: number;

  /**
   * Interval for flushing aggregated heartbeat metrics for healthy traffic.
   * @default 10000
   */
  heartbeatIntervalMs?: number;

  /**
   * Log linked trace chains to stdout — useful for local development
   * and validating cross-service propagation without a collector.
   * @default false (true when NODE_ENV=development)
   */
  enableConsoleLogging?: boolean;
}

/** Resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  serviceName: string;
  otlpEndpoint: string;
  latencyThresholdMs: number;
  heartbeatIntervalMs: number;
  enableConsoleLogging: boolean;
}

/** A single aggregated service-to-service call edge. */
export interface HeartbeatEdge {
  source: string;
  destination: string;
  count: number;
  windowStartMs: number;
}

/** Internal state passed to instrumentation modules during init. */
export interface AgentRuntime {
  config: ResolvedConfig;
  isInitialized: boolean;
}