# Vercel agent playground

A small React + Express application for trying Vercel's AI SDK before adding managed sandboxes and adapting the workflow to PrairieLearn.

**Phase 1 is implemented:** streaming chat, an agent with two real tools, multiple conversations, and an inspector for conversation-specific notes. Model requests go directly to OpenAI. **AI Gateway and Vercel credentials are not required.**

## Run locally

Requires Node.js 22.12+ and pnpm 11.

```sh
pnpm install
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local.
pnpm dev
```

Open <http://localhost:4310>. Create an [OpenAI API key](https://platform.openai.com/api-keys) with API billing enabled; a ChatGPT subscription alone does not provide API credits. Keep the key in `.env.local`, which Git ignores. Restart the server after changing this file.

The default model is `gpt-4.1-mini`. Set `OPENAI_MODEL` to another tool-capable OpenAI model available to your key, or `PORT` to change the local port. The application shows setup instructions when the key is missing and a visible error if the provider rejects a request. It never falls back to fake replies.

For a production frontend build, run `pnpm build` followed by `pnpm start`. This is still a local, single-user playground; it binds to the loopback interface and has no login system.

## Try it

1. Create a conversation and ask: **Save my project name as Prairie.**
2. Expand the `saveNote` activity to see its input and result. The note appears in the inspector when the turn finishes.
3. Ask: **Read my notes. What is my project name?** Watch `readNotes` run.
4. Create another conversation. It starts with empty notes. Return to the first conversation or reload the page to see its saved transcript and notes.
5. Try Stop during generation, then send a follow-up. Delete removes the conversation and its data.

Everything lives in an Express `Map`. Restarting the server clears it. Reloading during generation interrupts that turn; there is no reconnect/replay or restart recovery. Completed tool changes remain after Stop. One turn can run at a time across the playground.

## Who owns what?

| Surface                                                            | Owner                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Agent loop and tool execution                                      | AI SDK `ToolLoopAgent`                                          |
| Model API integration                                              | `@ai-sdk/openai`, direct OpenAI credentials                     |
| Streaming protocol and React chat state                            | AI SDK stream helpers, `DefaultChatTransport`, `useChat`        |
| Conversation identity, history, notes, limits, cancellation policy | This Express application                                        |
| `saveNote` and `readNotes` behavior                                | Two small application tools, scoped to the current conversation |
| UI and data inspector                                              | This React application                                          |
| Sandboxes, course setup, durable hosting                           | Later phases                                                    |

Express accepts only a new user message and builds model input from server-owned history. Stable message IDs prevent duplicate submissions. There are no custom event parsers, token buffers, stream replay stores, or agent runners.

Runs are limited to 6 model steps and 90 seconds, with no automatic provider retries. Notes and messages have size/count limits. These are demo bounds, not a billing budget: each turn makes real, billable API calls, potentially one call per tool-loop step.

## Code map

```text
src/server/index.ts     Environment, direct provider, Express + Vite startup
src/server/app.ts       In-memory conversations, HTTP routes, SDK streaming
src/server/agent.ts     Agent instructions and the two notes tools
src/shared/types.ts    Conversation and configuration types
src/client/App.tsx     Conversation navigation and data inspector
src/client/Chat.tsx    useChat, Markdown messages, tool activity, composer
```

## Verify

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm format:check
```

Integration tests inject an SDK mock model while exercising the real agent/tool/streaming code. They cover tool execution, isolation, server-held history, duplicate submissions, invalid input, missing configuration, cancellation, timeout, deletion, and cross-origin rejection. Browser tests cover chat and tool inspection, reload, separate conversations, stopping/deleting, mobile layout, and missing-key guidance. The test-only server is separate from the application; these tests need no credentials and make no paid model calls.

Use the walkthrough above with your API key to validate live OpenAI access. Mock tests do not establish that a particular API key or model is available.

## Next

- **Phase 2:** standard Codex harness + one real Vercel Sandbox per conversation.
- **Phase 3:** prepare the sandbox by cloning a fixed PrairieLearn test course, then edit and inspect PrairieLearn course code.

See [PLAN.md](PLAN.md) for the full design and future credential/setup requirements. Vercel-managed sandbox execution starts in phase 2; Express owns orchestration and in-memory metadata in phase 1.
