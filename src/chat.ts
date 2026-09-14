import { getHarnessErrorMessage } from '@ai-sdk/harness/agent';
import {
  consumeStream,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import type { ServerResponse } from 'node:http';
import type { Conversation } from './conversation.js';
import { createSandboxAgent, type SandboxRuntime } from './sandbox.js';
import { reportError } from './errors.js';

export async function streamConversation({
  conversation,
  liveSandboxes,
  messages,
  prompt,
  response,
  signal,
}: {
  conversation: Conversation;
  liveSandboxes: Map<string, SandboxRuntime>;
  messages: UIMessage[];
  prompt: string;
  response: ServerResponse;
  signal: AbortSignal;
}) {
  let drain = Promise.resolve();
  let failed = false;
  let stage = 'Starting conversation';
  const onError = (error: unknown) => {
    failed = true;
    conversation.state = 'error';
    reportError(stage, error);
    const message = getHarnessErrorMessage(error);
    return message === 'An error occurred.'
      ? `${stage} failed. See the server terminal for details.`
      : message;
  };
  async function finishTurn() {
    const runtime = liveSandboxes.get(conversation.id);
    if (!runtime) return;
    if (!runtime.session || runtime.session.hasUnfinishedTurn()) {
      conversation.state = 'error';
      return;
    }

    stage = 'Saving Codex session';
    runtime.resumeFrom = await runtime.session.detach();
    runtime.session = undefined;
    if (failed || signal.aborted) {
      conversation.state = 'error';
      return;
    }

    conversation.waitingSince = Date.now();
    conversation.state = 'waiting_for_user';
  }

  try {
    await pipeUIMessageStreamToResponse({
      response,
      stream: createUIMessageStream({
        originalMessages: messages,
        execute: async ({ writer }) => {
          conversation.state = 'starting';
          conversation.waitingSince = null;
          let runtime = liveSandboxes.get(conversation.id);
          if (!runtime) {
            stage = 'Creating sandbox';
            runtime = await createSandboxAgent(conversation.id);
            liveSandboxes.set(conversation.id, runtime);
          }
          // A command auto-resumes a stopped persistent sandbox before attachment.
          stage = 'Resuming sandbox';
          await runtime.sandbox.runCommand({ cmd: 'true' });
          stage = 'Starting Codex';
          runtime.session = await runtime.agent.createSession({
            sessionId: conversation.id,
            resumeFrom: runtime.resumeFrom,
            abortSignal: signal,
          });
          // The native session owns history; send only this turn's new text.
          conversation.state = 'waiting_for_agent';
          stage = 'Running Codex';
          const result = await runtime.agent.stream({
            session: runtime.session,
            prompt,
            abortSignal: signal,
            timeout: 5 * 60 * 1000,
          });
          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              onError,
            }),
          );
        },
        onEnd: ({ messages }) => {
          conversation.messages = messages;
        },
        onError,
      }),
      consumeSseStream: ({ stream }) => {
        drain = consumeStream({ stream });
      },
    });
  } finally {
    try {
      await drain;
      await finishTurn();
    } catch (error) {
      reportError(stage, error);
      conversation.state = 'error';
    }
  }
}
