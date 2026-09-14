import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  getHarnessErrorMessage,
  type HarnessAgentSession,
  type HarnessAgentResumeSessionState,
} from '@ai-sdk/harness/agent';
import { createSandboxAgent } from './sandbox.js';
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
  sandboxState: 'new' | 'active' | 'idle' | 'unavailable';
};

export function createApp() {
  const app = express();
  const conversations = new Map<string, Conversation>();
  const running = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  const idleMs =
    z.coerce
      .number()
      .positive()
      .max(1440)
      .parse(process.env.SANDBOX_IDLE_MINUTES || 10) * 60_000;
  type Runtime = Awaited<ReturnType<typeof createSandboxAgent>> & {
    session?: HarnessAgentSession;
    resumeFrom?: HarnessAgentResumeSessionState;
    active: boolean;
    renewal: Promise<void>;
  };
  const liveSandboxes = new Map<string, Runtime>();

  function renew(
    id: string,
    runtime: Runtime,
    duration: number,
    heartbeat = false,
  ) {
    // Serialize extensions so overlapping calls cannot add the same time twice.
    runtime.renewal = runtime.renewal
      .catch(() => {})
      .then(async () => {
        if (heartbeat && !runtime.active) return;
        const deadline = runtime.sandbox.expiresAt?.getTime();
        if (!deadline || deadline <= Date.now())
          throw new Error('Sandbox runtime expired.');
        const extension = Math.ceil(Date.now() + duration - deadline);
        if (extension > 0)
          await runtime.sandbox.extendTimeout(extension, {
            signal: AbortSignal.timeout(15_000),
          });
        conversations.get(id)!.expiresAt = runtime.sandbox.expiresAt!.getTime();
      });
    return runtime.renewal;
  }

  const heartbeat = setInterval(() => {
    for (const [id, runtime] of liveSandboxes) {
      if (!runtime.active) continue;
      void renew(id, runtime, 3 * 60_000, true).catch(() => {
        runtime.active = false;
        conversations.get(id)!.sandboxState = 'unavailable';
        running.get(id)?.controller.abort();
        console.error('Sandbox heartbeat failed:', id);
      });
    }
  }, 60_000);
  heartbeat.unref();
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
      sandboxState: 'new',
    };
    conversations.set(conversation.id, conversation);
    res.json(conversation);
  });
  app.post('/api/conversations/:id/chat', async (req, res) => {
    const conversation = conversations.get(req.params.id);
    if (!conversation) return res.status(404).send('Conversation not found.');
    if (running.has(conversation.id))
      return res.status(409).send('A turn is already running.');
    if (conversation.sandboxState === 'unavailable')
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
            let runtime = liveSandboxes.get(conversation.id);
            if (!runtime) {
              runtime = {
                ...(await createSandboxAgent(conversation.id)),
                active: false,
                renewal: Promise.resolve(),
              };
              liveSandboxes.set(conversation.id, runtime);
            }
            conversation.sandboxState = 'active';
            // A command auto-resumes a stopped persistent sandbox before attachment.
            await runtime.sandbox.runCommand({ cmd: 'true' });
            await renew(conversation.id, runtime, 3 * 60_000);
            runtime.active = true;
            runtime.session = await runtime.agent.createSession({
              sessionId: conversation.id,
              resumeFrom: runtime.resumeFrom,
              abortSignal: controller.signal,
            });
            // The native session owns history; send only this turn's new text.
            const result = await runtime.agent.stream({
              session: runtime.session,
              prompt,
              abortSignal: controller.signal,
              timeout: 5 * 60 * 1000,
            });
            writer.merge(
              toUIMessageStream({
                stream: result.stream,
                onError: getHarnessErrorMessage,
              }),
            );
          },
          onEnd: ({ messages }) => {
            conversation.messages = messages;
          },
          onError: (error) => {
            failed = true;
            conversation.sandboxState = 'unavailable';
            return getHarnessErrorMessage(error);
          },
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
          runtime.active = false;
          if (runtime.session && !runtime.session.hasUnfinishedTurn()) {
            runtime.resumeFrom = await runtime.session.detach();
            runtime.session = undefined;
            if (!failed && !controller.signal.aborted) {
              await renew(conversation.id, runtime, idleMs);
              conversation.sandboxState = 'idle';
            } else {
              conversation.sandboxState = 'unavailable';
            }
          } else {
            conversation.sandboxState = 'unavailable';
          }
        }
      } catch {
        const runtime = liveSandboxes.get(conversation.id);
        if (runtime) runtime.active = false;
        conversation.sandboxState = 'unavailable';
      } finally {
        running.delete(conversation.id);
        finish();
      }
    }
  });
  const errors: ErrorRequestHandler = (_error, _req, res, _next) => {
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
      clearInterval(heartbeat);
      for (const runtime of liveSandboxes.values()) runtime.active = false;
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
