import { ToolLoopAgent, isStepCount, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Conversation } from '../shared/types.js';

export function createNotesAgent(
  model: LanguageModel,
  conversation: Conversation,
) {
  return new ToolLoopAgent({
    model,
    instructions: `You are a helpful assistant in a small agent playground.
You can save and read notes for this conversation using your two tools.
When asked to remember or save something, use saveNote. When asked about saved
information, use readNotes. Do not claim to have saved data without a successful
tool result. Prefer short, descriptive keys. Notes belong only to this conversation.
You have no filesystem, shell, sandbox, or web access. Be concise and use Markdown
when it helps. Do not invent tool results.`,
    stopWhen: isStepCount(6),
    maxOutputTokens: 1500,
    maxRetries: 0,
    tools: {
      saveNote: tool({
        description: 'Save or replace a note in the current conversation.',
        inputSchema: z.object({
          key: z.string().trim().min(1).max(80),
          value: z.string().min(1).max(2000),
        }),
        execute: ({ key, value }, { abortSignal }) => {
          abortSignal?.throwIfAborted();
          if (
            !Object.hasOwn(conversation.notes, key) &&
            Object.keys(conversation.notes).length >= 50
          ) {
            return {
              saved: false,
              key,
              value,
              reason: 'This conversation already has 50 notes.',
            };
          }
          // Define an own property so keys such as "__proto__" remain ordinary data.
          Object.defineProperty(conversation.notes, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          conversation.updatedAt = new Date().toISOString();
          return { saved: true, key, value };
        },
      }),
      readNotes: tool({
        description: 'Read every saved note in the current conversation.',
        inputSchema: z.object({}),
        execute: () => ({ notes: { ...conversation.notes } }),
      }),
    },
  });
}
