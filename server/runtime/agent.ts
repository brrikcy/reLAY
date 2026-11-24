import { db, getBot, getGroup, getProvider, getTool, toGroupMessage } from '../db.ts';
import { errorMessage, id, now } from '../lib/ids.ts';
import { HttpError } from '../lib/validation.ts';
import { publish, publishAll } from '../lib/events.ts';
import type { Bot, Run, RunEvent, Tool } from '../types.ts';
import { completeModel } from './providers.ts';
import type { ModelMessage } from './providers.ts';
import { executeHttpTool, publicToolDefinition } from './tools.ts';
import { addMemory, handleMemoryCommand, systemPrompt } from './memory.ts';
import { createApproval, createRun, event, getApproval, getRun, loadState, recentModelMessages, saveMessage, saveState, updateRun } from './store.ts';
import { delegateDefinition, HANDOFF_TOOL_NAME } from './handoffs.ts';
import { publishGroup, publishGroupDelta } from './groups.ts';
import { checkBudget, consumeBudget, consumeRunBudget } from './budgets.ts';
import { attachmentContext } from './attachments.ts';
import { tickRoutineRuns } from './routine-reconcile.ts';

interface RunState {
  pendingCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  steps: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
}
const active = new Map<string, AbortController>();
const botLocks = new Set<string>();
const pendingInstructions = new Map<string, Array<{ input: string; replyTo?: string }>>();

function botTools(bot: Bot): Tool[] {
  return bot.toolIds.map(getTool).filter((tool): tool is Tool => Boolean(tool?.enabled));
}
function setBotStatus(botId: string, status: Bot['status']): void {
  db.prepare('UPDATE bots SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), botId);
}
function emit(botId: string, saved: RunEvent): void {
  publish(botId, 'run', saved);
  publishAll('workspace');
}
function stateFor(run: Run): RunState {
  return { pendingCalls: [], steps: run.steps, modelCalls: run.modelCalls, toolCalls: run.toolCalls, inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens };
}
function checkpoint(run: Run, state: RunState): void {
  updateRun(run.id, { steps: state.steps, modelCalls: state.modelCalls, toolCalls: state.toolCalls, inputTokens: state.inputTokens, outputTokens: state.outputTokens });
  saveState(run.id, state);
}

export function addGroupSystemMessage(groupId: string, content: string, metadata: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO group_messages (id, group_id, role, content, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), groupId, 'system', content, 'completed', JSON.stringify(metadata), now());
  publishGroup(groupId);
}

function groupContext(groupId: string): string {
  const rows = db.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30').all(groupId) as Array<Record<string, unknown>>;
  return rows.reverse().map((row) => {
    const message = toGroupMessage(row);
    if (message.role === 'handoff') return `[Shared handoff] ${message.content}`;
    if (message.role === 'system') return `[Room notice] ${message.content}`;
    const author = message.botId ? getBot(message.botId)?.name ?? 'Former bot' : 'User';
    return `${author}: ${message.content}`;
  }).join('\n\n').slice(0, 35_000);
}

function groupBot(run: Run, bot: Bot): Bot {
  if (!run.groupId) return bot;
  const group = getGroup(run.groupId);
  if (!group) return bot;
  const members = group.botIds.map(getBot).filter((member): member is Bot => Boolean(member)).map((member) => ({ id: member.id, name: member.name, role: member.role }));
  return { ...bot, groupMembers: members };
}

export function isBotBusy(botId: string): boolean { return botLocks.has(botId); }
export function activeRunCount(): number { return active.size; }

export async function continueRun(runId: string): Promise<void> {
  if (active.has(runId)) return;
  const run = getRun(runId);
  if (!run || !['running', 'waiting'].includes(run.status)) return;
  const bot = getBot(run.botId);
  if (!bot) return;
  if (botLocks.has(bot.id) && run.status === 'running') return;
  botLocks.add(bot.id);
  const resuming = Boolean(loadState(run.id)) || run.modelCalls > 0 || run.toolCalls > 0;
  try { if (!resuming) { checkBudget(bot.id, 0, 0, 'run'); consumeRunBudget(bot.id); } }
  catch (error) {
    const message = errorMessage(error);
    updateRun(run.id, { status: 'failed', error: message });
    setBotStatus(bot.id, 'error');
    saveMessage(bot.id, { role: 'assistant', content: `**Run not started.** ${message}`, runId: run.id, source: run.source });
    event(run.id, 'failed', 'Daily budget reached', message);
    botLocks.delete(bot.id);
    publish(bot.id, 'message');
    publishAll('workspace');
    if (run.groupId) {
      db.prepare('INSERT INTO group_messages (id, group_id, bot_id, role, content, run_id, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), run.groupId, bot.id, 'assistant', `I couldn’t start this run. ${message}`, run.id, 'failed', '{}', now());
      publishGroup(run.groupId);
    }
    return;
  }
  const controller = new AbortController();
  active.set(runId, controller);
  setBotStatus(bot.id, 'working');
  publishAll('workspace');
  const state = stateFor(run);
  const storedState = loadState(run.id) as Partial<RunState> | undefined;
  if (storedState) state.pendingCalls.push(...(storedState.pendingCalls ?? []));
  const runDeadline = Date.now() + 4 * 60_000;
  const maxRecordedCalls = 24;
  try {
    const provider = getProvider(bot.providerId);
    if (!provider) throw new Error('The model provider assigned to this bot no longer exists.');
    const tools = botTools(bot);
    const attemptedCalls = new Set<string>();
    const failedTools = new Set<string>();
    let latestText = '';
    while (state.steps < provider.maxSteps && state.modelCalls + state.toolCalls < maxRecordedCalls) {
      if (controller.signal.aborted || Date.now() > runDeadline) throw new DOMException('Run exceeded its four-minute safety limit.', 'AbortError');
      if (!state.pendingCalls.length) {
        state.steps++;
        state.modelCalls++;
        checkpoint(run, state);
        emit(bot.id, event(run.id, 'model', `Thinking with ${provider.name}`, `Step ${state.steps} of ${provider.maxSteps}`));
        const context: ModelMessage[] = [
          { role: 'system', content: systemPrompt(groupBot(run, bot), run.input) + attachmentContext(bot.id, run.groupId) + (run.groupId ? `\n\nShared group conversation:\n${groupContext(run.groupId)}\n\nYou are one specialist in a shared room. Address the user's request from your role. Do not pretend to be another bot. You may delegate a focused subtask to another member when their expertise is necessary. Return a useful response for the shared room, not a private aside. Do not repeat the whole room history.` : '') },
          ...recentModelMessages(bot.id),
        ];
        const modelTools = tools.filter((tool) => !failedTools.has(tool.name)).map(publicToolDefinition);
        if (run.groupId && run.handoffDepth < 2) modelTools.push(delegateDefinition(groupBot(run, bot)));
        let streamMessageId = '';
        let streamedText = '';
        checkBudget(bot.id, 0, provider.maxTokens, 'model');
        const reply = await completeModel({ provider, messages: context, tools: modelTools, signal: controller.signal, onTextDelta: (text) => {
          if (!text) return;
          if (!streamMessageId) {
            const saved = saveMessage(bot.id, { role: 'assistant', content: '', runId: run.id, source: run.source });
            streamMessageId = saved.id;
          }
          streamedText += text;
          db.prepare('UPDATE messages SET content = ? WHERE id = ? AND bot_id = ?').run(streamedText, streamMessageId, bot.id);
          publish(bot.id, 'delta', { runId: run.id, messageId: streamMessageId, text: streamedText });
          if (run.groupId) publishGroupDelta(run.groupId, bot.id, streamMessageId, streamedText);
        } });
        if (reply.content && !reply.toolCalls.length) latestText = reply.content.replace(/<\|DSML\|function_calls[\s\S]*$/i, '').trim();
        state.inputTokens += reply.usage.inputTokens;
        state.outputTokens += reply.usage.outputTokens;
        consumeBudget(bot.id, reply.usage.inputTokens, reply.usage.outputTokens, 0);
        const wireCalls = reply.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
        if (streamMessageId && reply.content) db.prepare('UPDATE messages SET content = ? WHERE id = ? AND bot_id = ?').run(reply.content, streamMessageId, bot.id);
        else if (reply.content || wireCalls.length) saveMessage(bot.id, { role: 'assistant', content: reply.content.slice(0, 24_000).replace(/<\|DSML\|function_calls[\s\S]*$/i, '').trim(), toolCalls: wireCalls.length ? wireCalls : undefined, runId: run.id, source: run.source });
        publish(bot.id, 'message');
        state.pendingCalls.push(...reply.toolCalls);
        if (!state.pendingCalls.length) {
          const output = reply.content || 'The model returned an empty response.';
          checkpoint(run, state);
          updateRun(run.id, { status: 'completed', output });
          setBotStatus(bot.id, 'idle');
          emit(bot.id, event(run.id, 'completed', 'Run completed', `${state.modelCalls} model ${state.modelCalls === 1 ? 'call' : 'calls'} · ${state.toolCalls} tool ${state.toolCalls === 1 ? 'call' : 'calls'}`, { usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens } }));
          if (run.source === 'routine' || state.toolCalls > 0) addMemory(bot.id, `${new Date().toISOString().slice(0, 10)} — Completed “${run.input.slice(0, 160)}”. Result: ${output.slice(0, 500)}`, 'work_log', 'run');
          if (run.groupId) {
            db.prepare('INSERT INTO group_messages (id, group_id, bot_id, role, content, run_id, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), run.groupId, bot.id, 'assistant', output, run.id, 'completed', JSON.stringify({ handoffDepth: run.handoffDepth }), now());
            publishGroup(run.groupId);
          }
          publish(bot.id, 'message');
          publishAll('workspace');
          return;
        }
      }
      const call = state.pendingCalls.shift()!;
      const signature = `${call.name}:${JSON.stringify(call.arguments)}`;
      if (attemptedCalls.has(signature)) {
        saveMessage(bot.id, { role: 'tool', content: JSON.stringify({ error: 'This exact tool request was already attempted. Do not repeat it. Answer with the available evidence and clearly state any missing information.' }), toolName: call.name, toolCallId: call.id, runId: run.id, source: run.source });
        failedTools.add(call.name);
        emit(bot.id, event(run.id, 'tool_completed', `${call.name} duplicate request blocked`, 'Relay stopped a repeated tool call and ended this attempt.'));
        latestText ||= `I found some research results but stopped before repeating the same ${call.name} request again. I can summarize the evidence already gathered, or you can ask for a more specific next step.`;
        publish(bot.id, 'message');
        if (call.name === HANDOFF_TOOL_NAME) {
        latestText ||= `I handed off the specialist task and have the result. I’ll use it to answer the room directly.`;
        publish(bot.id, 'message');
        break;
      }
      if (state.pendingCalls.length === 0 && latestText) break;
        continue;
      }
      attemptedCalls.add(signature);
      if (failedTools.has(call.name)) {
        saveMessage(bot.id, { role: 'tool', content: JSON.stringify({ error: `${call.name} is unavailable for the rest of this run after a failed request. Do not retry it or use a workaround. Respond with what you can.` }), toolName: call.name, toolCallId: call.id, runId: run.id, source: run.source });
        if (state.pendingCalls.length === 0 && state.steps < provider.maxSteps) {
          publish(bot.id, 'message');
          continue;
        }
        latestText ||= `${call.name} is unavailable for the rest of this run. I stopped repeated attempts instead of continuing a failed loop.`;
        publish(bot.id, 'message');
        if (call.name === HANDOFF_TOOL_NAME) {
        latestText ||= `I handed off the specialist task and have the result. I’ll use it to answer the room directly.`;
        publish(bot.id, 'message');
        break;
      }
      if (state.pendingCalls.length === 0 && latestText) break;
        continue;
      }
      if (call.name === HANDOFF_TOOL_NAME && run.groupId) {
        const group = getGroup(run.groupId);
        const targetName = typeof call.arguments.bot_name === 'string' ? call.arguments.bot_name : '';
        const task = typeof call.arguments.task === 'string' ? call.arguments.task : '';
        const target = group?.botIds.map(getBot).find((member) => member?.name.toLowerCase() === targetName.toLowerCase() && member.id !== bot.id);
        if (!group || !target || run.handoffDepth >= 2 || task.length < 5 || task.length > 3000) {
          saveMessage(bot.id, { role: 'tool', content: JSON.stringify({ error: 'Delegation is unavailable for that bot or exceeds the handoff depth limit. Answer with your own expertise.' }), toolName: call.name, toolCallId: call.id, runId: run.id, source: run.source });
        } else {
          db.prepare('INSERT INTO group_messages (id, group_id, bot_id, role, content, run_id, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), run.groupId, bot.id, 'handoff', `${bot.name} asked ${target.name}: ${task}`, run.id, 'completed', JSON.stringify({ fromBotId: bot.id, toBotId: target.id }), now());
          publishGroup(run.groupId);
          const delegatedRun = startRun(target.id, `Shared room handoff from ${bot.name}: ${task}`, 'handoff', undefined, run.groupId, run.handoffDepth + 1);
          const deadline = Date.now() + 90_000;
          let delegatedResult = getRun(delegatedRun.id);
          while (delegatedResult && ['running', 'waiting'].includes(delegatedResult.status) && Date.now() < deadline && !controller.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            delegatedResult = getRun(delegatedRun.id);
          }
          const resultText = delegatedResult?.status === 'completed' ? delegatedResult.output : delegatedResult?.error || `The specialist did not finish within 90 seconds (status: ${delegatedResult?.status ?? 'unknown'}).`;
          saveMessage(bot.id, { role: 'tool', content: JSON.stringify({ delegatedRunId: delegatedRun.id, specialist: target.name, status: delegatedResult?.status ?? 'timeout', result: resultText }), toolName: call.name, toolCallId: call.id, runId: run.id, source: run.source });
        }
        checkpoint(run, state);
        publish(bot.id, 'message');
        continue;
      }
      const tool = tools.find((candidate) => candidate.name === call.name);
      emit(bot.id, event(run.id, 'tool_requested', `Requested ${call.name}`, JSON.stringify(call.arguments, null, 2), { toolCallId: call.id }));
      if (!tool) {
        saveMessage(bot.id, { role: 'tool', content: JSON.stringify({ error: `Tool “${call.name}” is unavailable or disabled for this bot. Do not retry it.` }), toolName: call.name, toolCallId: call.id, runId: run.id, source: run.source });
        checkpoint(run, state);
        publish(bot.id, 'message');
        continue;
      }
      if (tool.permission === 'deny') {
        saveMessage(bot.id, { role: 'tool', content: JSON.stringify({ error: 'This action is blocked by the tool policy. Do not retry or find a workaround.' }), toolName: tool.name, toolCallId: call.id, runId: run.id, source: run.source });
        emit(bot.id, event(run.id, 'approval_resolved', `${tool.name} blocked by policy`));
        checkpoint(run, state);
        publish(bot.id, 'message');
        continue;
      }
      if (tool.permission === 'approval') {
        const alreadyApproved = db.prepare("SELECT id FROM approvals WHERE run_id = ? AND tool_call_id = ? AND status = 'approved'").get(run.id, call.id);
        const hasAllowRule = !alreadyApproved ? db.prepare('SELECT id FROM allow_rules WHERE bot_id = ? AND tool_name = ?').get(bot.id, tool.name) : null;
        if (!alreadyApproved && !hasAllowRule) {
          const approval = createApproval(run.id, bot.id, call.id, tool.name, tool.id, call.arguments);
          state.pendingCalls.unshift(call);
          checkpoint(run, state);
          updateRun(run.id, { status: 'waiting' });
          setBotStatus(bot.id, 'waiting');
          emit(bot.id, event(run.id, 'approval_requested', 'Your approval is needed', `${tool.method} ${tool.name}`, { approvalId: approval.id, arguments: call.arguments }));
          if (run.groupId) publishGroup(run.groupId);
          publish(bot.id, 'message');
          publishAll('workspace');
          return;
        }
      }
      checkBudget(bot.id, 0, 0, 'tool');
      state.toolCalls++;
      consumeBudget(bot.id, 0, 0, 1);
      checkpoint(run, state);
      try {
        const result = await executeHttpTool(tool, call.arguments, controller.signal);
        saveMessage(bot.id, { role: 'tool', content: JSON.stringify(result), toolName: tool.name, toolCallId: call.id, runId: run.id, source: run.source });
        emit(bot.id, event(run.id, 'tool_completed', `${tool.name} completed`, `HTTP ${result.status} · Review the tool response in the transcript.`, { toolCallId: call.id, status: result.status }));
      } catch (error) {
        if (controller.signal.aborted) throw error;
        const message = errorMessage(error);
        failedTools.add(tool.name);
        saveMessage(bot.id, { role: 'tool', content: JSON.stringify({ error: `Tool request failed: ${message}. This tool is disabled for the rest of the run. Do not retry it. Answer with available evidence or explain the limitation.` }), toolName: tool.name, toolCallId: call.id, runId: run.id, source: run.source });
        emit(bot.id, event(run.id, 'tool_completed', `${tool.name} failed`, message, { toolCallId: call.id }));
      }
      publish(bot.id, 'message');
    }
    if (!state.pendingCalls.length && latestText) {
      updateRun(run.id, { status: 'completed', output: latestText });
      setBotStatus(bot.id, 'idle');
      emit(bot.id, event(run.id, 'completed', 'Run completed with a response', `${state.modelCalls} model calls · ${state.toolCalls} tool calls`));
      if (run.groupId) {
        db.prepare('INSERT INTO group_messages (id, group_id, bot_id, role, content, run_id, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), run.groupId, bot.id, 'assistant', latestText, run.id, 'completed', JSON.stringify({ handoffDepth: run.handoffDepth }), now());
        publishGroup(run.groupId);
      }
      publish(bot.id, 'message');
      return;
    }
    const recovery = latestText || 'I could not finish the full request because a required tool was unavailable. I stopped repeated attempts rather than continuing a failed loop.';
    const limitation = failedTools.size ? `Unavailable: ${[...failedTools].join(', ')}.` : '';
    const output = `${recovery}\n\n**Partial result:** I reached the ${provider.maxSteps}-step limit before completing everything. ${limitation} Please narrow the next task or ask me to continue from here.`;
    updateRun(run.id, { status: 'completed', output, error: `Partial result after reaching the ${provider.maxSteps}-step limit.` });
    setBotStatus(bot.id, 'idle');
    emit(bot.id, event(run.id, 'completed', 'Run finished with limitations', output));
    if (run.groupId) {
      db.prepare('INSERT INTO group_messages (id, group_id, bot_id, role, content, run_id, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), run.groupId, bot.id, 'assistant', output, run.id, 'completed', JSON.stringify({ partial: true }), now());
      publishGroup(run.groupId);
    }
    publish(bot.id, 'message');
  } catch (error) {
    const aborted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const message = aborted ? 'Run stopped by you. Actions already completed cannot be undone.' : errorMessage(error);
    updateRun(run.id, { status: aborted ? 'cancelled' : 'failed', error: message });
    setBotStatus(bot.id, aborted ? 'idle' : 'error');
    saveMessage(bot.id, { role: 'assistant', content: aborted ? `**Run stopped.** ${message}` : `**I couldn’t complete this run.**\n\n${message}\n\nYou can adjust the configuration and send your request again.`, runId: run.id, source: run.source });
    emit(bot.id, event(run.id, aborted ? 'cancelled' : 'failed', aborted ? 'Run stopped' : 'Run failed', message));
    if (run.groupId) {
      db.prepare('INSERT INTO group_messages (id, group_id, bot_id, role, content, run_id, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), run.groupId, bot.id, 'assistant', aborted ? `I stopped this run. ${message}` : `I couldn’t complete this response. ${message}`, run.id, 'failed', JSON.stringify({ handoffDepth: run.handoffDepth }), now());
      publishGroup(run.groupId);
    }
    publish(bot.id, 'message');
  } finally {
    active.delete(runId);
    botLocks.delete(bot.id);
    try { tickRoutineRuns(); } catch { /* A later scheduler tick reconciles any dispatch failure. */ }
    const next = pendingInstructions.get(bot.id)?.shift();
    if (!pendingInstructions.get(bot.id)?.length) pendingInstructions.delete(bot.id);
    if (next) {
      try { startRun(bot.id, next.input, 'chat', undefined, run.groupId, 0, next.replyTo); }
      catch (error) { event(run.id, 'failed', 'Follow-up could not start', errorMessage(error)); }
    }
    publishAll('workspace');
  }
}

export function startRun(botId: string, input: string, source: Run['source'] = 'chat', routineId?: string, groupId?: string, handoffDepth = 0, replyTo?: string): Run {
  const bot = getBot(botId);
  if (!bot) throw new HttpError(404, 'Bot not found.');
  if (botLocks.has(botId)) {
    if (source === 'chat') {
      const queued = pendingInstructions.get(botId) ?? [];
      if (queued.length >= 3) throw new HttpError(409, 'Three follow-up instructions are already queued. Wait for the current task to finish.');
      queued.push({ input, replyTo });
      pendingInstructions.set(botId, queued);
      publish(botId, 'message');
      return { id: `queued_${botId}_${Date.now()}`, botId, status: 'waiting', input, output: '', source, routineId, groupId, handoffDepth, steps: 0, modelCalls: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0 }, startedAt: now() };
    }
    throw new HttpError(409, `${bot.name} is still finishing another task. Wait for its response or stop that run first.`);
  }
  if (groupId && !getGroup(groupId)?.botIds.includes(botId)) throw new HttpError(403, 'This bot is not a member of the shared room.');
  const run = createRun(botId, input, source, routineId, groupId, handoffDepth);
  const userMessage = saveMessage(botId, { role: 'user', content: source === 'routine' ? `Routine: ${input}` : input, runId: run.id, source });
  if (replyTo) db.prepare('UPDATE messages SET reply_to = ? WHERE id = ? AND bot_id = ?').run(replyTo, userMessage.id, botId);
  event(run.id, 'started', source === 'routine' ? 'Routine started' : 'Run started', input.slice(0, 500));
  void continueRun(run.id);
  return run;
}

export async function resolveApproval(approvalId: string, decision: 'approved' | 'denied'): Promise<void> {
  const approval = getApproval(approvalId);
  if (!approval) throw new HttpError(404, 'Approval request not found.');
  if (approval.status !== 'pending') throw new HttpError(409, 'This approval request has already been resolved.');
  const run = getRun(approval.runId);
  if (!run || run.status !== 'waiting') throw new HttpError(409, 'This run is no longer waiting for approval.');
  db.prepare('UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?').run(decision, now(), approvalId);
  event(run.id, 'approval_resolved', decision === 'approved' ? 'Action approved' : 'Action denied', approval.toolName, { approvalId });
  if (run.groupId) publishGroup(run.groupId);
  if (decision === 'denied') {
    saveMessage(run.botId, { role: 'tool', content: JSON.stringify({ error: 'The user denied this action. Do not retry it or seek a workaround.' }), toolName: approval.toolName, toolCallId: approval.toolCallId, runId: run.id, source: run.source });
    const state = loadState(run.id) as Partial<RunState> | undefined;
    if (state) {
      state.pendingCalls = (state.pendingCalls ?? []).filter((call) => call.id !== approval.toolCallId);
      saveState(run.id, state);
    }
  }
  updateRun(run.id, { status: 'running' });
  setBotStatus(run.botId, 'working');
  botLocks.delete(run.botId);
  publish(run.botId, 'message');
  publishAll('workspace');
  await continueRun(run.id);
}

export function stopRun(runId: string): void {
  const run = getRun(runId);
  if (!run || !['running', 'waiting'].includes(run.status)) throw new HttpError(409, 'This run has already finished.');
  active.get(runId)?.abort();
  db.prepare("UPDATE approvals SET status = 'denied', resolved_at = ? WHERE run_id = ? AND status = 'pending'").run(now(), runId);
  if (run.status === 'waiting') {
    updateRun(runId, { status: 'cancelled', error: 'Run stopped while waiting for approval.' });
    setBotStatus(run.botId, 'idle');
    botLocks.delete(run.botId);
    saveMessage(run.botId, { role: 'assistant', content: '**Run stopped.** The proposed action was not executed.', runId, source: run.source });
    event(runId, 'cancelled', 'Run stopped', 'Stopped while waiting for approval.');
    publish(run.botId, 'message');
    publishAll('workspace');
  }
}

export function stopAllRuns(): void {
  for (const controller of active.values()) controller.abort();
}

export function handleDirectMessage(botId: string, input: string): string | null {
  return handleMemoryCommand(botId, input);
}

export function recoverInterruptedRuns(): void {
  const timestamp = now();
  db.prepare("UPDATE approvals SET status = 'denied', resolved_at = ? WHERE status = 'pending'").run(timestamp);
  db.prepare("UPDATE runs SET status = 'failed', error = 'Relay restarted before this run finished. Start a new run; no action was retried automatically.', completed_at = ? WHERE status IN ('running', 'waiting')").run(timestamp);
  db.prepare("UPDATE bots SET status = 'error' WHERE id IN (SELECT bot_id FROM runs WHERE error = 'Relay restarted before this run finished. Start a new run; no action was retried automatically.')").run();
}
