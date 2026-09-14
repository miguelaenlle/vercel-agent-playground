import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppConfig,
  Conversation,
  ConversationSummary,
} from '../shared/types.js';
import { api } from './api.js';
import { Chat } from './Chat.js';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selection = useRef(0);

  const refreshList = useCallback(async () => {
    const [items, settings] = await Promise.all([
      api<ConversationSummary[]>('/conversations'),
      api<AppConfig>('/config'),
    ]);
    setConversations(items);
    setConfig(settings);
    return items;
  }, []);

  async function select(id: string) {
    const version = ++selection.current;
    setLoading(true);
    setConfirmDelete(false);
    setError('');
    try {
      const conversation = await api<Conversation>(`/conversations/${id}`);
      if (version !== selection.current) return;
      setSelected(conversation);
      localStorage.setItem('playground-conversation', id);
    } catch (error) {
      if (version === selection.current) setError((error as Error).message);
    } finally {
      if (version === selection.current) setLoading(false);
    }
  }

  useEffect(() => {
    // Restore only the selected ID; the server owns all messages and notes.
    void refreshList()
      .then(async (items) => {
        const saved = localStorage.getItem('playground-conversation');
        const id = items.find((item) => item.id === saved)?.id ?? items[0]?.id;
        if (id) await select(id);
        else setLoading(false);
      })
      .catch((error: Error) => {
        setError(error.message);
        setLoading(false);
      });
  }, [refreshList]);

  async function create() {
    setError('');
    setLoading(true);
    try {
      const conversation = await api<Conversation>('/conversations', {
        method: 'POST',
        body: '{}',
      });
      await refreshList();
      await select(conversation.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!selected) return;
    try {
      await api(`/conversations/${selected.id}`, { method: 'DELETE' });
      const items = await refreshList();
      setSelected(null);
      setConfirmDelete(false);
      localStorage.removeItem('playground-conversation');
      if (items[0]) await select(items[0].id);
    } catch (error) {
      setError((error as Error).message);
    }
  }

  const onUpdated = useCallback(
    async (id: string) => {
      await refreshList();
      const conversation = await api<Conversation>(`/conversations/${id}`);
      setSelected((current) => (current?.id === id ? conversation : current));
      return conversation;
    },
    [refreshList],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Conversations">
        <a className="brand" href="/" aria-label="Agent playground home">
          <span className="brand-mark">
            a<span>·</span>
          </span>
          <span>
            agent
            <br />
            <b>playground</b>
          </span>
        </a>
        <div className="sidebar-section">
          YOUR WORKSPACE <span className="live-dot" />
        </div>
        <button
          className="new-button"
          onClick={() => void create()}
          disabled={busy || loading}
        >
          <span>＋</span> New conversation
        </button>
        <nav className="conversation-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-button ${selected?.id === conversation.id ? 'selected' : ''}`}
              onClick={() => void select(conversation.id)}
              disabled={busy || loading}
              aria-current={
                selected?.id === conversation.id ? 'page' : undefined
              }
            >
              <span className="chat-glyph" aria-hidden="true">
                ◌
              </span>
              <span>{conversation.title}</span>
            </button>
          ))}
          {!conversations.length && (
            <p className="sidebar-empty">Your experiments will live here.</p>
          )}
        </nav>
        <div className="phase-list">
          <div className="sidebar-section">THE EXPERIMENT</div>
          <div className="phase current">
            <span>01</span>
            <div>
              Agent + chat<small>You're here</small>
            </div>
            <i>↗</i>
          </div>
          <div className="phase">
            <span>02</span>
            <div>
              Add a sandbox<small>Coming next</small>
            </div>
          </div>
          <div className="phase">
            <span>03</span>
            <div>
              Prepare a course<small>Coming later</small>
            </div>
          </div>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" /> Local playground
          <span className="version">v0.1</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">PHASE 01</span>
            <h1>Agent + chat</h1>
          </div>
          <div className="provider-badge">
            <span
              className={`status-dot ${config?.configured ? '' : 'missing'}`}
            />
            OpenAI <span className="muted">/</span>{' '}
            {config?.model ?? 'Connecting'}
          </div>
        </header>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {config && !config.configured && (
          <div className="banner setup" role="status">
            <strong>One key, then you're ready.</strong> Add{' '}
            <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart
            the server. No Vercel setup needed for this phase.
          </div>
        )}
        <div className="workspace">
          <section className="chat-pane" aria-label="Chat">
            <div className="conversation-header">
              <span>{selected?.title ?? 'A new place to experiment'}</span>
              {selected && (
                <div className="delete-actions">
                  {confirmDelete ? (
                    <>
                      <span>Delete this conversation?</span>
                      <button onClick={() => void remove()} disabled={busy}>
                        Delete
                      </button>
                      <button onClick={() => setConfirmDelete(false)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      className="quiet-button"
                      onClick={() => setConfirmDelete(true)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
            {loading ? (
              <div className="loading" role="status">
                Opening workspace…
              </div>
            ) : selected ? (
              <Chat
                key={selected.id}
                conversation={selected}
                configured={Boolean(config?.configured)}
                onBusy={setBusy}
                onUpdated={onUpdated}
              />
            ) : (
              <div className="welcome">
                <div className="sparkle" aria-hidden="true">
                  ✳
                </div>
                <span className="eyebrow">SMALL TOOLS. REAL ACTIONS.</span>
                <h2>
                  A little room
                  <br />
                  to think and do.
                </h2>
                <p>
                  Chat with an agent that can remember things.
                  <br />
                  Watch its tools work. Inspect what it saves.
                </p>
                <button
                  className="primary-button"
                  onClick={() => void create()}
                >
                  Start a conversation <span>↗</span>
                </button>
              </div>
            )}
          </section>

          <aside className="inspector" aria-label="Conversation data">
            <div className="inspector-heading">
              <h2>Conversation data</h2>
              <span className="count">
                {Object.keys(selected?.notes ?? {}).length}
              </span>
            </div>
            <p className="inspector-description">
              A window into what the agent saves. These notes belong to this
              conversation.
            </p>
            <div className="notes" aria-live="polite">
              {Object.entries(selected?.notes ?? {}).map(([key, value]) => (
                <article className="note" key={key}>
                  <div className="note-label">
                    <span aria-hidden="true">▤</span> {key}
                  </div>
                  <p>{value}</p>
                </article>
              ))}
              {!Object.keys(selected?.notes ?? {}).length && (
                <div className="empty-notes">
                  <span aria-hidden="true">▤</span>
                  <strong>A blank page, for now.</strong>
                  <p>
                    Ask the agent to save something.
                    <br />
                    It will appear here after the turn.
                  </p>
                </div>
              )}
            </div>
            <div className="tools-card">
              <span className="eyebrow">TWO TOOLS, NO MAGIC</span>
              <div>
                <code>saveNote</code>
                <p>Save a key and a value.</p>
              </div>
              <div>
                <code>readNotes</code>
                <p>Read this conversation's notes.</p>
              </div>
            </div>
            <div className="storage-note">
              <span aria-hidden="true">◷</span>
              <p>
                Kept in server memory.
                <br />
                Restarting the server clears everything.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
