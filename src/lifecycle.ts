import { HarnessError } from '@ai-sdk/harness/agent';
import { z } from 'zod';

export async function startLifecycle(sessionId: string) {
  const { LIFECYCLE_URL, LIFECYCLE_SECRET } = process.env;
  if (!LIFECYCLE_URL || !LIFECYCLE_SECRET)
    throw new HarnessError({
      message:
        'Set LIFECYCLE_URL and LIFECYCLE_SECRET in .env.local (see README).',
    });
  const minutes = z.coerce
    .number()
    .positive()
    .max(1440)
    .parse(process.env.SANDBOX_IDLE_MINUTES || 10);
  const response = await fetch(new URL('/api/lifecycle', LIFECYCLE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LIFECYCLE_SECRET}`,
    },
    body: JSON.stringify({ sessionId, idleMs: minutes * 60_000 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new HarnessError({
      message:
        'Could not start the sandbox lifecycle workflow. Check its deployment and secret.',
    });
  const { url } = z.object({ url: z.url() }).parse(await response.json());
  return {
    async activity(active: boolean) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok)
        throw new HarnessError({
          message:
            'Sandbox lifecycle unavailable or expired. Start a new conversation.',
        });
      return z
        .object({ idleDeadline: z.number().nullable() })
        .parse(await response.json());
    },
  };
}
