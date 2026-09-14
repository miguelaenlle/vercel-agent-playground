import {
  HarnessAgent,
  HarnessError,
  type HarnessAgentSession,
  type HarnessAgentResumeSessionState,
} from '@ai-sdk/harness/agent';
import { createCodex } from '@ai-sdk/harness-codex';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import { Sandbox } from '@vercel/sandbox';
import { tool } from 'ai';
import { z } from 'zod';

export function sandboxActiveRuntimeMs() {
  return (
    z.coerce
      .number()
      .min(1)
      .max(1440)
      .parse(process.env.SANDBOX_ACTIVE_MINUTES || 10) * 60_000
  );
}

export type SandboxRuntime = Awaited<ReturnType<typeof createSandboxAgent>> & {
  session?: HarnessAgentSession;
  resumeFrom?: HarnessAgentResumeSessionState;
};

export async function createSandboxAgent(sessionId: string) {
  const {
    OPENAI_API_KEY,
    COURSE_REPO_URL,
    GITHUB_PAT,
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
  if (!COURSE_REPO_URL || !GITHUB_PAT) {
    throw new HarnessError({
      message: 'Set COURSE_REPO_URL and GITHUB_PAT in .env.local.',
    });
  }
  const sandbox = await Sandbox.create({
    source: {
      type: 'git',
      url: COURSE_REPO_URL,
      username: 'x-access-token',
      password: GITHUB_PAT,
    },
    name: sessionId,
    runtime: 'node24',
    ports: [4000],
    timeout: sandboxActiveRuntimeMs(),
    persistent: true,
    keepLastSnapshots: { count: 1 },
    ...sandboxCredentials(),
  });
  const agent = new HarnessAgent({
    harness: createCodex({ auth: { OPENAI_API_KEY } }),
    model: process.env.CODEX_MODEL || 'gpt-5.3-codex',
    sandbox: createVercelSandbox({ sandbox }),
    sandboxConfig: { workDir: sandbox.cwd },
    tools: {
      hostPing: tool({
        description: 'Ping the Express server and get its current time.',
        inputSchema: z.object({}),
        execute: async () => ({
          executedOn: 'host',
          time: new Date().toISOString(),
        }),
      }),
    },
    instructions:
      'Work in the checked-out PrairieLearn course. Use your native file and shell tools to fulfill requests. Preserve existing course conventions and keep replies brief.',
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
