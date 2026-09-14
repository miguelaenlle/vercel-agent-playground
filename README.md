# AI SDK experiment

Minimal React + Express example: the standard Codex harness, one Vercel Sandbox per conversation, and streaming chat. OpenAI is called directly; AI Gateway is not required. Sandbox testing is intentionally manual.

## Run

Requires Node 22.12+ and pnpm 11. Deploy the lifecycle service below before sending a chat message.

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
6. Try **Stop** during a longer turn. Completed file edits remain. If the SDK still reports an unfinished turn, the conversation is marked unavailable and idle cleanup stays disarmed.
7. Let a completed conversation sit idle. The countdown reaches zero, and Workflow deletes its sandbox. Confirm deletion in Vercel; the countdown shows when cleanup is due, not confirmation that the deletion API succeeded. The adapter may retain its reusable bootstrap template/snapshot.

## Workflow idle cleanup

The chat server stays local. This repo also builds a small lifecycle service for Vercel using the [official Express + Workflow integration](https://useworkflow.dev/docs/getting-started/express). Vercel runs the durable timer and deletion step. No Redis or database is needed.

1. Import this GitHub repository into a Vercel project (or use `vercel --prod` from this directory). The checked-in `vercel.json` builds the lifecycle service, not the local chat UI. Enable Fluid compute for the project.
2. Set `LIFECYCLE_SECRET` to the same long random value in Vercel's Production environment and your local `.env.local`. You can generate one with `openssl rand -hex 32`.
3. Give that deployment access to the sandbox project. If it is the same Vercel project/team, deployment OIDC authentication works automatically. Otherwise set `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` on the deployment to match your local sandbox credentials. The lifecycle deployment does not need your OpenAI key.
4. Deploy after setting those environment variables. The production URL must be accessible to the local server without Vercel's login screen. For this prototype, turn off Deployment Protection on the production deployment if needed. The start route requires the shared secret; generated webhook URLs are private bearer credentials and never reach the browser.
5. Add to `.env.local`:

   ```dotenv
   LIFECYCLE_URL=https://your-project.vercel.app
   LIFECYCLE_SECRET=your-generated-secret
   SANDBOX_IDLE_MINUTES=10
   ```

6. Restart `pnpm dev`, then create a new conversation. Use `SANDBOX_IDLE_MINUTES=0.5` for a 30-second experiment. Changes apply to newly created sandboxes.

The lifecycle is deliberately small:

```text
first turn → start workflow in active state → create sandbox → run Codex
turn finished and SDK confirms idle → webhook → sleep until idle deadline
next turn → webhook acknowledges active → run Codex (old sleep cannot delete)
idle deadline wins → close webhook → delete sandbox in a durable step
```

Thinking, tool execution, and stream draining all count as active. Opening the page or polling status does not reset the timer. Before a later turn starts, Express waits for the workflow's acknowledgment; if cleanup has already won, the turn fails and you create a new conversation. There is no Delete button.

Once the workflow has acknowledged idle, cleanup survives closing the browser or shutting down Express. If Express crashes during an active turn, or the SDK reports an unfinished turn after an interruption, we cannot prove the agent is inactive: this prototype leaves idle cleanup disarmed. The provider's configured 30-minute runtime timeout is a separate backstop for compute, not an agent-aware idle timer or guaranteed deletion of persistent snapshots. Individual coding turns still have a five-minute timeout.

The local conversation/session maps are still in memory. Restarting Express loses the chat list; reconnecting or restoring an expired sandbox is not implemented. Workflow deployment and real sandbox behavior are intentionally left for your manual experiment.

For lifecycle development only, `LIFECYCLE_SECRET=... pnpm dev:lifecycle` runs it at port 4312; set `LIFECYCLE_URL=http://localhost:4312`. That uses Workflow's local runtime, so it is not a test of Vercel-managed cleanup while your machine is offline.

## Read the code

- [`src/sandbox.ts`](src/sandbox.ts): credentials and `new HarnessAgent({ harness: createCodex(...), sandbox: createVercelSandbox(...) })`.
- [`src/server.ts`](src/server.ts): Express chat routes and in-memory sessions. Activity is acknowledged before streaming; idle is reported after the full turn drains.
- [`src/client.tsx`](src/client.tsx): `useChat`, conversation selector, raw SDK message parts, and countdown.
- [`src/lifecycle.ts`](src/lifecycle.ts): calls the lifecycle service and its private activity webhook.
- [`lifecycle/workflow.ts`](lifecycle/workflow.ts): the active/idle loop with durable `sleep`.
- [`lifecycle/steps.ts`](lifecycle/steps.ts): acknowledgments and sandbox deletion.
- [`lifecycle/server.ts`](lifecycle/server.ts): authenticated workflow start endpoint.

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
pnpm build:lifecycle
pnpm format:check
```

CI checks formatting and the build. Sandbox execution is left to the manual experiment above; there are no mocked agent modes or test servers.

## References / next phase

- [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents)
- [HarnessAgent UI integration](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/ui)
- [Codex adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/codex)
- [Vercel sandboxed coding agent guide](https://vercel.com/kb/guide/sandboxed-coding-agent-with-harnessagent)
- [PLAN.md](PLAN.md): phase 3 prepares a fixed PrairieLearn course checkout before coding starts.
