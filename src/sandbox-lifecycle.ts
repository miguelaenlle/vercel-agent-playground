import { Sandbox } from '@vercel/sandbox';
import { z } from 'zod';
import type { Conversation } from './conversation.js';
import { sandboxActiveRuntimeMs, sandboxCredentials } from './sandbox.js';

const REQUEST_TIMEOUT_MS = 15_000;

export function startSandboxLifecycle(
  conversations: Map<string, Conversation>,
  sandboxes: Map<string, { sandbox: Sandbox }>,
  onError: (id: string, error: unknown) => void,
) {
  const activeRuntimeMs = sandboxActiveRuntimeMs();
  const checkIntervalMs = Math.min(60_000, activeRuntimeMs / 3);
  const idleMs =
    z.coerce
      .number()
      .positive()
      .max(1440)
      .parse(process.env.SANDBOX_IDLE_MINUTES || 10) * 60_000;
  const previousStates = new Map<string, Conversation['state']>();
  let checking = false;
  let stopped = false;
  let nextCheckAt = Date.now() + checkIntervalMs;

  async function checkSandbox(id: string, sandbox: Sandbox) {
    const conversation = conversations.get(id)!;
    const state = conversation.state;
    const previousState = previousStates.get(id);
    previousStates.set(id, state);
    if (state === 'offline' || state === 'error') return;

    try {
      const deadline = sandbox.expiresAt?.getTime();
      conversation.expiresAt = deadline ?? null;
      if (!deadline) return;

      if (deadline <= Date.now()) {
        await confirmStopped(conversation, sandbox);
        return;
      }

      // Idle: grant one allowance when first observed, then let Vercel expire it.
      if (state === 'waiting_for_user') {
        if (previousState !== state) {
          await extendUntil(conversation, sandbox, Date.now() + idleMs);
        }
        return;
      }

      // Starting or working: top up to the configured active TTL.
      await extendUntil(conversation, sandbox, Date.now() + activeRuntimeMs);
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
    // The API adds time; add only the difference to avoid accumulating unused TTL.
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

  const timer = setInterval(() => {
    nextCheckAt = Date.now() + checkIntervalMs;
    void checkAllSandboxes();
  }, checkIntervalMs);
  timer.unref();
  return {
    getStatus: () => ({
      nextCheckAt,
      checking,
      activeRuntimeMs,
      checkIntervalMs,
    }),
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
