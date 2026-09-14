import express from 'express';
import { start } from 'workflow/api';
import { z } from 'zod';
import { sandboxLifecycle } from './workflow.js';

const app = express();
app.use(express.json());
app.post('/api/lifecycle', async (req, res) => {
  if (
    !process.env.LIFECYCLE_SECRET ||
    req.get('authorization') !== `Bearer ${process.env.LIFECYCLE_SECRET}`
  ) {
    return res.sendStatus(401);
  }
  const { sessionId, idleMs } = z
    .object({
      sessionId: z.uuid(),
      idleMs: z
        .number()
        .positive()
        .max(24 * 60 * 60 * 1000),
    })
    .parse(req.body);
  const run = await start(sandboxLifecycle, [sessionId, idleMs]);
  const reader = run.readable.getReader();
  try {
    const { value: url, done } = await reader.read();
    if (done) throw new Error('Workflow did not publish its webhook.');
    res.json({ url });
  } finally {
    reader.releaseLock();
  }
});
export default app;
