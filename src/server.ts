import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openai } from '@ai-sdk/openai';
import {
  ToolLoopAgent,
  isStepCount,
  tool,
  pipeAgentUIStreamToResponse,
  consumeStream,
  type LanguageModel,
  type UIMessage,
} from 'ai';
import { config } from 'dotenv';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';

export type Conversation = {
  id: string;
  messages: UIMessage[];
  notes: Record<string, string>;
};

export function createApp(model: LanguageModel) {
  const app = express();
  const conversations = new Map<string, Conversation>();
  const running = new Set<string>();
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
      notes: {},
    };
    conversations.set(conversation.id, conversation);
    res.json(conversation);
  });
  app.post('/api/conversations/:id/chat', async (req, res) => {
    const conversation = conversations.get(req.params.id);
    if (!conversation) return res.status(404).send('Conversation not found.');
    if (running.has(conversation.id))
      return res.status(409).send('A turn is already running.');
    running.add(conversation.id);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    let drain = Promise.resolve();
    try {
      const agent = new ToolLoopAgent({
        model,
        instructions:
          'Use saveNote when asked to save information and readNotes when asked about saved information. Keep replies brief.',
        stopWhen: isStepCount(6),
        maxOutputTokens: 1500,
        maxRetries: 0,
        tools: {
          saveNote: tool({
            description: 'Save a note in this conversation.',
            inputSchema: z.object({
              key: z.string().max(80),
              value: z.string().max(2000),
            }),
            execute: ({ key, value }) => {
              conversation.notes = { ...conversation.notes, [key]: value };
              return { key, value };
            },
          }),
          readNotes: tool({
            description: 'Read this conversation’s notes.',
            inputSchema: z.object({}),
            execute: () => conversation.notes,
          }),
        },
      });
      await pipeAgentUIStreamToResponse({
        response: res,
        agent,
        uiMessages: req.body.messages,
        abortSignal: controller.signal,
        timeout: 90_000,
        onEnd: ({ messages }) => {
          conversation.messages = messages;
        },
        onError: () =>
          'Model request failed. Check your OpenAI key, billing, and model.',
        // Let the SDK finish saving the transcript even if the browser disconnects.
        consumeSseStream: ({ stream }) => {
          drain = consumeStream({ stream });
        },
      });
    } finally {
      await drain;
      running.delete(conversation.id);
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
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  config({ path: '.env.local', quiet: true });
  const app = createApp(openai(process.env.OPENAI_MODEL || 'gpt-4.1-mini'));
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
  const port = Number(process.env.PORT || 4310);
  server.listen(port, '127.0.0.1', () =>
    console.log(`http://localhost:${port}`),
  );
}
