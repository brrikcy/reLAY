import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bot } from '../lib/types.ts';

export type VoiceStatus = 'off' | 'starting' | 'listening' | 'processing' | 'speaking' | 'error';

export function useGroupVoice(bots: Bot[], onTranscript: (transcript: string) => Promise<boolean>, onError: (message: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>('off');
  const [interim, setInterim] = useState('');
  const [speakerId, setSpeakerId] = useState('');
  const [voiceNotice, setVoiceNotice] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(true);
  const finalRef = useRef('');
  const queueRef = useRef(Promise.resolve());
  const spokenRef = useRef(new Set<string>());
  const sendRef = useRef(onTranscript);
  const errorRef = useRef(onError);
  const botsRef = useRef(bots);
  sendRef.current = onTranscript; errorRef.current = onError; botsRef.current = bots;
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && !!navigator.mediaDevices?.getUserMedia && 'WebSocket' in window && 'AudioContext' in window;

  const closeCapture = useCallback(() => {
    processorRef.current?.disconnect(); processorRef.current = null;
    sourceRef.current?.disconnect(); sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (audioContextRef.current?.state !== 'closed') void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false; pausedRef.current = true;
    socketRef.current?.close(); socketRef.current = null;
    closeCapture();
    window.speechSynthesis?.cancel();
    finalRef.current = '';
    setStatus('off'); setSpeakerId(''); setInterim(''); setVoiceNotice('');
  }, [closeCapture]);

  const speak = useCallback((messageId: string, botId: string, text: string) => {
    if (!activeRef.current || spokenRef.current.has(messageId)) return;
    spokenRef.current.add(messageId);
    queueRef.current = queueRef.current.then(() => new Promise<void>((resolve) => {
      if (!activeRef.current) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*_`#>[\]()]/g, '').slice(0, 1600));
      const bot = botsRef.current.find((candidate) => candidate.id === botId);
      utterance.rate = 1.02;
      utterance.pitch = botId === 'bot_atlas' ? 0.86 : botId === 'bot_echo' ? 1.14 : 1;
      utterance.lang = 'en-US';
      const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
      if (voices.length) utterance.voice = voices[Math.max(0, botsRef.current.findIndex((candidate) => candidate.id === botId)) % voices.length];
      utterance.onstart = () => { if (activeRef.current) { pausedRef.current = true; setSpeakerId(botId); setStatus('speaking'); } };
      utterance.onend = () => { pausedRef.current = false; setSpeakerId(''); if (activeRef.current) setStatus('listening'); resolve(); };
      utterance.onerror = () => { pausedRef.current = false; setSpeakerId(''); if (activeRef.current) setStatus('listening'); resolve(); };
      if (bot) window.speechSynthesis.speak(utterance); else resolve();
    })).catch(() => { if (activeRef.current) setStatus('listening'); });
  }, []);

  const startCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    streamRef.current = stream;
    const context = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = context;
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    sourceRef.current = source;
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const silent = context.createGain(); silent.gain.value = 0;
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    processor.onaudioprocess = (event) => {
      if (!activeRef.current || pausedRef.current || socketRef.current?.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let index = 0; index < input.length; index++) { const sample = Math.max(-1, Math.min(1, input[index])); pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff; }
      socketRef.current.send(pcm.buffer);
    };
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) { pausedRef.current = !pausedRef.current; setStatus(pausedRef.current ? 'off' : 'listening'); if (pausedRef.current) setVoiceNotice('Microphone muted. Bots can still speak.'); else setVoiceNotice(''); return; }
    if (!supported) { errorRef.current('This browser cannot capture microphone audio. Use a current Chrome or Edge browser, or continue with text.'); return; }
    setStatus('starting'); setVoiceNotice('Requesting microphone access and starting AWS Transcribe…');
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice/stream`);
    socketRef.current = socket;
    socket.onopen = () => { socket.send(JSON.stringify({ type: 'start', sampleRate: 16000 })); };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; text?: string; isFinal?: boolean; message?: string };
      if (message.type === 'ready') {
        activeRef.current = true; pausedRef.current = false; finalRef.current = '';
        setStatus('listening'); setVoiceNotice('Hold the microphone button or press Space while speaking. Release to send.');
        void startCapture().catch((error) => { activeRef.current = false; setStatus('error'); errorRef.current(error instanceof Error ? `Microphone could not start: ${error.message}` : 'Microphone could not start.'); socket.close(); closeCapture(); });
      }
      if (message.type === 'transcript' && message.text) {
        if (message.isFinal) { finalRef.current += `${finalRef.current ? ' ' : ''}${message.text}`; setInterim(finalRef.current); }
        else setInterim(`${finalRef.current}${finalRef.current ? ' ' : ''}${message.text}`);
      }
      if (message.type === 'error') { setStatus('error'); setVoiceNotice(message.message ?? 'Voice service failed.'); errorRef.current(message.message ?? 'Voice service failed.'); closeCapture(); }
      if (message.type === 'ended' && activeRef.current) { pausedRef.current = true; setStatus('off'); setVoiceNotice('Voice session ended. Start again when ready.'); closeCapture(); }
    };
    socket.onerror = () => { setVoiceNotice('Could not connect to the local voice service. Make sure Relay is running and reload the page.'); };
    socket.onclose = () => { closeCapture(); if (activeRef.current) { pausedRef.current = true; setStatus('off'); } activeRef.current = false; };
  }, [closeCapture, startCapture, supported]);

  const beginTalking = useCallback(() => { if (activeRef.current && status !== 'processing' && status !== 'speaking') { pausedRef.current = false; setStatus('listening'); setInterim(''); } }, [status]);
  const finishTalking = useCallback(() => {
    if (!activeRef.current || pausedRef.current) return;
    pausedRef.current = true;
    socketRef.current?.send(JSON.stringify({ type: 'finish' }));
    setStatus('processing'); setVoiceNotice('Finishing the transcription. Your message will send when the final text arrives.');
    const startedAt = Date.now();
    const waitForTranscript = () => {
      const transcript = finalRef.current.trim();
      if (!transcript && Date.now() - startedAt < 8000) { setTimeout(waitForTranscript, 150); return; }
      if (!transcript) { if (activeRef.current) { setStatus('listening'); setVoiceNotice('No speech was captured. Try speaking a little longer.'); } return; }
      if (!activeRef.current) return;
    setStatus('processing'); setVoiceNotice('Sending your transcribed message to the selected bots…'); finalRef.current = '';
      void sendRef.current(transcript).then((accepted) => { if (activeRef.current) { setStatus(accepted ? 'listening' : 'error'); if (!accepted) setVoiceNotice('The message could not be sent. Wait for the current response to finish.'); } });
    };
    waitForTranscript();
  }, []);
  const prime = useCallback(() => { if (supported) window.speechSynthesis.getVoices(); }, [supported]);
  useEffect(() => () => { activeRef.current = false; socketRef.current?.close(); closeCapture(); window.speechSynthesis?.cancel(); }, [closeCapture]);
  return { status, interim, speakerId, supported, start, stop, speak, prime, beginTalking, finishTalking, voiceNotice, isActive: activeRef.current };
}
