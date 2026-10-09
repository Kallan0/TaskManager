import { monitorEventLoopDelay } from 'node:perf_hooks';
import mongoose from 'mongoose';
const samples = new Map<
  string,
  { count: number; errors: number; latencies: number[] }
>();
export function observe(operation: string, status: number, ms: number) {
  const row = samples.get(operation) ?? { count: 0, errors: 0, latencies: [] };
  row.count++;
  if (status >= 500) row.errors++;
  if (row.latencies.length < 1000) row.latencies.push(ms);
  samples.set(operation, row);
}
export function startMetrics() {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const timer = setInterval(() => {
    const operations = [...samples].map(([operation, row]) => {
      const sorted = row.latencies.sort((a, b) => a - b);
      return {
        operation,
        count: row.count,
        errors: row.errors,
        sampledRequests: sorted.length,
        p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      };
    });
    console.info(
      JSON.stringify({
        event: 'runtime_metrics',
        operations,
        rssBytes: process.memoryUsage().rss,
        eventLoopP95Ms: Math.round(loop.percentile(95) / 1e6),
        databaseConnected: mongoose.connection.readyState === 1,
      }),
    );
    samples.clear();
    loop.reset();
  }, 30000).unref();
  return () => {
    clearInterval(timer);
    loop.disable();
  };
}
