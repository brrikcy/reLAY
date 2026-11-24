export type BotStatus = 'idle' | 'working' | 'waiting' | 'error';
export type RunStatus = 'running' | 'completed' | 'waiting' | 'failed' | 'cancelled';
export type RoutineTrigger = 'interval' | 'webhook' | 'daily';
export type ToolPermission = 'auto' | 'approval' | 'deny';
export type ProviderKind = 'demo' | 'openai' | 'xai' | 'custom' | 'bedrock';
export type ApiStyle = 'chat' | 'responses' | 'converse';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Bot {
  id: string;
  name: string;
  role: string;
  description: string;
  instructions: string;
  color: string;
  providerId: string;
  toolIds: string[];
  status: BotStatus;
  createdAt: string;
  updatedAt: string;
  groupMembers?: Array<{ id: string; name: string; role: string }>;
}

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiStyle: ApiStyle;
  model: string;
  temperature: number;
  maxSteps: number;
  maxTokens: number;
  awsRegion: string;
  awsProfile: string;
  hasApiKey: boolean;
  keyHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  secretHeaders: Record<string, string>;
  parameters: Record<string, unknown>;
  permission: ToolPermission;
  enabled: boolean;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  builtin: boolean;
}

export interface Memory {
  id: string;
  botId: string;
  content: string;
  category: 'preference' | 'fact' | 'rule' | 'work_log';
  source: 'user' | 'manual' | 'run';
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  botId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  attachments?: Attachment[];
  toolName?: string;
  toolCallId?: string;
  toolCalls?: unknown;
  runId?: string;
  source: 'chat' | 'routine' | 'handoff' | 'demo';
  replyTo?: string;
  reactions?: Record<string, number>;
  editedAt?: string;
  deletedAt?: string;
  pinnedAt?: string;
  createdAt: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  type: 'started' | 'model' | 'tool_requested' | 'tool_completed' | 'approval_requested' | 'approval_resolved' | 'completed' | 'failed' | 'cancelled';
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Approval {
  id: string;
  runId: string;
  botId: string;
  toolCallId: string;
  toolName: string;
  toolId: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  resolvedAt?: string;
}

export interface Run {
  id: string;
  botId: string;
  status: RunStatus;
  input: string;
  output: string;
  source: 'chat' | 'routine' | 'handoff';
  routineId?: string;
  groupId?: string;
  handoffDepth: number;
  steps: number;
  modelCalls: number;
  toolCalls: number;
  usage: { inputTokens: number; outputTokens: number };
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface Routine {
  id: string;
  botId: string;
  name: string;
  instruction: string;
  intervalMinutes: number;
  enabled: boolean;
  triggerType: RoutineTrigger;
  hasWebhookKey: boolean;
  timezone: string;
  dailyTime: string;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  botId?: string;
  groupId?: string;
  name: string;
  mime: string;
  size: number;
  text: string;
  imageData?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageBudget {
  botId: string;
  maxRunsPerDay: number;
  maxTokensPerDay: number;
  maxToolCallsPerDay: number;
  usedRuns: number;
  usedInputTokens: number;
  usedOutputTokens: number;
  usedToolCalls: number;
  remainingRuns: number;
  remainingTokens: number;
  remainingToolCalls: number;
  date: string;
}

export interface ModelReply {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number };
}

export interface PublicTool extends Omit<Tool, 'secretHeaders'> {
  hasSecrets: boolean;
  builtin: boolean;
}

export interface Group {
  id: string;
  name: string;
  botIds: string[];
  coordinatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  botId?: string;
  role: 'user' | 'assistant' | 'handoff' | 'system';
  content: string;
  runId?: string;
  inputMode: 'text' | 'voice';
  status: 'completed' | 'failed';
  metadata: Record<string, unknown>;
  replyTo?: string;
  reactions?: Record<string, number>;
  editedAt?: string;
  deletedAt?: string;
  createdAt: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  botIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  path: string;
  content: string;
  updatedAt: string;
  size: number;
}

export interface WorkspaceSnapshot {
  bots: Bot[];
  providers: Provider[];
  tools: PublicTool[];
  memories: Memory[];
  routines: Routine[];
  groups: Group[];
  skills: Skill[];
  attachments: Attachment[];
  budgets: UsageBudget[];
  activeRuns: Run[];
  approvalCount: number;
}
