import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { testModel } from '../tests/model.js';
import { createApp, type Conversation } from './server.js';

it('runs the SDK tool loop and stores separate transcripts and notes', async () => {
  const model = testModel();
  const server = createServer(createApp(model));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/conversations`;
  try {
    const a: Conversation = await (
      await fetch(base, { method: 'POST' })
    ).json();
    const b: Conversation = await (
      await fetch(base, { method: 'POST' })
    ).json();
    const response = await fetch(`${base}/${a.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'user1',
            role: 'user',
            parts: [{ type: 'text', text: 'save project' }],
          },
        ],
      }),
    });
    expect(await response.text()).toContain('tool-output-available');
    const saved: Conversation[] = await (await fetch(base)).json();
    expect(saved.find((c) => c.id === a.id)?.notes).toEqual({
      project: 'Prairie',
    });
    expect(saved.find((c) => c.id === a.id)?.messages).toHaveLength(2);
    expect(saved.find((c) => c.id === b.id)?.notes).toEqual({});
    expect(model.doStreamCalls).toHaveLength(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
