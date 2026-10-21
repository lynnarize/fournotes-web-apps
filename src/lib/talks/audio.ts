"use client";
// Audio for transcription: 16 kHz mono 16-bit WAV. Every transcriber reads it, it needs no
// codec, and two minutes of it (3.8 MB) fits under the 4.5 MB a request may carry.
export const RATE = 16_000;
/** Seconds per piece sent to be transcribed. */
export const CHUNK_SECONDS = 120;
/** Below this loudness (RMS) a stretch counts as silence and isn't sent. */
const SILENCE_RMS = 0.006;

export function wav(samples: Float32Array, rate = RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export const rms = (samples: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
};

/** Is anyone speaking in it? Loud enough for at least a few hundred milliseconds. */
export function hasSpeech(samples: Float32Array) {
  const frame = RATE / 10;
  let loud = 0;
  for (let i = 0; i + frame <= samples.length; i += frame) if (rms(samples.subarray(i, i + frame)) > SILENCE_RMS) loud++;
  return loud >= 3;
}

/** Joins the pieces a recorder collected. */
export function concat(parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** An audio file, decoded and resampled to 16 kHz mono. */
export async function decodeFile(file: Blob): Promise<Float32Array> {
  const bytes = await file.arrayBuffer();
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(bytes);
  } catch {
    throw new Error("This file couldn't be read as audio. Try an MP3, M4A, WAV, OGG or WebM file.");
  } finally {
    void probe.close();
  }
  const length = Math.ceil(decoded.duration * RATE);
  const offline = new OfflineAudioContext(1, length, RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  return (await offline.startRendering()).getChannelData(0);
}
