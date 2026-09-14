# AI SDK experiment

Minimal React + Express example: the standard Codex harness, one Vercel Sandbox per conversation, and streaming chat. OpenAI is called directly; AI Gateway is not required. Sandbox testing is intentionally manual.

## Run

Requires Node 22.12+ and pnpm 11.

```sh
pnpm install
cp .env.example .env.local  # Only if .env.local does not already exist.
# Add credentials below to .env.local.
pnpm dev
```

Open <http://localhost:4310>. Click **New conversation**. Restart the server after changing `.env.local`.

You need an OpenAI API key with API billing enabled and a Vercel project with Sandbox access:

```dotenv
OPENAI_API_KEY=...
VERCEL_TOKEN=...
VERCEL_TEAM_ID=team_...
VERCEL_PROJECT_ID=prj_...
CODEX_MODEL=gpt-5.3-codex
```

Create a [Vercel access token](https://vercel.com/account/tokens) with access to that team. Find the IDs in the team/project settings. `CODEX_MODEL` is a native Codex model name; set it to a Codex-compatible model your API key can access.

Alternatively, link a Vercel project with `vercel link` and retrieve `VERCEL_OIDC_TOKEN` with `vercel env pull`. Merge that token into `.env.local` without overwriting your OpenAI key. Local OIDC tokens expire and need refreshing. See [Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication).

Credentials stay in the ignored `.env.local`. The Codex adapter receives only the OpenAI key for authentication discovery, avoiding automatic Gateway/subscription selection. The Vercel adapter supports request transformations: Codex receives a placeholder, and the adapter configures injection of the actual OpenAI credential into matching outbound requests. We do not pass the host environment into the VM.

## Experiment

1. Click **New conversation**.
2. Send: **Create data.json containing {"items":["one","two","three"]}. Read it with a shell command and show the result.** The first turn provisions the sandbox and starts the stock Codex harness; expect it to take longer.
3. Send: **Append "four" to data.json, then use Python to print the item count.** It should be 4. The same native session and files are reused.
4. Create a second sandbox conversation and ask: **Check whether data.json exists. Do not create it.** It should be absent.
5. Switch back to the first conversation and ask it to read the file again. Inspect the raw tool input/output JSON in the transcript.
6. Try **Stop** during a longer turn. Completed file edits remain. If the native turn cannot continue after interruption, delete it and start a new conversation.
7. Click **Delete** after the turn settles; this calls the SDK's `session.destroy()`. You can confirm the session sandbox was removed in Vercel. The adapter may retain its reusable bootstrap template/snapshot.

Sandboxes have a configured 30-minute execution lifetime; individual coding turns have a five-minute timeout. Expired sessions fail visibly and are not silently replaced. Stop cancels generation; it does not destroy the sandbox. Delete when finished. Normal server shutdown destroys known sessions; a crash relies on the provider timeout. Restarting loses the in-memory conversation map. There is no restart recovery or reconnect/replay layer.

## Read the code

- [`src/sandbox.ts`](src/sandbox.ts): credentials and `new HarnessAgent({ harness: createCodex(...), sandbox: createVercelSandbox(...) })`.
- [`src/server.ts`](src/server.ts): Express routes and two in-memory maps. The sandbox branch creates a session once, streams each new prompt, and converts its output with SDK helpers. Delete destroys the session.
- [`src/client.tsx`](src/client.tsx): `useChat`, conversation selector, plain text and raw SDK message parts.

```text
useChat → Express → HarnessAgent.stream({ session, prompt })
                          ↓
                  Codex in Vercel Sandbox
                          ↓
                   native file/shell tools
                          ↓
                  SDK UI stream → useChat
```

The live harness session owns coding history. Only the latest user text goes into its next turn. The displayed transcript is saved separately with `onEnd`. Holding the live session in memory avoids detach/resume bookkeeping in this single-process example. There are no custom shell tools, process launchers, event parsers, or sandbox setup scripts.

## Checks

```sh
pnpm build
pnpm format:check
```

CI checks formatting and the build. Sandbox execution is left to the manual experiment above; there are no mocked agent modes or test servers.

## References / next phase

- [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents)
- [HarnessAgent UI integration](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/ui)
- [Codex adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/codex)
- [Vercel sandboxed coding agent guide](https://vercel.com/kb/guide/sandboxed-coding-agent-with-harnessagent)
- [PLAN.md](PLAN.md): phase 3 prepares a fixed PrairieLearn course checkout before coding starts.
