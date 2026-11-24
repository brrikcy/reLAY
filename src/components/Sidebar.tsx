import { useState } from 'react';
import { ArrowUpRight, BookOpen, Bot, ChevronDown, CircleHelp, FolderKanban, History, MoreVertical, Plug, Plus, Search, Settings, SlidersHorizontal, Users, X } from 'lucide-react';
import { BotAvatar } from './BotAvatar.tsx';
import { GroupAvatar } from './GroupAvatar.tsx';
import type { Bot as BotType, Group, View } from '../lib/types.ts';

interface SidebarProps {
  bots: BotType[];
  groups: Group[];
  selectedId: string;
  selectedGroupId: string;
  onSelect: (id: string) => void;
  onSelectGroup: (id: string) => void;
  onNewGroup: () => void;
  view: View;
  onView: (view: View) => void;
  onNewBot: () => void;
  search: string;
  onSearch: (value: string) => void;
  open: boolean;
  onClose: () => void;
}

export function RelayMark() {
  return <span className="relay-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M9 10h12a4 4 0 0 1 4 4v1M23 22H11a4 4 0 0 1-4-4v-1" /><path d="m21 7 4 4-4 4M11 17l-4 4 4 4" /></svg></span>;
}

export function Sidebar({ bots, groups, selectedId, selectedGroupId, onSelect, onSelectGroup, onNewGroup, view, onView, onNewBot, search, onSearch, open, onClose }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  const selectBot = (id: string) => { onSelect(id); onView('chat'); onClose(); };
  const selectGroup = (id: string) => { onSelectGroup(id); onView('group'); onClose(); };

  const filteredBots = bots.filter((bot) => `${bot.name} ${bot.role}`.toLowerCase().includes(search.toLowerCase()));
  const filteredGroups = groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand-row">
        <a href="#" className="brand" onClick={(event) => { event.preventDefault(); onView('chat'); }}>
          <RelayMark /><span>relay<span className="brand-period">.</span></span>
        </a>
        <button className="icon-button mobile-close" onClick={onClose} aria-label="Close navigation"><X size={18} /></button>
        <span className="workspace-badge">LOCAL</span>
        <div className="mobile-home-actions">
          <button className="icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="More options" aria-expanded={menuOpen}>
            <MoreVertical size={20} />
          </button>
          {menuOpen && <>
            <div className="mobile-menu-backdrop" onClick={closeMenu} />
            <div className="mobile-quick-menu" role="menu">
              <button role="menuitem" onClick={() => { closeMenu(); onNewBot(); }}><Plus size={15} />New bot</button>
              <button role="menuitem" onClick={() => { closeMenu(); onNewGroup(); }}><Users size={15} />New group</button>
              <div className="mobile-quick-menu-divider" />
              <button role="menuitem" onClick={() => { closeMenu(); onView('history'); }}><History size={15} />History & search</button>
              <button role="menuitem" onClick={() => { closeMenu(); onView('connections'); }}><Plug size={15} />Connections</button>
              <button role="menuitem" onClick={() => { closeMenu(); onView('settings'); }}><Settings size={15} />Settings</button>
              <button role="menuitem" onClick={() => { closeMenu(); onView('research'); }}><CircleHelp size={15} />Guide</button>
            </div>
          </>}
        </div>
      </div>

      <div className="sidebar-search">
        <Search size={15} />
        <input aria-label="Search bots and groups" placeholder="Find a bot or group…" value={search} onChange={(event) => onSearch(event.target.value)} />
        <kbd>⌘ K</kbd>
      </div>

      <div className="sidebar-scroll">
        {/* ── Bots section ─────────────────────────── */}
        <div className="sidebar-section-heading"><span>YOUR TEAM</span><span className="count-badge">{bots.length}</span></div>
        <div className="bot-list">
          {filteredBots.map((bot) => (
            <button className={`bot-list-item ${selectedId === bot.id && view === 'chat' ? 'selected' : ''}`} key={bot.id} onClick={() => selectBot(bot.id)}>
              <BotAvatar name={bot.name} color={bot.color} status={bot.status} size="small" showStatus />
              <span className="bot-list-copy">
                <strong>{bot.name}</strong>
                <span>{bot.status === 'working' ? 'Working on a task…' : bot.status === 'waiting' ? 'Waiting for you' : bot.role}</span>
              </span>
              {bot.status === 'working' && <span className="tiny-spinner" />}
              {bot.status === 'waiting' && <span className="waiting-dot" />}
            </button>
          ))}
          {!filteredBots.length && search && <div className="empty-sidebar" style={{padding:'10px 12px'}}><Bot size={18} /><p>No bots match.</p></div>}
          {!bots.length && <div className="empty-sidebar"><Bot size={20} /><p>Your team starts here.</p></div>}
        </div>
        <button className="new-bot-button" onClick={onNewBot}><Plus size={16} /><span>New bot</span><kbd>⌘ N</kbd></button>

        {/* ── Groups section ───────────────────────── */}
        <div className="sidebar-section-heading" style={{marginTop: 6}}>
          <span>GROUPS</span>
          <span className="count-badge">{groups.length}</span>
        </div>
        <div className="bot-list group-list">
          {filteredGroups.map((group) => (
            <button
              key={group.id}
              className={`bot-list-item group-list-item ${view === 'group' && selectedGroupId === group.id ? 'selected' : ''}`}
              onClick={() => selectGroup(group.id)}
            >
              <GroupAvatar name={group.name} size="small" memberCount={group.botIds.length} />
              <span className="bot-list-copy">
                <strong>{group.name}</strong>
                <span><Users size={10} style={{display:'inline',verticalAlign:'middle',marginRight:3}} />{group.botIds.length} specialist{group.botIds.length !== 1 ? 's' : ''}</span>
              </span>
            </button>
          ))}
          {!filteredGroups.length && search && <div className="empty-sidebar" style={{padding:'8px 12px',fontSize:11}}><Users size={16} /><p>No groups match.</p></div>}
          {!groups.length && !search && <div className="empty-sidebar" style={{padding:'8px 12px',fontSize:11,gap:6}}><Users size={16} /><p>Create a group for a specific purpose.</p></div>}
        </div>
        <button className="new-bot-button new-group-button" onClick={onNewGroup} style={{marginTop:4}}>
          <Users size={15} /><span>New group</span>
        </button>

        {/* ── Workspace navigation (desktop only) ─── */}
        <div className="sidebar-divider desktop-only-heading" />
        <div className="sidebar-section-heading desktop-only-heading"><span>WORKSPACE</span></div>
        <nav className="workspace-nav desktop-only-nav" aria-label="Workspace">
          <button className={view === 'history' ? 'selected' : ''} onClick={() => { onView('history'); onClose(); }}><History size={17} /><span>History & search</span><span className="nav-end"><ArrowUpRight size={13} /></span></button>
          <button className={view === 'workspace' ? 'selected' : ''} onClick={() => { onView('workspace'); onClose(); }}><FolderKanban size={17} /><span>Project files</span><span className="nav-end"><ArrowUpRight size={13} /></span></button>
          <button className={view === 'connections' ? 'selected' : ''} onClick={() => { onView('connections'); onClose(); }}><Plug size={17} /><span>Connections</span><span className="nav-end"><ArrowUpRight size={13} /></span></button>
          <button className={view === 'research' ? 'selected' : ''} onClick={() => { onView('research'); onClose(); }}><BookOpen size={17} /><span>How it works</span><span className="nav-end"><ArrowUpRight size={13} /></span></button>
        </nav>
        <div className="sidebar-note desktop-only-note"><span className="note-icon"><SlidersHorizontal size={16} /></span><div><strong>Built for your APIs</strong><p>One workspace. Any model.<br />Your tools, your rules.</p></div></div>
      </div>

      <div className="sidebar-footer desktop-only-footer">
        <button className={view === 'settings' ? 'selected' : ''} onClick={() => { onView('settings'); onClose(); }}><Settings size={17} /><span>Settings</span></button>
        <button onClick={() => onView('research')}><CircleHelp size={17} /><span>Guide & documentation</span></button>
        <div className="local-profile"><span className="profile-avatar">Y</span><span><strong>Your workspace</strong><small>Stored on this device</small></span><ChevronDown size={14} /></div>
      </div>

      <div className="sidebar-footer mobile-only-footer">
        <button onClick={() => { onView('settings'); }}><Settings size={17} /><span>Settings</span></button>
        <button onClick={() => { onView('history'); }}><History size={17} /><span>History</span></button>
      </div>
    </aside>
  );
}
