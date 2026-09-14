import { randomUUID } from 'node:crypto';
import {
  APICallError,
  consumeStream,
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  toUIMessageStream,
  type LanguageModel,
} from 'ai';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { Conversation } from '../shared/types.js';
import { createNotesAgent } from './agent.js';

class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const UserMessage = z.object({
  id: z.string().min(1).max(100),
  role: z.literal('user'),
  parts: z
    .array(z.object({ type: z.literal('text'), text: z.string() }))
    .min(1)
    .max(10),
});
const ChatRequest = z.object({ message: UserMessage });

function providerError(error: unknown) {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return 'OpenAI rejected the API key. Check .env.local and restart the server.';
    }
    if (error.statusCode === 429) {
      return 'OpenAI quota or rate limit reached. Check API billing and usage, then try again.';
    }
    if (error.statusCode === 404)
      return 'The configured OpenAI model is unavailable to this API key.';
  }
  return 'The model request failed. Check your connection, API key, and model configuration.';
}

export function createApp({
  model,
  modelId,
  turnTimeoutMs = 90_000,
}: {
  model?: LanguageModel;
  modelId: string;
  turnTimeoutMs?: number;
}) {
  const app = express();
  const conversations = new Map<string, Conversation>();
  let active: {
    conversationId: string;
    controller: AbortController;
    done: Promise<void>;
  } | null = null;

  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    const host = req.get('host');
    const origin = req.get('origin');
    if (!host || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      return res
        .status(403)
        .json({ error: 'This playground is available on localhost only.' });
    }
    if (origin && origin !== `http://${host}`) {
      return res
        .status(403)
        .json({ error: 'Cross-origin requests are not allowed.' });
    }
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  function getConversation(id: string) {
    const conversation = conversations.get(id);
    if (!conversation)
      throw new RequestError(
        404,
        'Conversation not found. The server may have restarted.',
      );
    return conversation;
  }

  app.get('/api/config', (_req, res) => {
    res.json({
      model: modelId,
      configured: Boolean(model),
      activeConversationId: active?.conversationId ?? null,
    });
  });
  app.get('/api/conversations', (_req, res) => {
    res.json(
      [...conversations.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ messages: _messages, notes: _notes, ...summary }) => summary),
    );
  });
  app.post('/api/conversations', (_req, res) => {
    if (conversations.size >= 30)
      throw new RequestError(
        409,
        'Delete a conversation before creating more (limit: 30).',
      );
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      messages: [],
      notes: {},
    };
    conversations.set(conversation.id, conversation);
    res.status(201).json(conversation);
  });
  app.get('/api/conversations/:id', (req, res) =>
    res.json(getConversation(req.params.id)),
  );
  app.post('/api/conversations/:id/stop', async (req, res) => {
    getConversation(req.params.id);
    if (active?.conversationId === req.params.id) {
      active.controller.abort();
      await active.done;
    }
    res.sendStatus(204);
  });
  app.delete('/api/conversations/:id', async (req, res) => {
    getConversation(req.params.id);
    if (active?.conversationId === req.params.id) {
      active.controller.abort();
      await active.done;
    }
    conversations.delete(req.params.id);
    res.sendStatus(204);
  });

  app.post('/api/conversations/:id/chat', async (req, res) => {
    const conversation = getConversation(req.params.id);
    const { message } = ChatRequest.parse(req.body);
    const text = message.parts
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (!text || text.length > 8000)
      throw new RequestError(400, 'Send between 1 and 8,000 characters.');
    if (!model)
      throw new RequestError(
        503,
        'Add OPENAI_API_KEY to .env.local and restart the server.',
      );
    if (conversation.messages.some((item) => item.id === message.id)) {
      throw new RequestError(
        409,
        'This message was already submitted. Reload the conversation to see its result.',
      );
    }
    if (active)
      throw new RequestError(
        409,
        'An agent is already running. Stop it before starting another turn.',
      );
    if (conversation.messages.length >= 100)
      throw new RequestError(
        409,
        'Start a new conversation (limit: 50 turns).',
      );

    const controller = new AbortController();
    let release!: () => void;
    active = {
      conversationId: conversation.id,
      controller,
      done: new Promise((resolve) => {
        release = resolve;
      }),
    };
    const timer = setTimeout(
      () => controller.abort(new Error('Turn time limit reached.')),
      turnTimeoutMs,
    );
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', onClose);
    conversation.status = 'running';
    conversation.error = undefined;
    conversation.messages.push({ ...message, parts: [{ type: 'text', text }] });
    if (conversation.messages.length === 1)
      conversation.title = text.slice(0, 55);
    conversation.updatedAt = new Date().toISOString();
    let drain = Promise.resolve();
    try {
      const agent = createNotesAgent(model, conversation);
      const result = await agent.stream({
        messages: await convertToModelMessages(conversation.messages, {
          tools: agent.tools,
          ignoreIncompleteToolCalls: true,
        }),
        abortSignal: controller.signal,
      });
      const stream = toUIMessageStream({
        stream: result.stream,
        tools: agent.tools,
        originalMessages: conversation.messages,
        generateMessageId: randomUUID,
        sendReasoning: false,
        onError: (error) => {
          conversation.error = providerError(error);
          return conversation.error;
        },
        onEnd: ({ messages }) => {
          conversation.messages = messages;
        },
      });
      await pipeUIMessageStreamToResponse({
        response: res,
        stream,
        // Drain the SDK stream after abort so its final callback saves partial messages.
        consumeSseStream: ({ stream }) => {
          drain = consumeStream({ stream });
        },
      });
    } catch (error) {
      if (!controller.signal.aborted) conversation.error = providerError(error);
      if (!res.headersSent && !res.destroyed)
        res
          .status(502)
          .json({ error: conversation.error ?? 'The turn was stopped.' });
      else if (!res.destroyed) res.end();
    } finally {
      await drain;
      clearTimeout(timer);
      res.off('close', onClose);
      conversation.status = controller.signal.aborted
        ? 'interrupted'
        : conversation.error
          ? 'error'
          : 'ready';
      conversation.updatedAt = new Date().toISOString();
      active = null;
      release();
    }
  });

  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'Unknown API route.' }),
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status =
      error instanceof RequestError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : typeof error === 'object' &&
              error !== null &&
              'status' in error &&
              error.status === 413
            ? 413
            : 500;
    res.status(status).json({
      error:
        error instanceof RequestError
          ? error.message
          : status === 400
            ? 'Invalid request. Send a new text message.'
            : status === 413
              ? 'The request is too large.'
              : 'Something went wrong. Please try again.',
    });
  };
  app.use(errors);
  return { app, abortActive: () => active?.controller.abort() };
}
