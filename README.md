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
CODEX_MODEL=
```

Create a [Vercel access token](https://vercel.com/account/tokens) with access to that team. Find the IDs in the team/project settings. `CODEX_MODEL` is optional. Leave it blank to use the harness default, or set a Codex-compatible model your API key can access.

Alternatively, link a Vercel project with `vercel link` and retrieve `VERCEL_OIDC_TOKEN` with `vercel env pull`. Merge that token into `.env.local` without overwriting your OpenAI key. Local OIDC tokens expire and need refreshing. See [Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication).

Credentials stay in the ignored `.env.local`. The Codex adapter receives only the OpenAI key for authentication discovery, avoiding automatic Gateway/subscription selection. The Vercel adapter supports request transformations: Codex receives a placeholder, and the adapter configures injection of the actual OpenAI credential into matching outbound requests. We do not pass the host environment into the VM.

## Course checkout

Set these in `.env.local` before creating a conversation:

```dotenv
COURSE_REPO_URL=https://github.com/your-org/your-course.git
GITHUB_PAT=...
```

The URL must have the form `https://github.com/OWNER/REPO.git`, including `.git`. Invalid URLs fail before sandbox creation. Use a fine-grained PAT scoped to that repository with **Contents: Read**. Restart Express after changing configuration, then create a new conversation. Setup installs Git authentication at the network boundary, then runs `git clone` directly into `/vercel/sandbox/course` before Codex starts. The harness uses the relative working directory `course`. Subsequent turns and sandbox resumes reuse the checkout, preserving edits. Clone failures fail setup before starting Codex. No dependency installation or PrairieLearn server setup is performed.

Try **List the course questions, then make a small wording change to one question and show the Git diff.** The PAT is injected by Vercel outside the VM for clone, fetch, and pull; it is not embedded in commands or supplied as an agent environment variable.

Live web search is enabled through the Codex adapter's built-in `webSearch: true`; it uses the existing OpenAI authentication. Try **Search the web for PrairieLearn documentation on numerical inputs and cite the source.**

For **git fetch / git pull**, Vercel injects the PAT outside the VM into HTTPS requests for this repository's Git read endpoints. The remote URL contains no credential. `src/git-auth.ts` combines these rules with Codex's OpenAI authentication on creation and resume. Keep the PAT read-only; push authentication is not configured. Try **Run git fetch origin and show git status.** A pull may still require resolving conflicts with local edits.

## Experiment

1. Run `pnpm dev` and open <http://localhost:4310>.
2. Create a conversation and ask: **Create data.json containing {"items":["one","two"]}.**
3. Ask it to append another item. Check the raw tool output and the sandbox's runtime countdown.
4. Wait for the runtime deadline to pass. Vercel stops compute and saves the filesystem automatically.
5. In the same conversation, ask it to read `data.json`. The SDK resumes the sandbox, and the harness resumes its saved session. Verify that the edits survived.
6. Create a second conversation to check workspace isolation. Try Stop during a turn; interrupted or failed turns may be marked unavailable and are no longer renewed.

Ask **Call hostPing and show its result.** The tool's `execute` callback runs in Express and returns `{ executedOn: "host", time: "..." }` to Codex. The existing chat displays the tool result. Native file and shell tools still run inside the sandbox.

Real sandbox execution and restore testing are intentionally manual.

## Lifecycle

One `liveSandboxes` map and one background lifecycle loop per Express process. The agent path only sets conversation state; the lifecycle manager reads it:

- **Active turn:** once per minute, extend the deadline to 10 minutes from that check. This includes harness setup, thinking, and tool execution.
- **Completed turn:** detach the native harness session and enter `waiting_for_user`. When the manager first observes the transition into `waiting_for_user`, it extends toward now + `SANDBOX_IDLE_MINUTES` (default 10). Further idle checks do nothing.
- **Next message:** a native SDK command resumes the sandbox if stopped, then the harness reattaches using its saved resume state.
- **Server exits:** renewals stop. Vercel stops the sandbox at its existing deadline and persists its filesystem. We never delete the sandbox on idle or shutdown.

The states are a small subset of the [Course agent MVP state machine](https://github.com/PrairieLearn/PrairieLearn/issues/15681):

| State               | Meaning / owner                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- |
| `offline`           | New conversation, or the background manager confirmed Vercel stopped its sandbox.  |
| `starting`          | The request creates/resumes the sandbox and attaches the harness.                  |
| `waiting_for_agent` | The harness is working; includes thinking, tools, stream draining, and detachment. |
| `waiting_for_user`  | The request finished successfully; the manager grants one idle allowance.          |
| `error`             | Setup, turn, or lifecycle failure; no further renewals.                            |

Normal path: `offline → starting → waiting_for_agent → waiting_for_user → offline`. A new message from `waiting_for_user` also enters `starting` for harness reattachment. Failures enter `error`. There are no approval, publishing, or sync states in this prototype. Vercel owns snapshotting; we don't invent a `suspending` transition we cannot observe. The background manager checks expired sandboxes with `resume: false` before reporting `offline`.

```dotenv
SANDBOX_ACTIVE_MINUTES=10
SANDBOX_IDLE_MINUTES=10
```

The sandbox starts with `SANDBOX_ACTIVE_MINUTES` of runtime (default 10, minimum 1). For a short experiment, set it to `1`; set `SANDBOX_IDLE_MINUTES=1` too if you want idle expiration after about one minute. Checks automatically use the smaller of 60 seconds or one-third of the active TTL, so a one-minute TTL gets checks every 20 seconds. Restart the server and create a new conversation after changing these values. Checks continue at that interval in all states. Active checks top up to the configured TTL; they do not add 10 minutes on top of the existing deadline. Idle checks grant one final allowance, then only confirm expiration. With the default settings, an observed idle transition expires roughly 10–11 minutes after the turn ends.

The manager tracks only the previously observed state. Timing is approximate: a whole turn between checks can go unnoticed and keep the previous deadline. No transition timestamps or idle deadlines are maintained by the agent.

Restart Express after changing this setting. No Workflow deployment, `LIFECYCLE_URL`, or `LIFECYCLE_SECRET` is needed. Old lifecycle environment variables are ignored.

`extendTimeout()` only adds time. We calculate the difference from the SDK's `expiresAt`, prevent overlapping lifecycle passes, and display the last acknowledged deadline in the UI. Polling the UI does not renew anything. The countdown reaching zero indicates the expected timeout, not an independently verified stop.

An existing deadline cannot be shortened: if a new turn starts soon after a 10-minute idle allowance was granted, it may still have nearly 10 minutes left. Likewise, setting idle time below 10 minutes cannot shorten the initial active allowance. A failed heartbeat aborts the local turn and stops renewal; no automatic retry loop keeps a failed conversation alive. The five-minute agent turn limit and Vercel's maximum continuous session duration still apply.

Vercel owns filesystem snapshots (`persistent: true`, keeping the latest snapshot). Snapshot storage remains billable after compute stops; default snapshot expiration is 30 days after last use. Express owns the in-memory conversation list and harness resume payload. **Restarting Express loses that metadata and the chat list**, even though the sandbox files persist in Vercel. Recovery across webserver restarts is outside this minimal prototype.

## Read the code

- [`src/sandbox.ts`](src/sandbox.ts): create a persistent native `Sandbox`, then give it to the standard Codex harness through `createVercelSandbox({ sandbox })`.
- [`src/server.ts`](src/server.ts): HTTP routes, in-memory maps, and shutdown.
- [`src/chat.ts`](src/chat.ts): resume → stream → drain → save the harness session; owns conversation state transitions.
- [`src/conversation.ts`](src/conversation.ts): the shared conversation shape.
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
- [PLAN.md](PLAN.md): the remaining course setup and validation work.
