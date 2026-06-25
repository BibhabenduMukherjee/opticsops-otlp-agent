import type { OpticsOpsConfig, ResolvedConfig } from './types.js';

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
const DEFAULT_LATENCY_THRESHOLD_MS = 500;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Merges user config, environment variables, and sensible defaults.
 *
 * Environment variable mapping:
 * - OTEL_SERVICE_NAME / OPTICSOPS_SERVICE_NAME → serviceName
 * - OTEL_EXPORTER_OTLP_ENDPOINT → otlpEndpoint (appends /v1/traces if needed)
 * - OPTICSOPS_LATENCY_THRESHOLD_MS → latencyThresholdMs
 * - OPTICSOPS_HEARTBEAT_INTERVAL_MS → heartbeatIntervalMs
 * - OPTICSOPS_CONSOLE_LOGGING=true → enableConsoleLogging
 */
export function resolveConfig(partial: OpticsOpsConfig): ResolvedConfig {
  const serviceName =
    partial.serviceName ??
    process.env.OTEL_SERVICE_NAME ??
    process.env.OPTICSOPS_SERVICE_NAME;

  if (!serviceName) {
    throw new Error(
      'OpticsOps agent requires a serviceName. Pass it to init() or set OTEL_SERVICE_NAME.',
    );
  }

  const rawEndpoint =
    partial.otlpEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    DEFAULT_OTLP_ENDPOINT;

  const otlpEndpoint = rawEndpoint.endsWith('/v1/traces')
    ? rawEndpoint
    : `${rawEndpoint.replace(/\/$/, '')}/v1/traces`;



  const enableConsoleLogging =
    partial.enableConsoleLogging ??
    (process.env.OPTICSOPS_CONSOLE_LOGGING === 'true' ||
      process.env.NODE_ENV === 'development');

  return {
    serviceName,
    otlpEndpoint,
    latencyThresholdMs:
      partial.latencyThresholdMs ??
      (Number(process.env.OPTICSOPS_LATENCY_THRESHOLD_MS) || DEFAULT_LATENCY_THRESHOLD_MS),
    heartbeatIntervalMs:
      partial.heartbeatIntervalMs ??
      (Number(process.env.OPTICSOPS_HEARTBEAT_INTERVAL_MS) || DEFAULT_HEARTBEAT_INTERVAL_MS),
    enableConsoleLogging,
  };
}