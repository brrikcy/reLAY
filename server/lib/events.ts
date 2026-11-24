import type { Response } from 'express';
import type { RunEvent } from '../types.ts';

const clients = new Map<string, Response>();

export function subscribe(botId: string, response: Response): () => void {
  const previous = clients.get(botId);
  previous?.end();
  clients.set(botId, response);
  return () => {
    if (clients.get(botId) === response) clients.delete(botId);
  };
}

export function publish(botId: string, type: 'message' | 'run' | 'workspace' | 'delta', event?: RunEvent | { runId: string; messageId: string; text: string }): void {
  const client = clients.get(botId);
  if (!client) return;
  client.write(`event: ${type}\ndata: ${JSON.stringify(event ?? { updatedAt: new Date().toISOString() })}\n\n`);
}

export function closeSubscriptions(): void {
  for (const client of clients.values()) client.end();
  clients.clear();
}

export function publishAll(type: 'workspace'): void {
  for (const client of clients.values()) {
    client.write(`event: ${type}\ndata: {}\n\n`);
  }
}
