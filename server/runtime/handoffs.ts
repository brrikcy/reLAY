import type { Bot } from '../types.ts';

export const HANDOFF_TOOL_NAME = 'relay_delegate';

export function delegateDefinition(bot: Bot): { name: string; description: string; parameters: Record<string, unknown> } {
  return {
    name: HANDOFF_TOOL_NAME,
    description: 'Delegate a focused research or writing subtask to another specialist in this shared room. Use only when their expertise is needed. The result is returned to you so you can answer the user. Do not delegate casually or repeatedly.',
    parameters: {
      type: 'object', properties: {
        bot_name: { type: 'string', description: 'Name of another bot in the current room', enum: bot.groupMembers?.filter((member) => member.id !== bot.id).map((member) => member.name) ?? [] },
        task: { type: 'string', description: 'A complete, narrow subtask with required output format and no unnecessary context', minLength: 5, maxLength: 3000 },
      }, required: ['bot_name', 'task'], additionalProperties: false,
    },
  };
}
