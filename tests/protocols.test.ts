import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { completeModel } from '../server/runtime/providers.ts';
import { chatPayload, responsesInput } from '../server/runtime/model-format.ts';
import type { ModelMessage } from '../server/runtime/providers.ts';
import type { Provider } from '../server/types.ts';

const conversation: ModelMessage[] = [
  { role: 'system', content: 'You are a test assistant.' },
  { role: 'user', content: 'What is the weather?' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"London"}' } }] },
  { role: 'tool', content: '{"temperature":18}', toolName: 'get_weather', toolCallId: 'call_1' },
];

function provider(port: number, style: 'chat' | 'responses'): Provider & { apiKey: string } {
  return { id: 'test', name: 'Mock', kind: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, apiStyle: style, model: 'mock', temperature: 0, maxSteps: 5, maxTokens: 2048, awsRegion: 'us-east-1', awsProfile: '', hasApiKey: true, keyHint: '', createdAt: '', updatedAt: '', apiKey: 'secret' };
}

test('Chat Completions payload includes tool call and matching result', () => {
  const payload = chatPayload(conversation) as Array<Record<string, unknown>>;
  assert.deepEqual(payload[2].tool_calls, conversation[2].toolCalls);
  assert.equal(payload[3].role, 'tool');
  assert.equal(payload[3].tool_call_id, 'call_1');
});

test('Responses payload converts history into typed function calls and outputs', () => {
  const payload = responsesInput(conversation) as Array<Record<string, unknown>>;
  assert.deepEqual(payload[2], { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"London"}' });
  assert.deepEqual(payload[3], { type: 'function_call_output', call_id: 'call_1', output: '{"temperature":18}' });
});

test('Responses adapter sends function schemas and parses tool calls and final text', async (context) => {
  const bodies: any[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (bodies.length === 1) response.end(JSON.stringify({ output: [{ type: 'function_call', call_id: 'call_weather', name: 'get_weather', arguments: '{"city":"London"}' }], usage: { input_tokens: 11, output_tokens: 5 } }));
      else response.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'London is 18°C.' }] }], usage: { input_tokens: 20, output_tokens: 7 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const tools = [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }];
  const first = await completeModel({ provider: provider(port, 'responses'), messages: conversation.slice(0, 2), tools });
  assert.equal(first.toolCalls[0].name, 'get_weather');
  assert.deepEqual(first.toolCalls[0].arguments, { city: 'London' });
  assert.equal(bodies[0].tools[0].type, 'function');
  assert.equal(bodies[0].tools[0].name, 'get_weather');
  assert.equal(bodies[0].tools[0].function, undefined);
  const second = await completeModel({ provider: provider(port, 'responses'), messages: conversation, tools });
  assert.equal(second.content, 'London is 18°C.');
  assert.equal(second.usage.inputTokens, 20);
  assert.deepEqual(bodies[1].input.at(-1), { type: 'function_call_output', call_id: 'call_1', output: '{"temperature":18}' });
});

test('Chat Completions streams real text deltas and accumulates tool call fragments', async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Lon"}}]}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"world","tool_calls":[{"index":0,"function":{"arguments":"don\\"}"}}]}}],"usage":{"prompt_tokens":12,"completion_tokens":7}}\n\n');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const deltas: string[] = [];
  const result = await completeModel({ provider: provider(port, 'chat'), messages: conversation.slice(0, 2), tools: [], onTextDelta: (text) => deltas.push(text) });
  assert.deepEqual(deltas, ['Hello ', 'world']);
  assert.equal(result.content, 'Hello world');
  assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'get_weather', arguments: { city: 'London' } }]);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7 });
});

test('Chat adapter parses provider tool calls', async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"London"}' } }] } }], usage: { prompt_tokens: 4, completion_tokens: 3 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const result = await completeModel({ provider: provider(port, 'chat'), messages: conversation.slice(0, 2), tools: [] });
  assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'get_weather', arguments: { city: 'London' } }]);
});
