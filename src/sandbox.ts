import { HarnessAgent, HarnessError } from '@ai-sdk/harness/agent';
import { createCodex } from '@ai-sdk/harness-codex';
import { sandboxProvider } from './sandbox-provider.js';

export function createSandboxAgent() {
  const {
    OPENAI_API_KEY,
    VERCEL_TOKEN,
    VERCEL_TEAM_ID,
    VERCEL_PROJECT_ID,
    VERCEL_OIDC_TOKEN,
  } = process.env;
  if (!OPENAI_API_KEY)
    throw new HarnessError({ message: 'Set OPENAI_API_KEY in .env.local.' });
  if (
    !VERCEL_OIDC_TOKEN &&
    !(VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID)
  ) {
    throw new HarnessError({
      message:
        'Set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID (or VERCEL_OIDC_TOKEN) in .env.local.',
    });
  }
  return new HarnessAgent({
    harness: createCodex({ auth: { OPENAI_API_KEY } }),
    model: process.env.CODEX_MODEL || 'gpt-5.3-codex',
    sandbox: sandboxProvider(),
    sandboxConfig: { workDir: 'workspace' },
    instructions:
      'Work in the current workspace. Use your native file and shell tools to fulfill requests. Keep replies brief. When changing data, use data.json unless asked otherwise.',
  });
}
