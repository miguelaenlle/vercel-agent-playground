import { Sandbox } from '@vercel/sandbox';
import { z } from 'zod';
import type { Conversation } from './server.js';
import { sandboxCredentials } from './sandbox.js';

export function startSandboxLifecycle(
  conversations: Map<string, Conversation>,
  sandboxes: Map<string, { sandbox: Sandbox }>,
  onError: (id: string, error: unknown) => void,
) {
  const idleMs =
    z.coerce
      .number()
      .positive()
      .max(1440)
      .parse(process.env.SANDBOX_IDLE_MINUTES || 10) * 60_000;
  let checking = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void Promise.all(
      [...sandboxes].map(async ([id, { sandbox }]) => {
        const conversation = conversations.get(id)!;
        const state = conversation.state;
        if (state === 'offline' || state === 'error') return;
        try {
          const deadline = sandbox.expiresAt?.getTime();
          conversation.expiresAt = deadline ?? null;
          if (!deadline) return;
          if (deadline <= Date.now()) {
            // Startup owns resuming the VM. Metadata checks must never wake it.
            if (state === 'starting') return;
            const current = await Sandbox.get({
              name: sandbox.name,
              resume: false,
              ...sandboxCredentials(),
              signal: AbortSignal.timeout(15_000),
            });
            if (stopped || conversation.state !== state) return;
            if (current.status === 'stopped') {
              if (state === 'waiting_for_agent')
                throw new Error('Sandbox stopped during the agent turn.');
              conversation.state = 'offline';
            }
            return;
          }
          const target =
            state === 'waiting_for_user'
              ? conversation.waitingSince! + idleMs
              : Date.now() + 3 * 60_000;
          // Check locally each second; renew active VMs only below two minutes.
          if (
            state !== 'waiting_for_user' &&
            deadline - Date.now() >= 2 * 60_000
          )
            return;
          const extension = Math.ceil(target - deadline);
          if (extension >= 1000) {
            await sandbox.extendTimeout(extension, {
              signal: AbortSignal.timeout(15_000),
            });
            conversation.expiresAt = sandbox.expiresAt!.getTime();
          }
        } catch (error) {
          if (!stopped && conversation.state === state) onError(id, error);
        }
      }),
    ).finally(() => {
      checking = false;
    });
  }, 1000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
