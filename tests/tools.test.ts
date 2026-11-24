import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { executeHttpTool } from '../server/runtime/tools.ts';
import type { Tool } from '../server/types.ts';

function makeTool(url: string, overrides: Partial<Tool> = {}): Tool {
  return { id: 'tool_test', name: 'get_weather', description: 'Get weather', method: 'GET', url, headers: {}, secretHeaders: {}, parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }, permission: 'auto', enabled: true, timeoutMs: 3000, builtin: false, createdAt: '', updatedAt: '', ...overrides };
}

test('HTTP tools send schema arguments as GET query parameters and template arguments in paths', async (context) => {
  process.env.RELAY_ALLOW_PRIVATE_NETWORK = 'true';
  context.after(() => { delete process.env.RELAY_ALLOW_PRIVATE_NETWORK; });
  const requests: string[] = [];
  const server = createServer((request, response) => { requests.push(request.url ?? ''); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ received: request.url })); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const query = await executeHttpTool(makeTool(`http://127.0.0.1:${port}/weather`), { city: 'London' });
  const path = await executeHttpTool(makeTool(`http://127.0.0.1:${port}/weather/{{city}}`), { city: 'New York' });
  assert.equal((query.data as { received: string }).received, '/weather?city=London', JSON.stringify(query));
  assert.equal((path.data as { received: string }).received, '/weather/New%20York');
  assert.deepEqual(requests, ['/weather?city=London', '/weather/New%20York']);
  const completeTarget = await executeHttpTool(makeTool('{{city}}'), { city: `http://127.0.0.1:${port}/weather?city=New%20York` });
  assert.equal((completeTarget.data as { received: string }).received, '/weather?city=New%20York');
  assert.equal(requests.at(-1), '/weather?city=New%20York');
});

test('HTTP tools reject invalid arguments before making a request', async () => {
  await assert.rejects(() => executeHttpTool(makeTool('http://127.0.0.1:12345/weather'), {}), /Missing required argument/);
});
