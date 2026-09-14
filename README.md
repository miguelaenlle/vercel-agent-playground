# AI SDK experiment

Minimal React + Express example: streaming chat, conversations, and two agent tools that save/read notes in server memory. Uses OpenAI directly; no AI Gateway or Vercel credentials needed for phase 1.

## Run

Requires Node 22.12+ and pnpm 11.

```sh
pnpm install
cp .env.example .env.local  # Only if .env.local does not already exist.
# Set OPENAI_API_KEY in .env.local.
pnpm dev
```

Open <http://localhost:4310>. The key needs OpenAI API billing. `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Restart after changing `.env.local`.

1. Click **New conversation** and send **Save my project name as Prairie.**
2. Inspect the `tool-saveNote` message part and **Server notes** JSON.
3. Send **Read my notes.**
4. Create another conversation: its notes are empty. Use the dropdown to return to the first one.

## Read the code

- [`src/server.ts`](src/server.ts): Express, in-memory `Map`, `ToolLoopAgent`, two tools, and `pipeAgentUIStreamToResponse`. Startup is at the bottom.
- [`src/client.tsx`](src/client.tsx): conversation selector and `useChat` with `DefaultChatTransport`. Text is plain text; tool parts are printed as JSON.
- [`src/style.css`](src/style.css): basic readability only.

The request path is:

```text
useChat → DefaultChatTransport → Express → ToolLoopAgent → OpenAI
                                             ↓
                                     saveNote / readNotes
                                             ↓
                                      conversation.notes
```

AI SDK owns the agent loop, tool execution, message validation/conversion, and streaming format. Express owns the conversation map and tool implementations. `onEnd` saves the SDK transcript; the client refreshes notes after each turn.

This example follows the SDK's client-supplied message-history pattern. The server saves history for switching/reloading, but does not implement an authoritative message log, deduplication, or replay. It is a local single-user experiment, not a production backend. One turn per conversation may run at a time; turns are limited to six model steps and 90 seconds. Restarting clears all data. There is no persistence, stop/delete UI, auto-scroll, Markdown rendering, or recovery workflow. If a turn fails or is interrupted, start a new conversation.

## Check

```sh
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Tests inject an SDK mock model, exercise the real tool loop, and check separate conversation data and history. They make no paid API calls. Run the walkthrough with your key to test live OpenAI access.

## References / next phases

- [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents)
- [AI SDK chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
- [PLAN.md](PLAN.md): add the standard Codex harness and Vercel Sandbox, then prepare a fixed PrairieLearn course checkout.
