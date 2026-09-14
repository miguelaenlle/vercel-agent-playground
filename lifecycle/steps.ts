import { getWritable, type RequestWithResponse } from 'workflow';
import { sandboxProvider } from '../src/sandbox-provider.js';

export async function publishWebhook(url: string) {
  'use step';
  const writer = getWritable<string>().getWriter();
  await writer.write(url);
  await writer.close();
}

export async function acknowledge(
  request: RequestWithResponse,
  idleDeadline: number | null,
) {
  'use step';
  await request.respondWith(Response.json({ idleDeadline }));
}

export async function destroySandbox(sessionId: string) {
  'use step';
  try {
    const session = await sandboxProvider().resumeSession!({ sessionId });
    await session.destroy();
  } catch (error) {
    // Deletion is retried by Workflow; an already deleted sandbox is success.
    if (!(
      error instanceof Error &&
      'response' in error &&
      error.response instanceof Response &&
      error.response.status === 404
    ))
      throw error;
  }
}
