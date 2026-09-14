import type { UIMessage } from 'ai';

export type Conversation = {
  id: string;
  messages: UIMessage[];
  expiresAt: number | null;
  state:
    'offline' | 'starting' | 'waiting_for_agent' | 'waiting_for_user' | 'error';
  waitingSince: number | null;
};
