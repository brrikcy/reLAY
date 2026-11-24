import test from 'node:test';
import assert from 'node:assert/strict';
import { bedrockMessages, getBedrockClient } from '../server/runtime/bedrock.ts';
import type { Provider } from '../server/types.ts';

const conversation = [
  { role: 'system' as const, content: 'Be concise.' },
  { role: 'user' as const, content: 'Check London.' },
  { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"London"}' } }] },
  { role: 'tool' as const, content: '{"status":200,"data":{"temperature":18}}', toolCallId: 'call_1', toolName: 'get_weather' },
  { role: 'assistant' as const, content: 'London is 18°C.' },
];

test('Bedrock converter maps system, assistant tool use, and user tool result correctly', () => {
  const { system, messages } = bedrockMessages(conversation);
  assert.deepEqual(system, [{ text: 'Be concise.' }]);
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[1].content?.[0].toolUse, { toolUseId: 'call_1', name: 'get_weather', input: { city: 'London' } });
  assert.equal(messages[2].role, 'user');
  assert.equal(messages[2].content?.[0].toolResult?.toolUseId, 'call_1');
  assert.equal(messages[2].content?.[0].toolResult?.status, 'success');
});

test('Bedrock client uses explicit region and AWS profile without storing credentials', () => {
  const provider = { awsRegion: 'us-east-1', awsProfile: 'bedrock' } as Provider;
  const client = getBedrockClient(provider);
  assert.equal(client, getBedrockClient(provider));
  const alternate = getBedrockClient({ ...provider, awsRegion: 'us-west-2' });
  assert.notEqual(client, alternate);
});
