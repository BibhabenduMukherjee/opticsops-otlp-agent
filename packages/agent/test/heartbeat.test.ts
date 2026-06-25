import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatAggregator } from '../src/metrics/heartbeat.js';
import type { HeartbeatEdge, ResolvedConfig } from '../src/types.js';

const config: ResolvedConfig = {
  serviceName: 'service-a',
  otlpEndpoint: 'http://localhost:4318/v1/traces',
  latencyThresholdMs: 500,
  heartbeatIntervalMs: 100,
  enableConsoleLogging: false,
};

describe('HeartbeatAggregator', () => {
  let flushed: HeartbeatEdge[][];

  beforeEach(() => {
    flushed = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates call counts by source→destination pair', () => {
    const agg = new HeartbeatAggregator(config, (edges) => flushed.push(edges));

    agg.record('service-a', 'http://localhost:4001/');
    agg.record('service-a', 'http://localhost:4001/');
    agg.record('service-a', 'http://localhost:4002/');

    const snap = agg.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.find((e) => e.destination.includes('4001'))?.count).toBe(2);
    expect(snap.find((e) => e.destination.includes('4002'))?.count).toBe(1);
  });

  it('flushes on interval and clears counters', () => {
    const agg = new HeartbeatAggregator(config, (edges) => flushed.push(edges));
    agg.start();

    agg.record('service-a', 'service-b');
    vi.advanceTimersByTime(100);

    expect(flushed).toHaveLength(1);
    expect(flushed[0][0]).toMatchObject({ source: 'service-a', destination: 'service-b', count: 1 });

    vi.advanceTimersByTime(100);
    expect(flushed).toHaveLength(1); // nothing new to flush

    agg.stop();
  });
});