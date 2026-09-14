import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';

export function sandboxProvider() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  return createVercelSandbox({
    runtime: 'node24',
    ports: [4000],
    timeout: 30 * 60 * 1000,
    persistent: false,
    ...(VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
      ? {
          token: VERCEL_TOKEN,
          teamId: VERCEL_TEAM_ID,
          projectId: VERCEL_PROJECT_ID,
        }
      : {}),
  });
}
