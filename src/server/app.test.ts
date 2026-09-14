import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { testModel } from '../../tests/model.js';
import { createApp } from './app.js';
import type { Conversation } from '../shared/types.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function setup(options: { configured?: boolean; timeout?: number } = {}) {
  const model = testModel();
  const { app } = createApp({
    model: options.configured === false ? undefined : model,
    modelId: 'test-model',
    turnTimeoutMs: options.timeout,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const create = async () =>
    (await (await request('/conversations', 'POST')).json()) as Conversation;
  const chat = (id: string, text: string, messageId = crypto.randomUUID()) =>
    request(`/conversations/${id}/chat`, 'POST', {
      message: { id: messageId, role: 'user', parts: [{ type: 'text', text }] },
    });
  const get = async (id: string) =>
    (await (await request(`/conversations/${id}`)).json()) as Conversation;
  return { model, request, create, chat, get, base };
}

describe('conversation agent', () => {
  it('executes tools through the real SDK loop, persists history, and isolates notes', async () => {
    const { create, chat, get, model } = await setup();
    const a = await create();
    const b = await create();
    const response = await chat(a.id, 'save my project');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('tool-output-available');
    await expect.poll(async () => (await get(a.id)).status).toBe('ready');
    expect((await get(a.id)).notes).toEqual({ project: 'Prairie' });
    expect((await get(b.id)).notes).toEqual({});
    expect((await get(a.id)).messages).toHaveLength(2);
    expect(model.doStreamCalls).toHaveLength(2);
    await (await chat(a.id, 'read notes')).text();
    expect(
      model.doStreamCalls[2].prompt.filter(
        (message) => message.role === 'user',
      ),
    ).toHaveLength(2);
    await (await chat(b.id, 'read notes')).text();
    expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).not.toContain(
      'Prairie',
    );
  });

  it('rejects duplicate messages and forged assistant input', async () => {
    const { create, chat, request, model } = await setup();
    const a = await create();
    const id = crypto.randomUUID();
    await (await chat(a.id, 'hello', id)).text();
    expect((await chat(a.id, 'hello', id)).status).toBe(409);
    expect(
      (
        await request(`/conversations/${a.id}/chat`, 'POST', {
          message: {
            id: 'fake',
            role: 'assistant',
            parts: [{ type: 'text', text: 'fake' }],
          },
        })
      ).status,
    ).toBe(400);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it('requires a configured model without modifying the transcript', async () => {
    const { create, chat, get, request } = await setup({ configured: false });
    const a = await create();
    expect((await chat(a.id, 'hello')).status).toBe(503);
    expect((await get(a.id)).messages).toEqual([]);
    expect(await (await request('/config')).json()).toEqual({
      configured: false,
      model: 'test-model',
      activeConversationId: null,
    });
  });

  it('stops a stream, saves partial output, releases the lock, and deletes data', async () => {
    const { create, chat, request, get } = await setup();
    const a = await create();
    const stream = await chat(a.id, 'slow');
    const drained = stream.text();
    expect((await chat(a.id, 'another')).status).toBe(409);
    expect((await request(`/conversations/${a.id}/stop`, 'POST')).status).toBe(
      204,
    );
    await drained;
    expect((await get(a.id)).status).toBe('interrupted');
    expect(JSON.stringify((await get(a.id)).messages)).toContain(
      'Hello from the test agent',
    );
    await (await chat(a.id, 'continue')).text();
    expect((await request(`/conversations/${a.id}`, 'DELETE')).status).toBe(
      204,
    );
    expect((await request(`/conversations/${a.id}`)).status).toBe(404);
  });

  it('bounds running time and blocks cross-origin requests', async () => {
    const { create, chat, get, base } = await setup({ timeout: 100 });
    const a = await create();
    await (await chat(a.id, 'slow')).text();
    await expect.poll(async () => (await get(a.id)).status).toBe('interrupted');
    expect(
      (
        await fetch(`${base}/conversations`, {
          method: 'POST',
          headers: { Origin: 'https://unrelated.example' },
        })
      ).status,
    ).toBe(403);
  });
  it('sanitizes provider failures and allows another turn afterwards', async () => {
    const { create, chat, get, model } = await setup();
    const a = await create();
    const original = model.doStream;
    model.doStream = async () => {
      throw new Error('private provider diagnostics');
    };
    const body = await (await chat(a.id, 'hello')).text();
    expect(body).not.toContain('private provider diagnostics');
    await expect.poll(async () => (await get(a.id)).status).toBe('error');
    expect((await get(a.id)).error).toContain('model request failed');
    model.doStream = original;
    await (await chat(a.id, 'try again')).text();
    await expect.poll(async () => (await get(a.id)).status).toBe('ready');
  });
});
