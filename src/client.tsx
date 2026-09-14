import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { Conversation } from './server.js';
import './style.css';

function Chat({
  conversation,
  refresh,
  setBusy,
}: {
  conversation: Conversation;
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
        <button disabled={busy || !text.trim()}>Send</button>
      </form>
      {busy && <button onClick={() => void stop()}>Stop</button>}
      <p>
        Codex session: {conversation.id}. Files stay in its sandbox between
        turns.
      </p>
    </>
  );
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) throw new Error('Could not load conversations.');
      setConversations(await response.json());
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    // Load the server's in-memory conversations on page load.
    void refresh();
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
  async function remove() {
    const response = await fetch(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      setError('Could not delete conversation. Stop its turn first.');
      return;
    }
    setId('');
    await refresh();
  }
  const selected = conversations.find((conversation) => conversation.id === id);
  return (
    <main>
      <h1>AI SDK experiment</h1>
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
      {selected && (
        <button onClick={() => void remove()} disabled={busy}>
          Delete
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {selected && (
        <Chat
          key={id}
          conversation={selected}
          refresh={refresh}
          setBusy={setBusy}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
