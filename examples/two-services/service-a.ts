/**
 * Service A — gateway that calls Service B.
 *
 * Run:  OTEL_SERVICE_NAME=service-a OPTICSOPS_CONSOLE_LOGGING=true npx tsx service-a.ts
 */
import '@opticsops/agent/register';
import { getActiveTraceStore } from '@opticsops/agent';
import http from 'node:http';

const PORT = Number(process.env.PORT_A ?? 4000);
const B_PORT = Number(process.env.PORT_B ?? 4001);

const server = http.createServer((req, res) => {
  const traceparent = getActiveTraceStore()?.traceparent;
  console.log(`[service-a] incoming ${req.method} ${req.url} traceparent=${traceparent ?? 'none'}`);

  const fail = req.url?.includes('fail');
  const path = fail ? '/fail' : '/api';

  const bReq = http.request(
    { hostname: '127.0.0.1', port: B_PORT, path, method: 'GET' },
    (bRes) => {
      let body = '';
      bRes.on('data', (chunk) => { body += chunk; });
      bRes.on('end', () => {
        res.writeHead(bRes.statusCode === 200 ? 200 : 502, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ service: 'a', upstream: JSON.parse(body || '{}') }));
      });
    },
  );

  bReq.on('error', (err) => {
    res.writeHead(503);
    res.end(JSON.stringify({ error: err.message }));
  });

  bReq.end();
});

server.listen(PORT, () => {
  console.log(`[service-a] listening on http://localhost:${PORT}`);
  console.log(`[service-a] try: curl http://localhost:${PORT}/hello`);
  console.log(`[service-a] anomaly: curl http://localhost:${PORT}/fail`);
});