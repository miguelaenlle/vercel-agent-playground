import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  getHarnessErrorMessage,
  type HarnessAgentSession,
} from '@ai-sdk/harness/agent';
import { createSandboxAgent } from './sandbox.js';
import { startLifecycle } from './lifecycle.js';
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
  idleDeadline: number | null;
  sandboxState: 'new' | 'active' | 'idle' | 'unavailable';
};

export function createApp() {
  const app = express();
  const conversations = new Map<string, Conversation>();
  const running = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  const sandboxes = new Map<
    string,
    {
      agent: ReturnType<typeof createSandboxAgent>;
      session: HarnessAgentSession;
      lifecycle: Awaited<ReturnType<typeof startLifecycle>>;
    }
  >();
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
      idleDeadline: null,
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
            let runtime = sandboxes.get(conversation.id);
            if (!runtime) {
              const sessionId = conversation.id;
              const agent = createSandboxAgent();
              const lifecycle = await startLifecycle(sessionId);
              try {
                const session = await agent.createSession({
                  sessionId,
                  abortSignal: controller.signal,
                });
                runtime = { agent, session, lifecycle };
                sandboxes.set(conversation.id, runtime);
              } catch (error) {
                await lifecycle.activity(false);
                throw error;
              }
            } else {
              await runtime.lifecycle.activity(true);
            }
            conversation.sandboxState = 'active';
            conversation.idleDeadline = null;
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
        const runtime = sandboxes.get(conversation.id);
        if (runtime && !runtime.session.hasUnfinishedTurn()) {
          const { idleDeadline } = await runtime.lifecycle.activity(false);
          conversation.idleDeadline = idleDeadline;
          conversation.sandboxState = failed ? 'unavailable' : 'idle';
        } else if (runtime) {
          // A disconnected stream alone does not prove the agent is idle.
          conversation.sandboxState = 'unavailable';
        }
      } catch {
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
