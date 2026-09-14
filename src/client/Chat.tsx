import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  isToolUIPart,
  getToolName,
  type UIMessage,
} from 'ai';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Conversation } from '../shared/types.js';
import { api } from './api.js';

const suggestions = [
  ['Remember something', 'Save my project name as Prairie.'],
  [
    'Give it a few details',
    'Save my favorite color as green and my preferred language as Python.',
  ],
  ['Look inside its memory', 'Read my saved notes and tell me what you know.'],
];

function Message({ message }: { message: UIMessage }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="message-avatar" aria-hidden="true">
        {message.role === 'user' ? 'Y' : '✳'}
      </div>
      <div className="message-body">
        <div className="message-author">
          {message.role === 'user' ? 'You' : 'Agent'}
        </div>
        {message.parts.map((part, index) => {
          if (part.type === 'text')
            return (
              <div className="markdown" key={index}>
                <ReactMarkdown>{part.text}</ReactMarkdown>
              </div>
            );
          if (isToolUIPart(part)) {
            const done = part.state === 'output-available';
            const failed =
              part.state === 'output-error' || part.state === 'output-denied';
            return (
              <details
                className={`tool-call ${failed ? 'failed' : ''}`}
                key={index}
              >
                <summary>
                  <span aria-hidden="true">
                    {done ? '✓' : failed ? '!' : '⋯'}
                  </span>
                  <code>{getToolName(part)}</code>
                  <small>
                    {done ? 'Complete' : failed ? 'Failed' : 'Working'}
                  </small>
                </summary>
                <div className="tool-details">
                  <strong>Input</strong>
                  <pre>{JSON.stringify(part.input ?? {}, null, 2)}</pre>
                  {done && (
                    <>
                      <strong>Result</strong>
                      <pre>{JSON.stringify(part.output, null, 2)}</pre>
                    </>
                  )}
                  {part.state === 'output-error' && <p>{part.errorText}</p>}
                </div>
              </details>
            );
          }
          return null;
        })}
      </div>
    </article>
  );
}

export function Chat({
  conversation,
  configured,
  onBusy,
  onUpdated,
}: {
  conversation: Conversation;
  configured: boolean;
  onBusy: (value: boolean) => void;
  onUpdated: (id: string) => Promise<Conversation>;
}) {
  const [input, setInput] = useState('');
  const [syncError, setSyncError] = useState('');
  const [stopping, setStopping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: `/api/conversations/${conversation.id}/chat`,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { message: messages.at(-1) },
        }),
      }),
  );
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    clearError,
    stop,
  } = useChat({
    id: conversation.id,
    messages: conversation.messages,
    transport,
    onFinish: () => {
      void onUpdated(conversation.id).catch((error: Error) =>
        setSyncError(error.message),
      );
    },
  });
  const busy = status === 'submitted' || status === 'streaming' || stopping;

  useEffect(() => {
    // Keep the conversation navigation locked until the SDK settles this turn.
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);

  useEffect(() => {
    // Follow streamed output only while the reader is already near the bottom.
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, status]);

  function submit(text: string) {
    if (!text.trim() || busy || !configured) return;
    setSyncError('');
    clearError();
    setInput('');
    follow.current = true;
    void sendMessage({ text: text.trim() });
  }

  async function stopTurn() {
    setStopping(true);
    try {
      await api(`/conversations/${conversation.id}/stop`, { method: 'POST' });
      await stop();
      const saved = await onUpdated(conversation.id);
      setMessages(saved.messages);
    } catch (error) {
      setSyncError((error as Error).message);
    } finally {
      setStopping(false);
    }
  }

  async function reload() {
    try {
      const saved = await onUpdated(conversation.id);
      setMessages(saved.messages);
      clearError();
      setSyncError('');
    } catch (error) {
      setSyncError((error as Error).message);
    }
  }

  return (
    <>
      <div
        className="message-scroll"
        ref={scroller}
        onScroll={() => {
          const node = scroller.current!;
          follow.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 100;
        }}
      >
        {!messages.length && (
          <div className="chat-intro">
            <div className="sparkle" aria-hidden="true">
              ✳
            </div>
            <h2>Let's try something.</h2>
            <p>
              Ask a question, save a detail, or let the agent
              <br />
              use its tools to remember something for you.
            </p>
            <div className="suggestions">
              {suggestions.map(([label, prompt]) => (
                <button
                  key={label}
                  onClick={() => submit(prompt)}
                  disabled={!configured || busy}
                >
                  <span>{label}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        {status === 'submitted' && (
          <div className="thinking" role="status">
            ✳{' '}
            <span>
              Thinking<span className="dots">…</span>
            </span>
          </div>
        )}
        {(error || syncError) && (
          <div className="chat-error" role="alert">
            <p>{syncError || error?.message}</p>
            <button onClick={() => void reload()} disabled={busy}>
              Reload saved conversation
            </button>
          </div>
        )}
        {conversation.status === 'interrupted' && !busy && !error && (
          <p className="interrupted" role="status">
            Turn stopped. Completed note changes are kept. Send a new message to
            continue.
          </p>
        )}
      </div>
      <form
        className="composer-area"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <div className="composer">
          <textarea
            aria-label="Message"
            placeholder={
              configured
                ? 'Ask, explore, or ask me to remember something…'
                : 'Add your OpenAI key to start chatting…'
            }
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={8000}
            rows={2}
            disabled={!configured || busy}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit(input);
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              <span className="status-dot" />{' '}
              {busy ? 'Agent is working' : 'Tools enabled'}
            </span>
            {busy ? (
              <button
                type="button"
                className="send-button stop"
                aria-label="Stop generating"
                onClick={() => void stopTurn()}
                disabled={stopping}
              >
                ■
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label="Send message"
                disabled={!input.trim() || !configured}
              >
                ↑
              </button>
            )}
          </div>
        </div>
        <p className="composer-footnote">
          Enter to send <span>·</span> Shift + Enter for a new line{' '}
          <span>·</span> Real model calls
        </p>
      </form>
    </>
  );
}
