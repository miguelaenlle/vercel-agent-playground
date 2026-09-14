import { createWebhook, sleep, type RequestWithResponse } from 'workflow';
import { acknowledge, destroySandbox, publishWebhook } from './steps.js';

export async function sandboxLifecycle(sessionId: string, idleMs: number) {
  'use workflow';
  {
    using webhook = createWebhook({ respondWith: 'manual' });
    await webhook.getConflict();
    await publishWebhook(webhook.url);
    const requests = webhook[Symbol.asyncIterator]();
    let idleDeadline: number | null = null;
    while (true) {
      const next = requests.next();
      const event: IteratorResult<RequestWithResponse> | null =
        idleDeadline === null
          ? await next
          : await Promise.race([
              next,
              sleep(new Date(idleDeadline)).then(() => null),
            ]);
      if (event === null || event.done) break;
      const { active }: { active: boolean } = await event.value.json();
      idleDeadline = active ? null : Date.now() + idleMs;
      // A turn cannot start until this workflow acknowledges it as active.
      await acknowledge(event.value, idleDeadline);
    }
  }
  // Disposing the webhook first prevents new turns from acquiring this sandbox.
  await destroySandbox(sessionId);
}
