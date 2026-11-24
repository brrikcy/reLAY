import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, Clock3, Download, Search, Users } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Run } from '../lib/types.ts';
import { relativeTime } from '../lib/utils.ts';

interface HistoryItem extends Run { botName: string }
interface SearchItem { id: string; botId: string; groupId?: string; botName: string; role: string; content: string; runId?: string; source: string; createdAt: string }

function stripMarkdown(text: string): string {
  return text.replace(/[*_`#>[\]()]/g, '').replace(/\n+/g, ' ').trim();
}

export function HistoryView({ onOpenBot, onOpenGroup, onBack }: { onOpenBot: (id: string) => void; onOpenGroup: (id: string) => void; onBack?: () => void }) {
  const [runs, setRuns] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void fetch('/api/history').then((r) => r.json()).then((items) => { setRuns(items); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      void api.search(query.trim()).then((items) => { setResults(items as SearchItem[]); setSearching(false); }).catch(() => { setResults([]); setSearching(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const exportHistory = () => {
    const blob = new Blob([JSON.stringify(runs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `relay-history-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    URL.revokeObjectURL(url);
  };

  const counts = useMemo(() => ({
    completed: runs.filter((r) => r.status === 'completed').length,
    tools: runs.reduce((t, r) => t + r.toolCalls, 0),
    models: runs.reduce((t, r) => t + r.modelCalls, 0),
  }), [runs]);

  const statusColor = (status: string) => status === 'completed' ? 'green' : status === 'failed' ? 'coral' : 'muted';

  return (
    <div className="page-scroll">
      {/* Mobile-only header with back button */}
      {onBack && (
        <div className="mobile-page-header">
          <button className="mobile-back-btn" onClick={onBack} aria-label="Back to list"><ArrowLeft size={22} /></button>
          <span>History</span>
          <button className="button secondary small" onClick={exportHistory} disabled={!runs.length} style={{marginLeft:'auto',fontSize:11}}><Download size={13} />Export</button>
        </div>
      )}

      <div className="page-container history-page">
        {/* Desktop header — hidden on mobile when onBack is provided */}
        <header className={`page-heading history-heading ${onBack ? 'desktop-only-heading' : ''}`}>
          <div>
            <span className="eyebrow">YOUR WORK, IN CONTEXT</span>
            <h1>Pick up where<br />you left off.</h1>
            <p>Search past conversations, inspect recorded runs, and export a local copy of your history.</p>
          </div>
          <button className="button secondary" onClick={exportHistory} disabled={!runs.length}><Download size={15} />Export history</button>
        </header>

        {/* Search */}
        <div className="history-search">
          <Search size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations, prompts, and results…" aria-label="Search conversation history" />
          {searching && <span className="tiny-spinner" />}
        </div>

        {query.trim().length >= 2 ? (
          <section className="history-results">
            <div className="section-heading">
              <div>
                <h2>Conversation matches <span>{results.length}</span></h2>
                <p>Direct chats and shared rooms searched together.</p>
              </div>
            </div>
            {results.length ? (
              <div className="history-result-list">
                {results.map((item) => (
                  <button key={item.id} onClick={() => item.groupId ? onOpenGroup(item.groupId) : onOpenBot(item.botId)}>
                    <span className="history-result-icon">{item.groupId ? <Users size={16} /> : <Bot size={16} />}</span>
                    <div>
                      <strong>{item.botName}<span>{item.groupId ? 'group' : item.role}</span></strong>
                      <p>{stripMarkdown(item.content).slice(0, 160)}</p>
                      <small>{relativeTime(item.createdAt)} · {item.source}</small>
                    </div>
                  </button>
                ))}
              </div>
            ) : !searching && (
              <div className="large-empty"><Search size={25} /><h2>No matching conversations.</h2><p>Try a different phrase or a shorter term.</p></div>
            )}
          </section>
        ) : (
          <>
            {/* Metrics grid */}
            <div className="history-metrics">
              <div><strong>{runs.length}</strong><span>Recorded runs</span></div>
              <div><strong>{counts.completed}</strong><span>Completed runs</span></div>
              <div><strong>{counts.tools}</strong><span>Tool calls</span></div>
              <div><strong>{counts.models}</strong><span>Model calls</span></div>
            </div>

            <section className="history-runs-section">
              <div className="section-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>A durable audit trail of your local agent work.</p>
                </div>
              </div>

              {loading && <div className="messages-loading"><span className="spinner" />Loading history…</div>}

              {!loading && !runs.length && (
                <div className="large-empty"><Clock3 size={25} /><h2>No runs yet.</h2><p>Start a conversation with one of your bots to record your first run.</p></div>
              )}

              {runs.length > 0 && (
                <div className="history-run-list">
                  {runs.map((run) => (
                    <button key={run.id} className={`history-run-item status-${run.status}`} onClick={() => run.groupId ? onOpenGroup(run.groupId) : onOpenBot(run.botId)}>
                      <div className="history-run-top">
                        <strong className="history-run-bot">{run.botName}</strong>
                        <span className={`run-status-label status-${statusColor(run.status)}`}>{run.status}</span>
                        <span className="history-run-time">{relativeTime(run.startedAt)}</span>
                      </div>
                      <p className="history-run-input">{stripMarkdown(run.input).slice(0, 180)}</p>
                      {run.output && <p className="history-run-output">{stripMarkdown(run.output).slice(0, 140)}</p>}
                      <div className="history-run-meta">
                        <span>{run.modelCalls} model call{run.modelCalls !== 1 ? 's' : ''}</span>
                        <span className="meta-dot">·</span>
                        <span>{run.toolCalls} tool call{run.toolCalls !== 1 ? 's' : ''}</span>
                        {run.groupId && <><span className="meta-dot">·</span><span>group</span></>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
