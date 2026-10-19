"use client";

/**
 * Browser-side helpers for voice: record the microphone and encode 16 kHz
 * mono WAV (what whisper.cpp expects), and read text aloud with the system's
 * built-in voices (Windows speech — works offline).
 */

export interface Recorder {
  stop(): Promise<Blob>;
  cancel(): void;
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        rec.onstop = async () => {
          release();
          try {
            const raw = new Blob(chunks, { type: rec.mimeType });
            resolve(await toWav16k(raw));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
    cancel: () => {
      try {
        rec.stop();
      } catch {}
      release();
    },
  };
}

async function toWav16k(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), rate);
}

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/* ---------------- read aloud ---------------- */

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string, lang?: string) {
  if (!canSpeak() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/_{2,}/g, "blank"));
  if (lang) {
    u.lang = lang;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    if (voice) u.voice = voice;
  }
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
