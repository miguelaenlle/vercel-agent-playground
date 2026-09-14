import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { Conversation } from './conversation.js';
import './style.css';

function Chat({
  conversation,
  now,
  refresh,
  setBusy,
}: {
  conversation: Conversation;
  now: number;
  refresh: () => Promise<void>;
  setBusy: (busy: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: `/api/conversations/${conversation.id}/chat`,
      }),
  );
  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    messages: conversation.messages,
    onFinish: refresh,
  });
  const busy = status === 'submitted' || status === 'streaming';
  useEffect(() => {
    // Prevent switching conversations while this chat is streaming.
    setBusy(busy);
    return () => setBusy(false);
  }, [busy, setBusy]);

  return (
    <>
      <p>Chat status: {status}</p>
      <p>
        Conversation state: {conversation.state}.
        {conversation.expiresAt !== null &&
          (conversation.expiresAt > now
            ? ` Sandbox time remaining: ${Math.ceil((conversation.expiresAt - now) / 1000)} seconds.`
            : ' Sandbox deadline reached. Send a message to resume from saved files.')}
      </p>
      {messages.map((message) => (
        <article key={message.id}>
          <strong>{message.role}</strong>
          {message.parts.map((part, i) =>
            part.type === 'text' ? (
              <pre key={i}>{part.text}</pre>
            ) : (
              part.type !== 'step-start' && (
                <pre key={i}>{JSON.stringify(part, null, 2)}</pre>
              )
            ),
          )}
        </article>
      ))}
      {error && <p role="alert">{error.message}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage({ text });
          setText('');
        }}
      >
        <textarea
          aria-label="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
          rows={3}
        />
        <button
          disabled={busy || !text.trim() || conversation.state === 'error'}
        >
          Send
        </button>
      </form>
      {busy && <button onClick={() => void stop()}>Stop</button>}
      <p>
        Conversation: {conversation.id}. Files stay in its sandbox between
        turns.
      </p>
    </>
  );
}

function App() {
  const [now, setNow] = useState(Date.now());
  const [lifecycle, setLifecycle] = useState<{
    nextCheckAt: number;
    checking: boolean;
    activeRuntimeMs: number;
    checkIntervalMs: number;
  } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) throw new Error('Could not load conversations.');
      const data = await response.json();
      setConversations(data.conversations);
      setLifecycle(data.lifecycle);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    // Polling reads status only; it never extends the sandbox's idle deadline.
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, []);

  async function create() {
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Could not create conversation.');
      const conversation: Conversation = await response.json();
      await refresh();
      setId(conversation.id);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const selected = conversations.find((conversation) => conversation.id === id);
  return (
    <main>
      <h1>AI SDK experiment</h1>
      {lifecycle && (
        <p>
          Active sandbox TTL: {lifecycle.activeRuntimeMs / 60_000} minutes.
          Lifecycle checks every {lifecycle.checkIntervalMs / 1000} seconds.
        </p>
      )}
      {lifecycle && (
        <p>
          {lifecycle.checking
            ? 'Lifecycle check running…'
            : `Next lifecycle check in ${Math.max(0, Math.ceil((lifecycle.nextCheckAt - now) / 1000))} seconds.`}
        </p>
      )}
      <button onClick={() => void create()} disabled={busy}>
        New conversation
      </button>{' '}
      <select
        aria-label="Conversation"
        value={id}
        onChange={(event) => setId(event.target.value)}
        disabled={busy}
      >
        <option value="">Select conversation</option>
        {conversations.map((conversation, i) => (
          <option key={conversation.id} value={conversation.id}>
            Conversation {i + 1}
          </option>
        ))}
      </select>
      {error && <p role="alert">{error}</p>}
      {selected && (
        <Chat
          key={id}
          conversation={selected}
          now={now}
          refresh={refresh}
          setBusy={setBusy}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
