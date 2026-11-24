import type { ChatMessage, ModelReply, Provider, Tool } from '../types.ts';
import { errorMessage } from '../lib/ids.ts';
import { chatPayload, responsesInput } from './model-format.ts';

export type ModelMessage = Pick<ChatMessage, 'role' | 'content' | 'toolName' | 'toolCallId' | 'toolCalls'>;
export type ModelTool = Pick<Tool, 'name' | 'description' | 'parameters'>;
type ConfiguredProvider = Provider & { apiKey: string };

export interface CompleteOptions {
  provider: ConfiguredProvider;
  messages: ModelMessage[];
  tools: ModelTool[];
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
}

async function fetchProvider(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(90_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try { response = await fetch(url, { ...init, signal: combined }); }
  catch (error) { throw new Error(`Could not reach the model provider: ${errorMessage(error)}`); }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 3000);
    throw new Error(`Model provider returned ${response.status}: ${body || response.statusText}`);
  }
  return response;
}

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith(path) ? base : `${base}${path}`;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return typeof value === 'object' && value ? value as Record<string, unknown> : {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch { throw new Error('The model returned invalid tool arguments.'); }
}

async function completeChat(options: CompleteOptions): Promise<ModelReply> {
  const { provider, messages, tools, signal } = options;
  const response = await fetchProvider(endpoint(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      messages: chatPayload(messages),
      ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
      temperature: provider.temperature,
      max_tokens: provider.maxTokens,
      stream: Boolean(options.onTextDelta),
      parallel_tool_calls: false,
    }),
  }, signal);
  if (!options.onTextDelta || !(response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
    const data = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }>; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('The provider response did not contain a message.');
    return {
      content: typeof message.content === 'string' ? message.content : message.content?.map((part) => part.text ?? '').join('') ?? '',
      toolCalls: (message.tool_calls ?? []).map((call) => ({ id: call.id, name: call.function.name, arguments: parseArguments(call.function.arguments) })),
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    };
  }
  const contentParts: string[] = [];
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let usage = { inputTokens: 0, outputTokens: 0 };
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The provider did not return a stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  const processLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let event: any;
    try { event = JSON.parse(payload); } catch { return; }
    const choice = event.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.content === 'string') { contentParts.push(delta.content); options.onTextDelta?.(delta.content); }
    else if (Array.isArray(delta?.content)) for (const part of delta.content) if (typeof part?.text === 'string') { contentParts.push(part.text); options.onTextDelta?.(part.text); }
    for (const call of delta?.tool_calls ?? []) {
      const current = calls.get(call.index) ?? { id: call.id ?? `call_${call.index}`, name: call.function?.name ?? '', arguments: '' };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name = call.function.name;
      if (call.function?.arguments) current.arguments += call.function.arguments;
      calls.set(call.index, current);
    }
    if (event.usage) usage = { inputTokens: event.usage.prompt_tokens ?? 0, outputTokens: event.usage.completion_tokens ?? 0 };
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line.trim());
    }
    if (buffer.trim()) processLine(buffer.trim());
  } finally { reader.releaseLock(); }
  return { content: contentParts.join(''), toolCalls: [...calls.values()].map((call) => ({ id: call.id, name: call.name, arguments: parseArguments(call.arguments) })), usage };
}

async function completeResponses(options: CompleteOptions): Promise<ModelReply> {
  const { provider, messages, tools, signal } = options;
  const response = await fetchProvider(endpoint(provider.baseUrl, '/responses'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      input: responsesInput(messages),
      ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })) } : {}),
      temperature: provider.temperature,
      max_output_tokens: provider.maxTokens,
      parallel_tool_calls: false,
    }),
  }, signal);
  const data = await response.json() as { output?: Array<{ type: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ type: string; text?: string }> }>; output_text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  const output = data.output ?? [];
  return {
    content: data.output_text ?? output.filter((item) => item.type === 'message').flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text' || item.type === 'text').map((item) => item.text ?? '').join(''),
    toolCalls: output.filter((item) => item.type === 'function_call').map((item) => ({ id: item.call_id ?? '', name: item.name ?? '', arguments: parseArguments(item.arguments) })),
    usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
  };
}

function demoReply(options: CompleteOptions): ModelReply {
  const last = options.messages.at(-1);
  if (last?.role === 'tool') {
    return { content: `The demo tool returned a result. I can see the tool response, but this local demo does not generate AI analysis.\n\nConnect an LLM provider in **Settings → Model providers** and assign it to this bot to turn tool results into a real answer.`, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }
  const userMessage = [...options.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  if (options.tools.length) {
    const lower = userMessage.toLowerCase();
    const tool = options.tools.find((candidate) => `${candidate.name} ${candidate.description}`.toLowerCase().split(/\W+/).some((word) => word.length > 4 && lower.includes(word)));
    if (tool) {
      const args: Record<string, unknown> = {};
      const properties = (tool.parameters.properties ?? {}) as Record<string, { default?: unknown }>;
      for (const [key, definition] of Object.entries(properties)) if (definition.default !== undefined) args[key] = definition.default;
      return { content: '', toolCalls: [{ id: `demo_${Date.now()}`, name: tool.name, arguments: args }], usage: { inputTokens: 0, outputTokens: 0 } };
    }
  }
  const subject = userMessage.length > 220 ? `${userMessage.slice(0, 220)}…` : userMessage;
  return {
    content: `I’ve noted your request: **“${subject}”**\n\nI’m running in **local demo mode**, so I haven’t called an AI model or fetched external information. To get a real response:\n\n1. Open **Settings → Model providers**.\n2. Add your xAI, OpenAI, or compatible API key.\n3. Open my bot settings and select that provider.\n\nYou can also connect REST APIs under **Connections**. I’ll keep your conversation and working context here while you set things up.`,
    toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export async function completeModel(options: CompleteOptions): Promise<ModelReply> {
  if (options.provider.kind === 'demo') return demoReply(options);
  if (options.provider.kind === 'bedrock') {
    const { completeBedrock } = await import('./bedrock.ts');
    return completeBedrock(options);
  }
  if (!options.provider.apiKey) throw new Error(`Add an API key to “${options.provider.name}” before using this provider.`);
  return options.provider.apiStyle === 'responses' ? completeResponses(options) : completeChat(options);
}
