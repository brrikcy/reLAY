import WebSocket from 'ws';

const socket = new WebSocket('ws://127.0.0.1:8787/api/voice/stream');
const timeout = setTimeout(() => { console.error('Voice test timed out'); socket.close(); process.exitCode = 1; }, 25000);
socket.on('open', () => { console.log('Socket open'); socket.send(JSON.stringify({ type: 'start', sampleRate: 16000 })); });
socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log(JSON.stringify(message));
  if (message.type === 'ready') {
    socket.send(Buffer.alloc(16000 * 2, 0));
    setTimeout(() => { socket.send(JSON.stringify({ type: 'finish' })); }, 1000);
  }
  if (message.type === 'utterance_complete' || message.type === 'ended') { clearTimeout(timeout); socket.send(JSON.stringify({ type: 'stop' })); socket.close(); }
  if (message.type === 'error') { clearTimeout(timeout); socket.close(); process.exitCode = 1; }
});
socket.on('error', (error) => { console.error(error); clearTimeout(timeout); process.exitCode = 1; });
socket.on('close', (code, reason) => { console.log(`Socket closed ${code}: ${reason.toString()}`); clearTimeout(timeout); });
