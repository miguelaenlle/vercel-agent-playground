import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  getHarnessErrorMessage,
  type HarnessAgentSession,
  type HarnessAgentResumeSessionState,
} from '@ai-sdk/harness/agent';
import { createSandboxAgent } from './sandbox.js';
import { reportError } from './errors.js';
import { startSandboxLifecycle } from './sandbox-lifecycle.js';
import {
  consumeStream,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { config } from 'dotenv';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';

export type Conversation = {
  id: string;
  messages: UIMessage[];
  expiresAt: number | null;
  state:
    'offline' | 'starting' | 'waiting_for_agent' | 'waiting_for_user' | 'error';
  waitingSince: number | null;
};

export function createApp() {
  const app = express();
  const conversations = new Map<string, Conversation>();
  const running = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  type Runtime = Awaited<ReturnType<typeof createSandboxAgent>> & {
    session?: HarnessAgentSession;
    resumeFrom?: HarnessAgentResumeSessionState;
  };
  const liveSandboxes = new Map<string, Runtime>();

  const stopLifecycle = startSandboxLifecycle(
    conversations,
    liveSandboxes,
    (id, error) => {
      conversations.get(id)!.state = 'error';
      running.get(id)?.controller.abort();
      reportError(`Sandbox lifecycle ${id}`, error);
    },
  );
  app.use('/api', (req, res, next) => {
    const host = req.get('host');
    if (
      !host ||
      !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
      (req.get('origin') && req.get('origin') !== `http://${host}`)
    ) {
      return res.sendStatus(403);
    }
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/conversations', (_req, res) =>
    res.json([...conversations.values()]),
  );
  app.post('/api/conversations', (_req, res) => {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      messages: [],
      expiresAt: null,
      state: 'offline',
      waitingSince: null,
    };
    conversations.set(conversation.id, conversation);
    res.json(conversation);
  });
  app.post('/api/conversations/:id/chat', async (req, res) => {
    const conversation = conversations.get(req.params.id);
    if (!conversation) return res.status(404).send('Conversation not found.');
    if (running.has(conversation.id))
      return res.status(409).send('A turn is already running.');
    if (conversation.state === 'error')
      return res
        .status(409)
        .send('Sandbox unavailable. Start a new conversation.');
    const controller = new AbortController();
    let finish!: () => void;
    running.set(conversation.id, {
      controller,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    let drain = Promise.resolve();
    let failed = false;
    let stage = 'Validating message';
    const onError = (error: unknown) => {
      failed = true;
      conversation.state = 'error';
      reportError(stage, error);
      const message = getHarnessErrorMessage(error);
      return message === 'An error occurred.'
        ? `${stage} failed. See the server terminal for details.`
        : message;
    };
    try {
      const message = z
        .object({
          role: z.literal('user'),
          parts: z
            .array(z.object({ type: z.literal('text'), text: z.string() }))
            .min(1),
        })
        .parse(req.body.messages?.at(-1));
      const prompt = message.parts.map((part) => part.text).join('\n');
      await pipeUIMessageStreamToResponse({
        response: res,
        stream: createUIMessageStream({
          originalMessages: req.body.messages,
          execute: async ({ writer }) => {
            conversation.state = 'starting';
            conversation.waitingSince = null;
            let runtime = liveSandboxes.get(conversation.id);
            if (!runtime) {
              stage = 'Creating sandbox';
              runtime = {
                ...(await createSandboxAgent(conversation.id)),
              };
              liveSandboxes.set(conversation.id, runtime);
            }
            // A command auto-resumes a stopped persistent sandbox before attachment.
            stage = 'Resuming sandbox';
            await runtime.sandbox.runCommand({ cmd: 'true' });
            stage = 'Starting Codex';
            runtime.session = await runtime.agent.createSession({
              sessionId: conversation.id,
              resumeFrom: runtime.resumeFrom,
              abortSignal: controller.signal,
            });
            // The native session owns history; send only this turn's new text.
            conversation.state = 'waiting_for_agent';
            stage = 'Running Codex';
            const result = await runtime.agent.stream({
              session: runtime.session,
              prompt,
              abortSignal: controller.signal,
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
        const runtime = liveSandboxes.get(conversation.id);
        if (runtime) {
          if (runtime.session && !runtime.session.hasUnfinishedTurn()) {
            stage = 'Saving Codex session';
            runtime.resumeFrom = await runtime.session.detach();
            runtime.session = undefined;
            if (!failed && !controller.signal.aborted) {
              conversation.waitingSince = Date.now();
              conversation.state = 'waiting_for_user';
            } else {
              conversation.state = 'error';
            }
          } else {
            conversation.state = 'error';
          }
        }
      } catch (error) {
        reportError(stage, error);
        conversation.state = 'error';
      } finally {
        running.delete(conversation.id);
        finish();
      }
    }
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    reportError('Request', error);
    if (res.headersSent) res.end();
    else
      res
        .status(400)
        .send('Request failed. Check the message and server configuration.');
  };
  app.use(errors);
  return {
    app,
    close: async () => {
      stopLifecycle();
      const turns = [...running.values()];
      for (const { controller } of turns) controller.abort();
      await Promise.all(turns.map(({ done }) => done));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  config({ path: '.env.local', quiet: true });
  const { app, close } = createApp();
  const server = createServer(app);
  if (process.argv.includes('--production')) {
    app.use(express.static(resolve('dist/client')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
    });
    app.use(vite.middlewares);
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close();
      void close().finally(() => process.exit());
    });
  }
  const port = Number(process.env.PORT || 4310);
  server.listen(port, '127.0.0.1', () =>
    console.log(`http://localhost:${port}`),
  );
}
