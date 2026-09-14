import { MockLanguageModelV4 } from 'ai/test';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export function testModel() {
  return new MockLanguageModelV4({
    doStream: async ({ prompt, abortSignal }) => {
      const last = prompt.at(-1);
      const user = prompt.findLast((message) => message.role === 'user');
      const text =
        user?.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('') ?? '';
      const tool = last?.role !== 'tool' && /save|read/i.test(text);
      const slow = text === 'slow';
      return {
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            if (tool) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: crypto.randomUUID(),
                toolName: /save/i.test(text) ? 'saveNote' : 'readNotes',
                input: /save/i.test(text)
                  ? JSON.stringify({ key: 'project', value: 'Prairie' })
                  : '{}',
              });
            } else {
              controller.enqueue({ type: 'text-start', id: 'text' });
              controller.enqueue({
                type: 'text-delta',
                id: 'text',
                delta:
                  last?.role === 'tool'
                    ? `Done. ${JSON.stringify(last.content)}`
                    : 'Hello from the test agent.',
              });
              if (slow)
                await new Promise<void>((resolve) => {
                  if (abortSignal?.aborted) resolve();
                  else
                    abortSignal?.addEventListener('abort', () => resolve(), {
                      once: true,
                    });
                });
              controller.enqueue({ type: 'text-end', id: 'text' });
            }
            controller.enqueue({
              type: 'finish',
              finishReason: {
                unified: tool ? 'tool-calls' : 'stop',
                raw: undefined,
              },
              usage,
            });
            controller.close();
          },
        }),
      };
    },
  });
}
