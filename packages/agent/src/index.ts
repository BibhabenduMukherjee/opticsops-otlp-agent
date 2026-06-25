/**
 * @opticsops/agent — Zero-configuration Node.js telemetry
 *
 * Import this package at the top of your service entrypoint to automatically
 * instrument all HTTP traffic with OpenTelemetry and W3C trace context.
 *
 * @packageDocumentation
 */

export { init, shutdown, isInitialized } from './init.js';
export type { OpticsOpsConfig, HeartbeatEdge, ResolvedConfig } from './types.js';
export {
  getActiveTraceStore,
  formatTraceparent,
  traceStore,
} from './context/trace-context.js';

/**
 * Auto-init when OTEL_SERVICE_NAME is set.
 *
 * IMPORTANT: This module must be the first import in your entrypoint so HTTP
 * patches are applied before `node:http` loads. For guaranteed ordering use:
 *
 *   node --import @opticsops/agent/register app.js
 */
import { init as autoInit } from './init.js';

const autoServiceName =
  process.env.OTEL_SERVICE_NAME ?? process.env.OPTICSOPS_SERVICE_NAME;

if (autoServiceName) {
  autoInit({ serviceName: autoServiceName });
}