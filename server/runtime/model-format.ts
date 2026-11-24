import type { ModelMessage } from './providers.ts';

export function chatPayload(messages: ModelMessage[]): unknown[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
  }));
}

export function responsesInput(messages: ModelMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      continue;
    }
    if (message.content) input.push({ role: message.role, content: message.content });
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>) {
        input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
    }
  }
  return input;
}
