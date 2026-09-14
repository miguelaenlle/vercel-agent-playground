# Agent playground roadmap

The experiment tests how much agent infrastructure can be supplied by Vercel-maintained libraries and Vercel services before integrating the approach into PrairieLearn.

## Codex + sandbox — implemented; manual verification pending

Uses the standard Codex harness through pinned AI SDK harness and Vercel Sandbox adapters. Sandbox execution has intentionally been left for manual testing.

- Create one real Vercel Sandbox per conversation, lazily on its first prompt.
- Use the standard harness's file, shell, editing, and search tools.
- Keep the live native session in the Express process and reuse it on later turns. UI messages display history; they are not a substitute for native session continuation. Detach/resume persistence is deferred to keep the code minimal.
- Inspect native tool outputs when asking the harness to read workspace files. A separate file browser is deferred.
- Stop generation on cancellation; terminate the sandbox on deletion and bound its maximum lifetime.

Use real Vercel credentials for Sandbox and direct OpenAI credentials for the model. AI Gateway remains optional. Keep provider credentials outside the sandbox using the adapter's supported network transformations.

Acceptance experiment: create a JSON file, change it on a later turn, and confirm a second conversation has a separate workspace. Exercise Stop, Delete, and expiration. Verify the adapter owns provisioning, the coding bridge, and event conversion rather than adding a custom runner.

## Phase 3: sandbox + prepared PrairieLearn course — planned

Clone a fixed test course before handing the workspace to the standard Codex harness. Keep repository-specific configuration and private-course details outside this public roadmap.

- Use supported bootstrap/session setup hooks for prerequisites and the checkout.
- Resolve and record the source commit once per conversation.
- Resume the existing checkout without recloning or overwriting edits.
- Use a repository-scoped, read-only credential for private clones, held outside the VM and removed from the clone path before the agent starts.
- Supply short course-editing instructions; keep the stock harness tools.
- Show setup status, actual changed files, and the Git diff in the inspector.
- Fail setup visibly rather than starting an agent against an incomplete checkout.

First experiment: edit one question's wording while preserving its identity and answer structure; refine that edit on a second turn; verify another conversation starts clean. Follow with a small Python question-code edit and appropriate checks.

Static JSON/Python checks do not prove PrairieLearn rendering or grading. Add validation against a disposable PrairieLearn instance as a separate step and report which checks actually ran. Remote pushes, pull requests, and automatic course sync are outside this phase.

## Ownership target

| Surface                                                           | Owner                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| Model/tool loop                                                   | Standard Codex harness                                    |
| Browser message streaming                                         | AI SDK                                                    |
| VM provisioning and isolation                                     | Vercel Sandbox in phases 2–3                              |
| Coding bridge, native event conversion, session attachment        | Harness adapters                                          |
| Setup hooks                                                       | SDK adapter; application supplies the fixed setup profile |
| Conversation list, transcript retention, metadata, cleanup policy | Express application                                       |
| Restart recovery and durable execution                            | Deferred                                                  |

A later hosted Workflow experiment can replace request-bound execution if durable continuation becomes the next goal. An in-memory map cannot supply durable session lookup for stateless hosted functions. Avoid adding custom stream buffers, watchdogs, or recovery coordinators to the initial experiment.

## References

- [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents)
- [Sandboxed coding agent with HarnessAgent](https://vercel.com/kb/guide/sandboxed-coding-agent-with-harnessagent)
- [Vercel Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication)
