export type { Bot, ChatMessage, Memory, Provider, PublicTool, Routine, Run, RunEvent, Approval, Tool, Group, GroupMessage, Skill, ProjectFile, Attachment, UsageBudget, RoutineTrigger } from '../../server/types.ts';

export type View = 'chat' | 'group' | 'workspace' | 'history' | 'connections' | 'settings' | 'research';
export type InspectorTab = 'activity' | 'memory' | 'routines' | 'skills';
export type Modal = 'bot' | 'provider' | 'tool' | 'routine' | null;

export interface AllowRule {
  id: string;
  botId: string;
  toolName: string;
  createdAt: string;
}
