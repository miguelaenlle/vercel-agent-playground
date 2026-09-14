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

1. Run `pnpm dev` and open <http://localhost:4310>.
2. Create a conversation and ask: **Create data.json containing {"items":["one","two"]}.**
3. Ask it to append another item. Check the raw tool output and the sandbox's runtime countdown.
4. Wait for the runtime deadline to pass. Vercel stops compute and saves the filesystem automatically.
5. In the same conversation, ask it to read `data.json`. The SDK resumes the sandbox, and the harness resumes its saved session. Verify that the edits survived.
6. Create a second conversation to check workspace isolation. Try Stop during a turn; interrupted or failed turns may be marked unavailable and are no longer renewed.

Real sandbox execution and restore testing are intentionally manual.

## Lifecycle

One `liveSandboxes` map and one background lifecycle loop per Express process. The agent path only sets conversation state; the lifecycle manager reads it:

- **Active turn:** the manager checks locally each second and extends toward three minutes when fewer than two minutes remain. This includes harness setup, thinking, and tool execution.
- **Completed turn:** detach the native harness session and enter `waiting_for_user`. The manager extends to `waitingSince + SANDBOX_IDLE_MINUTES` (default 10), so repeated checks do not prolong idleness.
- **Next message:** a native SDK command resumes the sandbox if stopped, then the harness reattaches using its saved resume state.
- **Server exits:** renewals stop. Vercel stops the sandbox at its existing deadline and persists its filesystem. We never delete the sandbox on idle or shutdown.

The states are a small subset of the [Course agent MVP state machine](https://github.com/PrairieLearn/PrairieLearn/issues/15681):

| State               | Meaning / owner                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- |
| `offline`           | New conversation, or the background manager confirmed Vercel stopped its sandbox.  |
| `starting`          | The request creates/resumes the sandbox and attaches the harness.                  |
| `waiting_for_agent` | The harness is working; includes thinking, tools, stream draining, and detachment. |
| `waiting_for_user`  | The request finished successfully; `waitingSince` fixes the idle deadline.         |
| `error`             | Setup, turn, or lifecycle failure; no further renewals.                            |

Normal path: `offline → starting → waiting_for_agent → waiting_for_user → offline`. A new message from `waiting_for_user` also enters `starting` for harness reattachment. Failures enter `error`. There are no approval, publishing, or sync states in this prototype. Vercel owns snapshotting; we don't invent a `suspending` transition we cannot observe. The background manager checks expired sandboxes with `resume: false` before reporting `offline`.

```dotenv
SANDBOX_IDLE_MINUTES=10
```

Restart Express after changing this setting. No Workflow deployment, `LIFECYCLE_URL`, or `LIFECYCLE_SECRET` is needed. Old lifecycle environment variables are ignored.

`extendTimeout()` only adds time. We calculate the difference from the SDK's `expiresAt`, prevent overlapping lifecycle passes, and display the last acknowledged deadline in the UI. Polling the UI does not renew anything. The countdown reaching zero indicates the expected timeout, not an independently verified stop.

An existing deadline cannot be shortened: if a new turn starts soon after a 10-minute idle allowance was granted, it may still have nearly 10 minutes left. Likewise, setting idle time below three minutes cannot shorten the initial active allowance. A failed heartbeat aborts the local turn and stops renewal; no automatic retry loop keeps a failed conversation alive. The five-minute agent turn limit and Vercel's maximum continuous session duration still apply.

Vercel owns filesystem snapshots (`persistent: true`, keeping the latest snapshot). Snapshot storage remains billable after compute stops; default snapshot expiration is 30 days after last use. Express owns the in-memory conversation list and harness resume payload. **Restarting Express loses that metadata and the chat list**, even though the sandbox files persist in Vercel. Recovery across webserver restarts is outside this minimal prototype.

## Read the code

- [`src/sandbox.ts`](src/sandbox.ts): create a persistent native `Sandbox`, then give it to the standard Codex harness through `createVercelSandbox({ sandbox })`.
- [`src/server.ts`](src/server.ts): chat routes, in-memory sessions, and agent-owned state transitions.
- [`src/sandbox-lifecycle.ts`](src/sandbox-lifecycle.ts): background timeout policy and confirmation that idle sandboxes stopped.
- [`src/client.tsx`](src/client.tsx): `useChat`, raw SDK message parts, and runtime countdown.

```text
useChat → Express → HarnessAgent → Codex in a persistent Vercel Sandbox
              ↓
       active sandbox map → heartbeat → extendTimeout()
```

## Checks

```sh
pnpm build
pnpm format:check
```

## References

- [HarnessAgent UI integration](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/ui)
- [Vercel persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes)
- [PLAN.md](PLAN.md): the prepared-course phase remains separate.
