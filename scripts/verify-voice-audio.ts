import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

const audio = await readFile(join(tmpdir(), 'relay-test-utterance.pcm'));
const socket = new WebSocket('ws://127.0.0.1:8787/api/voice/stream');
const transcripts: string[] = [];
const timeout = setTimeout(() => { console.error('Voice test timed out', transcripts); socket.close(); process.exitCode = 1; }, 15000);
socket.on('open', () => socket.send(JSON.stringify({ type: 'start', sampleRate: 16000 })));
socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log(JSON.stringify(message));
  if (message.type === 'ready') {
    (async () => {
      for (let offset = 0; offset < audio.length; offset += 6400) {
        socket.send(audio.subarray(offset, offset + 6400));
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      socket.send(JSON.stringify({ type: 'finish' }));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  }
  if (message.type === 'transcript') transcripts.push(message.text);
  if (message.type === 'utterance_complete' || message.type === 'ended') {
    clearTimeout(timeout);
    console.log('TRANSCRIPTION_COMPLETE', JSON.stringify(transcripts));
    socket.send(JSON.stringify({ type: 'stop' }));
    socket.close();
  }
  if (message.type === 'error') { clearTimeout(timeout); socket.close(); process.exitCode = 1; }
});
socket.on('error', (error) => { console.error(error); clearTimeout(timeout); process.exitCode = 1; });
