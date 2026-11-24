import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import type { WebSocket } from 'ws';
import { errorMessage, id, now } from '../lib/ids.ts';

interface VoiceSession {
  id: string;
  client: TranscribeStreamingClient;
  socket: WebSocket;
  queue: Buffer[];
  waiting?: () => void;
  closed: boolean;
  finishing: boolean;
  finishTimeout?: NodeJS.Timeout;
  transcriptReceived: boolean;
  createdAt: number;
  lastActivityAt: number;
  idleTimer?: NodeJS.Timeout;
  task?: Promise<void>;
}

const sessions = new Map<string, VoiceSession>();
const debugVoice = process.env.RELAY_DEBUG_VOICE === 'true';
const logVoice = (...args: unknown[]) => { if (debugVoice) console.log('[voice]', ...args); };

export async function createVoiceSession(socket: WebSocket, region = 'us-east-1', profile = 'bedrock'): Promise<string> {
  const sessionId = id('voice');
  if (sessions.size >= 2) throw new Error('Only two local voice sessions can run at once. Close another live room first.');
  const session: VoiceSession = { id: sessionId, client: new TranscribeStreamingClient({ region, ...(profile ? { profile } : {}), maxAttempts: 2 }), socket, queue: [], closed: false, finishing: false, transcriptReceived: false, createdAt: Date.now(), lastActivityAt: Date.now() };
  logVoice('Creating transcription session', sessionId);
  session.idleTimer = setInterval(() => {
    if (Date.now() - session.lastActivityAt > 5 * 60_000 || Date.now() - session.createdAt > 15 * 60_000) stopVoiceSession(sessionId);
  }, 15_000);
  session.idleTimer.unref();
  sessions.set(sessionId, session);
  const send = (data: Record<string, unknown>) => { if (!session.closed && socket.readyState === socket.OPEN) socket.send(JSON.stringify(data)); };
  const audioStream = async function* () {
    while (!session.closed) {
      if (!session.queue.length) await new Promise<void>((resolve) => { session.waiting = resolve; });
      const chunk = session.queue.shift();
      if (!chunk) break;
      if (chunk.length) yield { AudioEvent: { AudioChunk: chunk } };
    }
  };
  session.task = (async () => {
    try {
      const response = await session.client.send(new StartStreamTranscriptionCommand({ LanguageCode: 'en-US', MediaEncoding: 'pcm', MediaSampleRateHertz: 16000, AudioStream: audioStream() }));
      send({ type: 'transcribing', sessionId });
      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (session.closed) break;
          for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
            const transcript = result.Alternatives?.[0]?.Transcript?.trim();
            if (transcript) {
              session.transcriptReceived = true;
              if (session.finishTimeout) { clearTimeout(session.finishTimeout); session.finishTimeout = undefined; }
              const isFinal = !result.IsPartial;
              send({ type: 'transcript', text: transcript, isFinal, sessionId });
              if (isFinal && session.finishing) {
                send({ type: 'utterance_complete', sessionId });
                session.closed = true;
                session.client.destroy();
                break;
              }
            }
          }
        }
      }
      if (!session.closed) {
        session.closed = false;
        session.finishing = false;
        session.queue = [];
        session.lastActivityAt = Date.now();
        send({ type: 'utterance_complete', sessionId });
      }
    } catch (error) {
      logVoice('Transcription error', error);
      const message = errorMessage(error);
      if (session.finishing && session.transcriptReceived && /timed out|timeout|audio.*received/i.test(message)) {
        if (!session.closed) send({ type: 'utterance_complete', sessionId, note: 'Audio segment ended after the final transcript.' });
      } else if (!session.closed) send({ type: 'error', message: /AccessDenied|Unauthorized|Forbidden/i.test(message) ? 'Your AWS role needs transcribe:StartStreamTranscription permission for live voice.' : `Voice transcription could not start: ${message}` });
    } finally { session.closed = true; if (session.finishTimeout) clearTimeout(session.finishTimeout); if (session.idleTimer) clearInterval(session.idleTimer); sessions.delete(sessionId); if (socket.readyState === socket.OPEN) socket.close(); }
  })();
  return sessionId;
}

export function pushAudio(sessionId: string, data: ArrayBuffer): void {
  const session = sessions.get(sessionId);
  if (!session || session.closed || session.finishing || data.byteLength === 0 || data.byteLength > 128_000) return;
  session.lastActivityAt = Date.now();
  session.queue.push(Buffer.from(data));
  if (session.queue.length > 50) session.queue.splice(0, session.queue.length - 50);
  session.waiting?.(); session.waiting = undefined;
}

export function stopVoiceSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.closed = true;
  if (session.idleTimer) clearInterval(session.idleTimer);
  session.queue = [];
  session.waiting?.(); session.waiting = undefined;
  session.client.destroy();
  sessions.delete(sessionId);
  if (session.socket.readyState === session.socket.OPEN) session.socket.close();
}

export function finishAudio(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || session.closed || session.finishing) return;
  session.finishing = true;
  session.queue.push(Buffer.alloc(0));
  session.waiting?.(); session.waiting = undefined;
}

export function stopAllVoiceSessions(): void {
  for (const sessionId of sessions.keys()) stopVoiceSession(sessionId);
}

export function voiceServiceInfo(): { region: string; profile: string; audioStored: boolean; checkedAt: string } {
  return { region: process.env.AWS_REGION || 'us-east-1', profile: process.env.AWS_PROFILE || 'bedrock', audioStored: false, checkedAt: now() };
}
