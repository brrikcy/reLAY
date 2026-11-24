import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Menu, WifiOff, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar.tsx';
import { ChatEmpty, ChatView } from './components/ChatView.tsx';
import { Inspector } from './components/Inspector.tsx';
import { ConnectionsView } from './components/ConnectionsView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { ResearchView } from './components/ResearchView.tsx';
import { BotModal } from './components/BotModal.tsx';
import { ProviderModal } from './components/ProviderModal.tsx';
import { ToolModal } from './components/ToolModal.tsx';
import { RoutineModal } from './components/RoutineModal.tsx';
import { MemoryModal } from './components/MemoryModal.tsx';
import { GroupView } from './components/GroupView.tsx';
import { GroupModal } from './components/GroupModal.tsx';
import { WorkspaceView } from './components/WorkspaceView.tsx';
import { HistoryView } from './components/HistoryView.tsx';
import { BudgetModal } from './components/BudgetModal.tsx';
import { WebhookKeyModal } from './components/WebhookKeyModal.tsx';
import { api } from './lib/api.ts';
import type { AllowRule, Approval, Bot, ChatMessage, Group, GroupMessage, InspectorTab, ProjectFile, Skill, Attachment, UsageBudget, Memory, Provider, PublicTool, Routine, Run, RunEvent, View } from './lib/types.ts';

interface Workspace { bots: Bot[]; providers: Provider[]; tools: PublicTool[]; routines: Routine[]; groups: Group[]; skills: Skill[]; budgets: UsageBudget[]; approvalCount: number; }
type ModalState = { kind: 'bot'; bot?: Bot } | { kind: 'provider'; provider?: Provider } | { kind: 'tool'; tool?: PublicTool } | { kind: 'routine' } | { kind: 'memory' } | { kind: 'group' } | { kind: 'budget' } | { kind: 'webhook'; routine: Routine; credentials: { key: string; url: string } } | null;

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>({ bots: [], providers: [], tools: [], routines: [], groups: [], skills: [], budgets: [], approvalCount: 0 });
  const [selectedId, setSelectedId] = useState(() => sessionStorage.getItem('relay.selectedBot') ?? 'bot_scout');
  const [selectedGroupId, setSelectedGroupId] = useState(() => sessionStorage.getItem('relay.selectedGroup') ?? 'group_team');
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const [projectFiles, setProjectFiles] = useState<Array<Omit<ProjectFile, 'content'>>>([]);
  const [view, setView] = useState<View>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<Record<string, RunEvent[]>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [groupAttachments, setGroupAttachments] = useState<Attachment[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [groupApprovals, setGroupApprovals] = useState<Approval[]>([]);
  const [allowRules, setAllowRules] = useState<AllowRule[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('activity');
  const [inspectorVisible, setInspectorVisible] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 1050 : true);
  const [mobileShowMain, setMobileShowMain] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const bot = workspace.bots.find((candidate) => candidate.id === selectedId);
  // Keep a ref so the reconcile timer always reads the live status
  // without bot?.status appearing in the SSE-effect dependency array.
  const botStatusRef = useRef(bot?.status);
  botStatusRef.current = bot?.status;
  const provider = workspace.providers.find((candidate) => candidate.id === bot?.providerId);
  const selectedGroup = workspace.groups.find((group) => group.id === selectedGroupId) ?? workspace.groups[0];
  const activeRun = runs.find((run) => ['running', 'waiting'].includes(run.status));


  const notify = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, type });
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 8000 : 4000);
  }, []);
  const loadWorkspace = useCallback(async () => {
    try { setWorkspace(await api.workspace()); setWorkspaceError(''); void fetch('/api/workspace/files').then((response) => response.json()).then(setProjectFiles).catch(() => undefined); }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : 'Could not connect to the Relay server.'); }
  }, []);
  const loadRuns = useCallback(async (botId: string) => {
    const nextRuns = await api.runs(botId);
    if (selectedIdRef.current !== botId) return;
    setRuns(nextRuns);
    const relevant = nextRuns.slice(0, 5);
    const results = await Promise.all(relevant.map(async (run) => [run.id, await api.runEvents(run.id)] as const));
    if (selectedIdRef.current === botId) setEvents(Object.fromEntries(results));
    return nextRuns;
  }, []);
  const loadConversation = useCallback(async (botId: string) => {
    try {
      const [nextMessages, nextMemories, nextApprovals, nextAttachments, nextRules] = await Promise.all([api.messages(botId), api.memories(botId), api.approvals(botId), api.attachments(botId), api.allowRules(botId)]);
      await loadRuns(botId);
      if (selectedIdRef.current !== botId) return;
      setMessages(nextMessages); setMemories(nextMemories); setApprovals(nextApprovals); setAttachments(nextAttachments); setAllowRules(nextRules);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not load this conversation.', 'error'); }
    finally { if (selectedIdRef.current === botId) setLoading(false); }
  }, [loadRuns, notify]);

  useEffect(() => {
    const onResize = () => { if (window.innerWidth < 1050) setInspectorVisible(false); };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => { void loadWorkspace().finally(() => setLoading(false)); }, [loadWorkspace]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const custom = event as CustomEvent<{ botId: string }>;
      void loadConversation(custom.detail.botId);
    };
    window.addEventListener('relay:refresh-messages', refresh);
    return () => window.removeEventListener('relay:refresh-messages', refresh);
  }, [loadConversation]);
  useEffect(() => {
    if (!bot) { setMessages([]); setRuns([]); setLoading(false); return; }
    setLoading(true);
    sessionStorage.setItem('relay.selectedBot', bot.id);
    void loadConversation(bot.id);
    const source = new EventSource(`/api/bots/${bot.id}/events`);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let reconcileTimer: ReturnType<typeof setInterval> | undefined;
    const refresh = (includeRun = false) => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void Promise.all([api.messages(bot.id), api.memories(bot.id), api.approvals(bot.id)]).then(([nextMessages, nextMemories, nextApprovals]) => {
          if (selectedIdRef.current !== bot.id) return;
          setMessages(nextMessages); setMemories(nextMemories); setApprovals(nextApprovals);
        }).catch(() => undefined);
        if (includeRun) void loadRuns(bot.id).catch(() => undefined);
      }, 80);
    };
    source.addEventListener('delta', (event) => {
      const delta = JSON.parse((event as MessageEvent).data) as { runId: string; messageId: string; text: string };
      setMessages((current) => {
        const exists = current.some((message) => message.id === delta.messageId);
        if (exists) return current.map((message) => message.id === delta.messageId ? { ...message, content: delta.text } : message);
        return [...current, { id: delta.messageId, botId: bot.id, role: 'assistant', content: delta.text, source: 'chat', createdAt: new Date().toISOString() }];
      });
    });
    source.addEventListener('message', () => refresh());
    source.addEventListener('run', () => { refresh(true); void loadWorkspace(); });
    source.addEventListener('workspace', () => { void loadWorkspace(); });
    source.onerror = () => { refresh(true); void loadWorkspace(); };
    // Reconcile even if an SSE connection was interrupted during a server restart.
    reconcileTimer = setInterval(() => { if (botStatusRef.current === 'working' || botStatusRef.current === 'waiting') { refresh(true); void loadWorkspace(); } }, 3000);
    return () => { source.close(); if (refreshTimer) clearTimeout(refreshTimer); if (reconcileTimer) clearInterval(reconcileTimer); };
  }, [bot?.id, loadConversation, loadRuns, loadWorkspace]);

  useEffect(() => {
    if (!selectedGroup) { setGroupMessages([]); setGroupApprovals([]); setGroupAttachments([]); return; }
    void api.groupAttachments(selectedGroup.id).then(setGroupAttachments).catch((error) => notify(error instanceof Error ? error.message : 'Could not load room attachments.', 'error'));
    sessionStorage.setItem('relay.selectedGroup', selectedGroup.id);
    void Promise.all([api.groupMessages(selectedGroup.id), api.groupApprovals(selectedGroup.id)]).then(([messages, approvals]) => { setGroupMessages(messages); setGroupApprovals(approvals); }).catch((error) => notify(error instanceof Error ? error.message : 'Could not load this room.', 'error'));
    const source = new EventSource(`/api/groups/${selectedGroup.id}/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void Promise.all([api.groupMessages(selectedGroup.id), api.groupApprovals(selectedGroup.id)]).then(([messages, approvals]) => { setGroupMessages(messages); setGroupApprovals(approvals); }).catch(() => undefined); }, 80); };
    source.addEventListener('group', refresh);
    source.addEventListener('group-delta', (event) => {
      const delta = JSON.parse((event as MessageEvent).data) as { botId: string; messageId: string; text: string };
      setGroupMessages((current) => {
        const exists = current.some((m) => m.id === delta.messageId);
        if (exists) return current.map((m) => m.id === delta.messageId ? { ...m, content: delta.text } : m);
        return [...current, { id: delta.messageId, groupId: selectedGroup.id, botId: delta.botId, role: 'assistant' as const, content: delta.text, inputMode: 'text' as const, status: 'completed' as const, metadata: { streaming: true }, createdAt: new Date().toISOString() }];
      });
    });
    return () => { source.close(); if (timer) clearTimeout(timer); };
  }, [selectedGroup?.id, notify]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setModal({ kind: 'bot' }); }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setView('history'); setTimeout(() => document.querySelector<HTMLInputElement>('.history-search input')?.focus(), 80); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, []);

  const selectBot = (id: string) => { setSelectedId(id); setView('chat'); setInspectorTab('activity'); setMobileShowMain(true); };
  const selectGroup = (id: string) => { setSelectedGroupId(id); setView('group'); setMobileShowMain(true); };
  const goBack = () => { setMobileShowMain(false); setSidebarOpen(false); };
  const navigate = (v: View) => { setView(v); setMobileShowMain(true); };
  const send = async (message: string, replyTo?: string) => {
    if (!bot) return;
    // Optimistic user message — appears instantly before the API round-trip
    const optimisticId = `opt_${Date.now()}`;
    setMessages((current) => [...current, { id: optimisticId, botId: bot.id, role: 'user', content: message, source: 'chat', reactions: {}, createdAt: new Date().toISOString(), replyTo: replyTo ?? undefined }]);
    setSending(true);
    try {
      const result = await api.send(bot.id, message, replyTo);
      if (!('direct' in result)) setRuns((current) => [result, ...current]);
      await Promise.all([loadConversation(bot.id), loadWorkspace()]);
    } catch (error) {
      setMessages((current) => current.filter((m) => m.id !== optimisticId));
      notify(error instanceof Error ? error.message : 'Could not send your message.', 'error');
    } finally { setSending(false); }
  };
  const stop = async () => {
    if (!activeRun) return;
    try { await api.stop(activeRun.id); notify('Run stopped. Completed actions were not undone.'); await loadConversation(selectedId); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not stop this run.', 'error'); }
  };
  const resolveApproval = async (id: string, decision: 'approved' | 'denied') => {
    setSending(true);
    try { await api.resolveApproval(id, decision); notify(decision === 'approved' ? 'Action approved. The run is continuing.' : 'Action denied. The bot was told not to retry it.'); await loadConversation(selectedId); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not resolve this approval.', 'error'); }
    finally { setSending(false); }
  };
  const savedBot = (saved: Bot) => { setSelectedId(saved.id); setView('chat'); setModal(null); void loadWorkspace(); notify(`${saved.name} is ready.`); };
  const deletedBot = (id: string) => { setModal(null); const remaining = workspace.bots.filter((candidate) => candidate.id !== id); setSelectedId(remaining[0]?.id ?? ''); void loadWorkspace(); notify('Bot and its local history were deleted.'); };
  const deleteTool = async (tool: PublicTool) => {
    if (!window.confirm(`Delete ${tool.name}? This removes the connection configuration.`)) return;
    try { await api.deleteTool(tool.id); await loadWorkspace(); notify('Connection deleted.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not delete this connection.', 'error'); }
  };
  const deleteMemory = async (id: string) => {
    if (!window.confirm('Delete this memory? Conversation history will remain.')) return;
    try { await api.deleteMemory(id); setMemories((current) => current.filter((memory) => memory.id !== id)); notify('Memory removed.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this memory.', 'error'); }
  };
  const toggleRoutine = async (routine: Routine) => {
    try { await api.saveRoutine(routine.botId, { enabled: !routine.enabled }, routine.id); await loadWorkspace(); notify(routine.enabled ? 'Routine paused.' : 'Routine enabled.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update this routine.', 'error'); }
  };
  const testRoutine = async (routine: Routine) => {
    try { await api.testRoutine(routine.id); setView('chat'); setSelectedId(routine.botId); setInspectorTab('activity'); setInspectorVisible(true); await loadWorkspace(); notify('Test run started. It may perform real tool calls.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not start this test.', 'error'); }
  };
  const webhookKey = async (routine: Routine) => {
    if (!window.confirm('Create a new webhook key? Any previous key will stop working. The new key is shown only once.')) return;
    try {
      const credentials = await api.createWebhookKey(routine.id);
      await loadWorkspace();
      setModal({ kind: 'webhook', routine, credentials });
    } catch (error) { notify(error instanceof Error ? `Could not copy the webhook key. ${error.message}` : 'Could not create and copy a webhook key.', 'error'); }
  };
  const closeModal = useCallback(() => setModal(null), []);

  return <div className={`app-shell ${mobileShowMain ? 'mobile-main' : 'mobile-home'}`}>
    {sidebarOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <Sidebar bots={workspace.bots} groups={workspace.groups} selectedId={selectedId} selectedGroupId={selectedGroupId} onSelect={selectBot} onSelectGroup={selectGroup} onNewGroup={() => setModal({ kind: 'group' })} view={view} onView={navigate} onNewBot={() => setModal({ kind: 'bot' })} search={search} onSearch={setSearch} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    <main className={`main-content view-${view}`}>
      {workspaceError && <div className="connection-error" role="alert"><WifiOff size={16} /><span>Relay can’t reach its local server. Start it with <code>npm start</code>, then retry.</span><button className="button secondary small" onClick={() => { setLoading(true); void loadWorkspace().finally(() => setLoading(false)); }}>Retry</button><button className="icon-button" onClick={() => setWorkspaceError('')} aria-label="Dismiss connection error"><X size={14} /></button></div>}
      <div className="mobile-topbar"><button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><span>relay.</span></div>
      {view === 'chat' && (bot ? <ChatView bot={bot} provider={provider} tools={workspace.tools} attachments={attachments} budget={workspace.budgets.find((item) => item.botId === bot.id)} messages={messages} approvals={approvals} allowRules={allowRules} activeRun={activeRun} latestRunEvent={(activeRun ? (events[activeRun.id] ?? []) : []).filter((e) => e.type === 'tool_requested' || e.type === 'model').at(-1)} loading={loading} sending={sending} onSend={(message, replyTo) => void send(message, replyTo)} onStop={() => void stop()} onApproval={(id, decision) => void resolveApproval(id, decision)} onAllowRule={async (toolName) => { try { await api.createAllowRule(bot.id, toolName); setAllowRules((current) => [...current, { id: `rule_${Date.now()}`, botId: bot.id, toolName, createdAt: new Date().toISOString() }]); notify(`${toolName} will run automatically in future. Manage rules in the inspector.`); } catch { notify('Could not save this rule.', 'error'); } }} onRetry={() => { const lastUser = [...messages].reverse().find((m) => m.role === 'user' && !m.deletedAt); if (lastUser) void send(lastUser.content, lastUser.replyTo); }} onEdit={() => setModal({ kind: 'bot', bot })} onOpenInspector={() => setInspectorVisible(!inspectorVisible)} onMenu={goBack} onConfigureProvider={() => { navigate('settings'); }} onBudget={() => setModal({ kind: 'budget' })} onAttachmentUploaded={(saved) => { setAttachments((current) => [saved, ...current]); notify(`${saved.name} is available to ${bot.name}.`); }} onAttachmentDeleted={(removed) => setAttachments((current) => current.filter((item) => item.id !== removed.id))} onError={(message) => notify(message, 'error')} skills={workspace.skills} onBack={goBack} /> : loading ? <div className="messages-loading"><span className="spinner" /><span>Opening your workspace…</span></div> : <ChatEmpty onNewBot={() => setModal({ kind: 'bot' })} />)}
      {view === 'group' && selectedGroup && <GroupView group={selectedGroup} groups={workspace.groups} bots={workspace.bots} messages={groupMessages} approvals={groupApprovals} onApproval={(id, decision) => void resolveApproval(id, decision)} onNewGroup={() => setModal({ kind: 'group' })} onSelectGroup={setSelectedGroupId} onError={(message) => notify(message, 'error')} attachments={groupAttachments} onAttachmentUploaded={(saved) => { setGroupAttachments((current) => [saved, ...current]); notify(`${saved.name} is available in this room.`); }} onAttachmentDeleted={(removed) => setGroupAttachments((current) => current.filter((item) => item.id !== removed.id))} onBack={goBack} />}
      {view === 'workspace' && <WorkspaceView files={projectFiles} skills={workspace.skills} onChanged={() => void loadWorkspace()} onBack={goBack} />}
      {view === 'history' && <HistoryView onOpenBot={(id) => selectBot(id)} onOpenGroup={(id) => { selectGroup(id); }} onBack={goBack} />}
      {view === 'connections' && <ConnectionsView tools={workspace.tools} bots={workspace.bots} onNew={() => setModal({ kind: 'tool' })} onEdit={(tool) => setModal({ kind: 'tool', tool })} onDelete={(tool) => void deleteTool(tool)} onAssign={() => bot ? setModal({ kind: 'bot', bot }) : setModal({ kind: 'bot' })} onHealthCheck={(message) => notify(message, message.includes('failed') || message.includes('Error') ? 'error' : 'success')} onBack={goBack} />}
      {view === 'settings' && <SettingsView providers={workspace.providers} bots={workspace.bots} budgets={workspace.budgets} onBudget={(botId) => { setSelectedId(botId); setModal({ kind: 'budget' }); }} onEdit={(provider) => setModal({ kind: 'provider', provider })} onEditBot={() => bot ? setModal({ kind: 'bot', bot }) : setModal({ kind: 'bot' })} onBack={goBack} />}
      {view === 'research' && <ResearchView onConnect={() => setModal({ kind: 'tool' })} onBack={goBack} />}
    </main>
    {view === 'chat' && bot && inspectorVisible && <Inspector bot={bot} tab={inspectorTab} onTab={setInspectorTab} runs={runs} events={events} memories={memories} routines={workspace.routines.filter((routine) => routine.botId === bot.id)} skills={workspace.skills} allowRules={allowRules} onAddMemory={() => setModal({ kind: 'memory' })} onDeleteMemory={(id) => void deleteMemory(id)} onNewRoutine={() => setModal({ kind: 'routine' })} onToggleRoutine={(routine) => void toggleRoutine(routine)} onTestRoutine={(routine) => void testRoutine(routine)} onWebhookKey={(routine) => void webhookKey(routine)} onDeleteAllowRule={async (id) => { try { await api.deleteAllowRule(id); setAllowRules((current) => current.filter((r) => r.id !== id)); notify('Rule removed. Future calls will ask for approval again.'); } catch { notify('Could not remove this rule.', 'error'); } }} onClose={() => setInspectorVisible(false)} />}
    {modal?.kind === 'bot' && <BotModal bot={modal.bot} providers={workspace.providers} tools={workspace.tools} onClose={closeModal} onSaved={savedBot} onDeleted={deletedBot} onError={(message) => notify(message, 'error')} />}
    {modal?.kind === 'provider' && <ProviderModal provider={modal.provider} onClose={closeModal} onSaved={(saved) => { setModal(null); void loadWorkspace(); notify(`${saved.name} saved. Assign it in bot settings to start using it.`); }} onError={(message) => notify(message, 'error')} />}
    {modal?.kind === 'tool' && <ToolModal tool={modal.tool} onClose={closeModal} onSaved={(saved) => { setModal(null); void loadWorkspace(); notify(`${saved.name} connected. Assign it to a bot to make it available.`); }} onError={(message) => notify(message, 'error')} />}
    {modal?.kind === 'routine' && bot && <RoutineModal bot={bot} onClose={closeModal} onSaved={() => { setModal(null); void loadWorkspace(); notify('Routine created. Test it before enabling the schedule.'); }} onError={(message) => notify(message, 'error')} />}
    {modal?.kind === 'group' && <GroupModal bots={workspace.bots} onClose={closeModal} onSaved={(saved) => { setSelectedGroupId(saved.id); setView('group'); setModal(null); void loadWorkspace(); notify(`${saved.name} is ready. Start typing or open a live voice room.`); }} onError={(message) => notify(message, 'error')} />}
    {modal?.kind === 'memory' && bot && <MemoryModal bot={bot} onClose={closeModal} onSaved={(saved) => { setModal(null); setMemories((current) => [saved, ...current]); notify('Memory saved for future conversations.'); }} onError={(message) => notify(message, 'error')} />}
    {modal?.kind === 'webhook' && <WebhookKeyModal routine={modal.routine} credentials={modal.credentials} onClose={closeModal} />}
    {modal?.kind === 'budget' && bot && <BudgetModal bot={bot} budget={workspace.budgets.find((item) => item.botId === bot.id) ?? { botId: bot.id, maxRunsPerDay: 50, maxTokensPerDay: 100000, maxToolCallsPerDay: 200, usedRuns: 0, usedInputTokens: 0, usedOutputTokens: 0, usedToolCalls: 0, remainingRuns: 50, remainingTokens: 100000, remainingToolCalls: 200, date: new Date().toISOString().slice(0, 10) }} onClose={closeModal} onSaved={(saved) => { setModal(null); setWorkspace((current) => ({ ...current, budgets: [...current.budgets.filter((item) => item.botId !== saved.botId), saved] })); notify('Daily usage budget saved.'); }} onError={(message) => notify(message, 'error')} />}
    {toast && <div className={`toast toast-${toast.type}`} role="status">{toast.type === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{toast.text}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={14} /></button></div>}
  </div>;
}
