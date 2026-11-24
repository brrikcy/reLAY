import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ContentBlock, Message, Tool as BedrockTool, ToolResultBlock } from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
import { errorMessage } from '../lib/ids.ts';
import type { ModelReply, Provider } from '../types.ts';
import type { CompleteOptions, ModelMessage } from './providers.ts';

const clients = new Map<string, BedrockRuntimeClient>();

export function getBedrockClient(provider: Provider): BedrockRuntimeClient {
  const region = provider.awsRegion || process.env.AWS_REGION || 'us-east-1';
  const profile = provider.awsProfile;
  const key = `${region}:${profile}`;
  let client = clients.get(key);
  if (!client) {
    client = new BedrockRuntimeClient({ region, ...(profile ? { profile } : {}), maxAttempts: 4, retryMode: 'adaptive' });
    clients.set(key, client);
  }
  return client;
}

export function bedrockMessages(messages: ModelMessage[]): { system: Array<{ text: string }>; messages: Message[] } {
  const system = messages.filter((message) => message.role === 'system').map((message) => ({ text: message.content }));
  const result: Message[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const block: ToolResultBlock = { toolUseId: message.toolCallId, content: [{ text: message.content }], status: message.content.includes('"error"') ? 'error' : 'success' };
      const previous = result.at(-1);
      if (previous?.role === 'user' && previous.content?.some((block) => block.toolResult)) previous.content.push({ toolResult: block });
      else result.push({ role: 'user', content: [{ toolResult: block }] });
      continue;
    }
    const content: ContentBlock[] = [];
    if (message.content) content.push({ text: message.content });
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>) {
        let input: DocumentType = {};
        try { input = JSON.parse(call.function.arguments) as DocumentType; } catch { /* Preserve the original malformed tool call for the provider to handle. */ }
        content.push({ toolUse: { toolUseId: call.id, name: call.function.name, input } });
      }
    }
    if (content.length) result.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return { system, messages: result };
}

function bedrockError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  const message = errorMessage(error);
  if (/ExpiredToken|UnrecognizedClient|SSO|CredentialsProviderError|could not load credentials/i.test(`${name} ${message}`)) return new Error('AWS credentials are missing or expired. Refresh your AWS SSO session, then retry. Relay uses the standard AWS credential chain and does not store AWS keys.');
  if (name === 'AccessDeniedException') return new Error('AWS denied Bedrock access. Check this role’s bedrock:InvokeModel permission and model access in the selected region.');
  if (name === 'ResourceNotFoundException') return new Error('The selected model is not available in this AWS region. DeepSeek V3.2 requires in-region model ID deepseek.v3.2.');
  if (name === 'ValidationException') return new Error(`Bedrock rejected the request: ${message}`);
  if (name === 'ThrottlingException') return new Error('Bedrock throttled the request. Retry shortly, lower the output token limit, or review your model quota.');
  return new Error(`Bedrock request failed${name ? ` (${name})` : ''}: ${message}`);
}

export async function completeBedrock(options: CompleteOptions): Promise<ModelReply> {
  const { provider, messages, tools, signal } = options;
  const client = getBedrockClient(provider);
  const { system, messages: converseMessages } = bedrockMessages(messages);
  const bedrockTools: BedrockTool[] = tools.map((tool) => ({ toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: tool.parameters as DocumentType } } }));
  const timeout = AbortSignal.timeout(120_000);
  try {
    if (options.onTextDelta) {
      const response = await client.send(new ConverseStreamCommand({
        modelId: provider.model,
        system,
        messages: converseMessages,
        inferenceConfig: { maxTokens: provider.maxTokens, temperature: provider.temperature },
        ...(bedrockTools.length ? { toolConfig: { tools: bedrockTools, toolChoice: { auto: {} } } } : {}),
      }), { abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      const contentParts: string[] = [];
      const calls = new Map<number, { id: string; name: string; arguments: Record<string, unknown> }>();
      let usage = { inputTokens: 0, outputTokens: 0 };
      if (response.stream) {
        for await (const event of response.stream) {
          if (event.contentBlockDelta?.delta?.text) { contentParts.push(event.contentBlockDelta.delta.text); options.onTextDelta(event.contentBlockDelta.delta.text); }
          if (event.contentBlockStart?.start?.toolUse) {
            const tool = event.contentBlockStart.start.toolUse;
            calls.set(event.contentBlockStart.contentBlockIndex ?? calls.size, { id: tool.toolUseId ?? '', name: tool.name ?? '', arguments: {} });
          }
          if (event.contentBlockDelta?.delta?.toolUse) {
            const index = event.contentBlockDelta.contentBlockIndex ?? 0;
            const current = calls.get(index) ?? { id: '', name: '', arguments: {} };
            const partial = event.contentBlockDelta.delta.toolUse as { input?: unknown };
            try { if (partial.input) current.arguments = JSON.parse(String(partial.input)) as Record<string, unknown>; } catch { /* Bedrock can send partial tool JSON; retain no partial call. */ }
            calls.set(index, current);
          }
          if (event.metadata?.usage) usage = { inputTokens: event.metadata.usage.inputTokens ?? 0, outputTokens: event.metadata.usage.outputTokens ?? 0 };
        }
      }
      return { content: contentParts.join(''), toolCalls: [...calls.values()], usage };
    }
    const response = await client.send(new ConverseCommand({
      modelId: provider.model,
      system,
      messages: converseMessages,
      inferenceConfig: { maxTokens: provider.maxTokens, temperature: provider.temperature },
      ...(bedrockTools.length ? { toolConfig: { tools: bedrockTools, toolChoice: { auto: {} } } } : {}),
    }), { abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const blocks = response.output?.message?.content ?? [];
    return {
      content: blocks.flatMap((block) => block.text ? [block.text] : []).join('\n'),
      toolCalls: blocks.flatMap((block) => block.toolUse ? [{ id: block.toolUse.toolUseId ?? '', name: block.toolUse.name ?? '', arguments: block.toolUse.input && typeof block.toolUse.input === 'object' && !Array.isArray(block.toolUse.input) ? block.toolUse.input as Record<string, unknown> : {} }] : []),
      usage: { inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 },
    };
  } catch (error) { throw bedrockError(error); }
}
