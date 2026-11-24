import { z } from 'zod';

const shortText = (max: number) => z.string().trim().min(1).max(max);
const objectSchema = z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }).refine((schema) => schema.type === 'object' && (!schema.properties || (typeof schema.properties === 'object' && !Array.isArray(schema.properties))), 'Parameters must use a JSON Schema object with named properties.');

export const botInput = z.object({
  name: shortText(60),
  role: shortText(100),
  description: z.string().trim().max(240).default(''),
  instructions: shortText(12_000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ee6c45'),
  providerId: shortText(80).default('demo'),
  toolIds: z.array(shortText(80)).max(30).default([]),
});

export const providerInput = z.object({
  name: shortText(80),
  kind: z.enum(['openai', 'xai', 'custom', 'bedrock']),
  baseUrl: z.string().max(500).refine((value) => value === '' || URL.canParse(value), 'Enter a valid base URL.'),
  apiStyle: z.enum(['chat', 'responses', 'converse']).default('chat'),
  model: shortText(160),
  temperature: z.number().min(0).max(2).default(0.2),
  maxSteps: z.number().int().min(1).max(20).default(8),
  maxTokens: z.number().int().min(64).max(8192).default(2048),
  awsRegion: z.string().regex(/^[a-z]{2}(-gov)?-[a-z]+-\d$/).or(z.literal('')).default('us-east-1'),
  awsProfile: z.string().max(120).regex(/^$|^[a-zA-Z0-9_.@-]+$/).default(''),
  apiKey: z.string().max(2000).optional(),
});

const headers = z.record(z.string(), z.string().max(4000)).default({});
export const toolInput = z.object({
  name: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/, 'Use letters, numbers, underscores, or hyphens.'),
  description: shortText(1000),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().trim().min(8).max(2000),
  headers,
  secretHeaders: headers,
  parameters: objectSchema,
  permission: z.enum(['auto', 'approval', 'deny']).default('approval'),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
});

export const memoryInput = z.object({
  content: shortText(2000),
  category: z.enum(['preference', 'fact', 'rule', 'work_log']).default('fact'),
  source: z.enum(['user', 'manual', 'run']).default('manual'),
});

export const routineInput = z.object({
  name: shortText(100),
  instruction: shortText(5000),
  intervalMinutes: z.number().int().min(5).max(525_600),
  triggerType: z.enum(['interval', 'webhook', 'daily']).default('interval'),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a valid daily time in HH:MM format.').default('09:00'),
  timezone: z.string().trim().min(1).max(80).default('UTC').refine((value) => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } }, 'Enter a valid IANA timezone.'),
  enabled: z.boolean().default(false),
});
