/**
 * Preload entrypoint for zero-config instrumentation.
 *
 * Load this module BEFORE any `node:http` import so monkey-patches apply
 * to both ESM and CommonJS consumers:
 *
 *   node --import @opticsops/agent/register app.js
 *
 * @packageDocumentation
 */
import { init } from './init.js';

const serviceName =
  process.env.OTEL_SERVICE_NAME ?? process.env.OPTICSOPS_SERVICE_NAME;

if (serviceName) {
  init({ serviceName });
} else {
  console.warn(
    '[opticsops] register loaded but OTEL_SERVICE_NAME is not set. ' +
      'Set the env var or call init({ serviceName }) manually.',
  );
}