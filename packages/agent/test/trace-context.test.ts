import { describe, it, expect } from 'vitest';
import {
  formatTraceparent,
  getActiveTraceStore,
  runWithTraceStore,
  traceStore,
} from '../src/context/trace-context.js';

describe('trace-context', () => {
  it('formats a valid W3C traceparent header', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';

    expect(formatTraceparent(traceId, spanId)).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    );
  });

  it('marks unsampled traces with flags=00', () => {
    const tp = formatTraceparent(
      '4bf92f3577b34da6a3ce929d0e0e4736',
      '00f067aa0ba902b7',
      false,
    );
    expect(tp.endsWith('-00')).toBe(true);
  });

  it('stores and retrieves trace metadata via AsyncLocalStorage', () => {
    const store = {
      traceId: 'abc',
      spanId: 'def',
      traceparent: '00-abc-def-01',
    };

    runWithTraceStore(store, () => {
      expect(getActiveTraceStore()).toEqual(store);
    });

    expect(getActiveTraceStore()).toBeUndefined();
  });

  it('isolates concurrent ALS contexts', async () => {
    const results: string[] = [];

    await Promise.all([
      traceStore.run({ traceId: 't1', spanId: 's1', traceparent: '' }, async () => {
        await sleep(10);
        results.push(getActiveTraceStore()!.traceId);
      }),
      traceStore.run({ traceId: 't2', spanId: 's2', traceparent: '' }, async () => {
        results.push(getActiveTraceStore()!.traceId);
      }),
    ]);

    expect(results).toContain('t1');
    expect(results).toContain('t2');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}