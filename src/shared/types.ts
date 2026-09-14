import type { UIMessage } from 'ai';

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: 'ready' | 'running' | 'interrupted' | 'error';
  error?: string;
  messages: UIMessage[];
  notes: Record<string, string>;
};

export type ConversationSummary = Omit<Conversation, 'messages' | 'notes'>;

export type AppConfig = {
  model: string;
  configured: boolean;
  activeConversationId: string | null;
};
