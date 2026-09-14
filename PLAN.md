# Agent playground roadmap

The experiment tests how much agent infrastructure can be supplied by Vercel-maintained libraries and Vercel services before integrating the approach into PrairieLearn.

## Codex + sandbox — implemented; manual verification pending

Uses the standard Codex harness through pinned AI SDK harness and Vercel Sandbox adapters. Sandbox execution has intentionally been left for manual testing.

- Create one real Vercel Sandbox per conversation, lazily on its first prompt.
- Use the standard harness's file, shell, editing, and search tools.
- Keep native resume state in the Express process; detach after each completed turn and reattach for the next. Vercel persists sandbox files. Webserver restart recovery remains deferred.
- Inspect native tool outputs when asking the harness to read workspace files. A separate file browser is deferred.
- Stop generation on cancellation; renew active sandbox timeouts through one loop per webserver, grant an idle allowance after completed turns, and let Vercel stop and snapshot expired sessions.

Use real Vercel credentials for Sandbox and direct OpenAI credentials for the model. AI Gateway remains optional. Keep provider credentials outside the sandbox using the adapter's supported network transformations.

Acceptance experiment: create a JSON file, change it on a later turn, and confirm a second conversation has a separate workspace. Exercise Stop and idle expiration. Verify the adapter owns provisioning, the coding bridge, and event conversion rather than adding a custom runner.

## Phase 3: sandbox + prepared PrairieLearn course — cloning implemented

Vercel clones the configured course with a repository-scoped PAT during sandbox creation. Codex works in the checkout, and subsequent turns resume it without recloning. Configuration stays in `.env.local`. Live verification remains manual.

Remaining setup and validation work:

- Use supported setup hooks if course prerequisites are needed.
- Resolve and record the source commit once per conversation.
- Show setup status, actual changed files, and the Git diff in the inspector.

First experiment: edit one question's wording while preserving its identity and answer structure; refine that edit on a second turn; verify another conversation starts clean. Follow with a small Python question-code edit and appropriate checks.

Static JSON/Python checks do not prove PrairieLearn rendering or grading. Add validation against a disposable PrairieLearn instance as a separate step and report which checks actually ran. Remote pushes, pull requests, and automatic course sync are outside this phase.

## Ownership target

| Surface                                                    | Owner                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Model/tool loop                                            | Standard Codex harness                                    |
| Browser message streaming                                  | AI SDK                                                    |
| VM provisioning and isolation                              | Vercel Sandbox in phases 2–3                              |
| Coding bridge, native event conversion, session attachment | Harness adapters                                          |
| Setup hooks                                                | SDK adapter; application supplies the fixed setup profile |
| Conversation list, transcript retention, metadata          | Express application                                       |
| Active/idle timeout policy                                 | Express application                                       |
| Expiration and filesystem persistence                      | Vercel Sandbox                                            |
| Restart recovery and durable execution                     | Deferred                                                  |

Sandbox runtime deadlines now provide cleanup when the webserver goes away. Live verification remains manual. An in-memory map cannot supply durable session lookup for stateless hosted functions. Avoid adding custom stream buffers, watchdogs, or recovery coordinators to the initial experiment.

## References

- [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents)
- [Sandboxed coding agent with HarnessAgent](https://vercel.com/kb/guide/sandboxed-coding-agent-with-harnessagent)
- [Vercel Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication)
