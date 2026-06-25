/**
 * Service B — downstream API.
 *
 * Run:  OTEL_SERVICE_NAME=service-b OPTICSOPS_CONSOLE_LOGGING=true npx tsx service-b.ts
 */
import '@opticsops/agent/register';
import http from 'node:http';

const PORT = Number(process.env.PORT_B ?? 4001);

const server = http.createServer((req, res) => {
  // Simulate occasional upstream failures to trigger tail-based export.
  const fail = req.url?.includes('fail');
  if (fail) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'simulated failure' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'b', message: 'hello from B' }));
});

server.listen(PORT, () => {
  console.log(`[service-b] listening on http://localhost:${PORT}`);
});