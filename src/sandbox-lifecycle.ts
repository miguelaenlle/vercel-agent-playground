import { Sandbox } from '@vercel/sandbox';
import { z } from 'zod';
import type { Conversation } from './conversation.js';
import { ACTIVE_RUNTIME_MS, sandboxCredentials } from './sandbox.js';

const CHECK_INTERVAL_MS = 1000;
const RENEW_BELOW_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

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

  async function checkSandbox(id: string, sandbox: Sandbox) {
    const conversation = conversations.get(id)!;
    const state = conversation.state;
    if (state === 'offline' || state === 'error') return;

    try {
      const deadline = sandbox.expiresAt?.getTime();
      conversation.expiresAt = deadline ?? null;
      if (!deadline) return;

      if (deadline <= Date.now()) {
        await confirmStopped(conversation, sandbox);
        return;
      }

      if (state === 'waiting_for_user') {
        // Use the transition time so checking an idle conversation never extends its wait.
        await extendUntil(
          conversation,
          sandbox,
          conversation.waitingSince! + idleMs,
        );
        return;
      }

      if (deadline - Date.now() < RENEW_BELOW_MS) {
        await extendUntil(
          conversation,
          sandbox,
          Date.now() + ACTIVE_RUNTIME_MS,
        );
      }
    } catch (error) {
      if (!stopped && conversation.state === state) onError(id, error);
    }
  }

  async function confirmStopped(conversation: Conversation, sandbox: Sandbox) {
    const state = conversation.state;
    // Startup owns resuming the VM. A metadata check must not wake it or race that transition.
    if (state === 'starting') return;
    const current = await Sandbox.get({
      name: sandbox.name,
      resume: false,
      ...sandboxCredentials(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (stopped || conversation.state !== state || current.status !== 'stopped')
      return;
    if (state === 'waiting_for_agent')
      throw new Error('Sandbox stopped during the agent turn.');
    conversation.state = 'offline';
  }

  async function extendUntil(
    conversation: Conversation,
    sandbox: Sandbox,
    target: number,
  ) {
    const extension = Math.ceil(target - sandbox.expiresAt!.getTime());
    // Vercel rejects extensions shorter than one second.
    if (extension < 1000) return;
    await sandbox.extendTimeout(extension, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    conversation.expiresAt = sandbox.expiresAt!.getTime();
  }

  async function checkAllSandboxes() {
    if (checking || stopped) return;
    checking = true;
    try {
      await Promise.all(
        [...sandboxes].map(([id, { sandbox }]) => checkSandbox(id, sandbox)),
      );
    } finally {
      checking = false;
    }
  }

  const timer = setInterval(() => void checkAllSandboxes(), CHECK_INTERVAL_MS);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
