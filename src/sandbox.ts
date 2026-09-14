import { HarnessAgent, HarnessError } from '@ai-sdk/harness/agent';
import { createCodex } from '@ai-sdk/harness-codex';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import { Sandbox } from '@vercel/sandbox';

export async function createSandboxAgent(sessionId: string) {
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
  const sandbox = await Sandbox.create({
    name: sessionId,
    runtime: 'node24',
    ports: [4000],
    timeout: 3 * 60_000,
    persistent: true,
    keepLastSnapshots: { count: 1 },
    ...sandboxCredentials(),
  });
  const agent = new HarnessAgent({
    harness: createCodex({ auth: { OPENAI_API_KEY } }),
    model: process.env.CODEX_MODEL || 'gpt-5.3-codex',
    sandbox: createVercelSandbox({ sandbox }),
    sandboxConfig: { workDir: 'workspace' },
    instructions:
      'Work in the current workspace. Use your native file and shell tools to fulfill requests. Keep replies brief. When changing data, use data.json unless asked otherwise.',
  });
  return { agent, sandbox };
}

export function sandboxCredentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  return VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
    ? {
        token: VERCEL_TOKEN,
        teamId: VERCEL_TEAM_ID,
        projectId: VERCEL_PROJECT_ID,
      }
    : {};
}
