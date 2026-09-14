import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Conversation } from './conversation.js';
import type { SandboxRuntime } from './sandbox.js';
import { streamConversation } from './chat.js';
import { reportError } from './errors.js';
import { startSandboxLifecycle } from './sandbox-lifecycle.js';
import { config } from 'dotenv';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';

export function createApp() {
  const app = express();
  const conversations = new Map<string, Conversation>();
  const running = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  const liveSandboxes = new Map<string, SandboxRuntime>();

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
    const message = z
      .object({
        role: z.literal('user'),
        parts: z
          .array(z.object({ type: z.literal('text'), text: z.string() }))
          .min(1),
      })
      .parse(req.body.messages?.at(-1));
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
    try {
      await streamConversation({
        conversation,
        liveSandboxes,
        messages: req.body.messages,
        prompt: message.parts.map((part) => part.text).join('\n'),
        response: res,
        signal: controller.signal,
      });
    } finally {
      running.delete(conversation.id);
      finish();
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
