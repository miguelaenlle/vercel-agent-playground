import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { config } from 'dotenv';
import express from 'express';
import { z } from 'zod';
import { createApp } from './app.js';

config({ path: ['.env.local', '.env'], quiet: true });
const env = z
  .object({
    OPENAI_API_KEY: z.string().trim().optional(),
    OPENAI_MODEL: z.string().trim().min(1).default('gpt-4.1-mini'),
    PORT: z.coerce.number().int().min(1024).max(65535).default(4310),
  })
  .parse(process.env);

const { app, abortActive } = createApp({
  modelId: env.OPENAI_MODEL,
  model: env.OPENAI_API_KEY
    ? createOpenAI({ apiKey: env.OPENAI_API_KEY })(env.OPENAI_MODEL)
    : undefined,
});
const server = createServer(app);
if (process.argv.includes('--production')) {
  app.use(express.static(resolve('dist/client')));
  app.get('/{*path}', (_req, res) =>
    res.sendFile(resolve('dist/client/index.html')),
  );
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
  });
  app.use(vite.middlewares);
}
server.listen(env.PORT, '127.0.0.1', () => {
  console.log(`Agent playground: http://localhost:${env.PORT}`);
  console.log(
    `OpenAI: ${env.OPENAI_API_KEY ? 'configured' : 'add OPENAI_API_KEY to .env.local'} · model: ${env.OPENAI_MODEL}`,
  );
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    abortActive();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
