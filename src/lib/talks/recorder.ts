"use client";
// Recording a talk. In person: the microphone. On a call or in a meeting: the microphone
// and the call's sound, shared from a tab (Google Meet, Teams on the web) or, sharing the
// whole screen, from an app (WhatsApp, Zoom). The two are recorded apart, so the transcript
// knows what you said from what the other side said without guessing.
//
// Every two minutes each side is sent to be transcribed (see app/api/transcribe). The
// browser's live captions run alongside: they show what's being said, and they're the
// transcript for any stretch the server couldn't do (no key, no credit, no internet).
// The whole recording is kept in this browser for playback (lib/talks/db.ts).
import { useSyncExternalStore } from "react";
import { useNow } from "../hooks";
import { authHeaders, getUserKeys } from "../byok";
import { api } from "../client";
import type { Talk, TalkChunk, TalkSegment } from "../types";
import { CHUNK_SECONDS, concat, decodeFile, hasSpeech, RATE, rms, wav } from "./audio";
import { addTalk, getTalk, saveAudio, updateTalk } from "./db";
import { clock, defaultTitle, isDefaultTitle, mergeTranscript, speakersOf, transcriptText } from "./transcript";

export type RecordMode = "room" | "call";
type Channel = TalkChunk["channel"];

// ---- What the UI shows -------------------------------------------------------------------
export type RecorderState = {
  status: "idle" | "starting" | "recording" | "stopping";
  talkId: string | null;
  mode: RecordMode;
  startedAt: number; // ms, Date.now()
  levels: { me: number; them: number };
  /** The words being said right now, before the caption settles. */
  caption: string;
  /** Something the user should know while recording ("the call stopped sharing"). */
  warning: string | null;
};
let state: RecorderState = { status: "idle", talkId: null, mode: "room", startedAt: 0, levels: { me: 0, them: 0 }, caption: "", warning: null };
const listeners = new Set<() => void>();
const set = (p: Partial<RecorderState>) => { state = { ...state, ...p }; for (const fn of listeners) fn(); };
export const useRecorder = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state, () => state);

/** For the sidebar: how long the talk being recorded has run, or null. */
export function useRecordingLabel() {
  const rec = useRecorder();
  const now = useNow(1000);
  return rec.status === "idle" || !rec.startedAt ? null : clock((now.getTime() - rec.startedAt) / 1000);
}

// ---- Which engine transcribes ----------------------------------------------------------
export type Engine = "stt" | "audio" | null;
/** Asked each time a recording starts, since keys can change in Settings. */
export async function serverEngine(): Promise<Engine> {
  try {
    const r = await fetch("/api/transcribe", { headers: await authHeaders() });
    return ((await r.json()) as { engine?: Engine }).engine ?? null;
  } catch {
    return null;
  }
}

// ---- Live captions (the browser's own speech recognition) --------------------------------
type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null;
  start(track?: MediaStreamTrack): void; stop(): void; abort(): void;
};
type RecCtor = (new () => Rec) & { available?(o: object): Promise<string>; install?(o: object): Promise<boolean> };
const speechApi = () => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const hasCaptions = () => Boolean(speechApi());

/** "available", "downloadable" or "unavailable": can captions run on this device, privately? */
export async function localSpeech(lang: string): Promise<string> {
  const SR = speechApi();
  if (!SR?.available) return "unavailable";
  return SR.available({ langs: [lang], processLocally: true }).catch(() => "unavailable");
}
/** Downloads on-device speech recognition for a language. Call it from a click. */
export async function installLocalSpeech(lang: string) {
  const SR = speechApi();
  return Boolean(await SR?.install?.({ langs: [lang], processLocally: true }).catch(() => false));
}

// ---- One side of the conversation, being recorded ------------------------------------------
type Side = {
  channel: Channel;
  track: MediaStreamTrack;
  parts: Float32Array[];
  /** Seconds from the start where the pending audio begins. */
  since: number;
  level: number;
  rec: Rec | null;
  captionsOff: boolean;
};

type Session = {
  talkId: string;
  ctx: AudioContext;
  streams: MediaStream[];
  sides: Side[];
  mixed: MediaRecorder | null;
  mixedParts: Blob[];
  t0: number; // performance.now() at the start
  timer: ReturnType<typeof setInterval>;
  localCaptions: boolean;
  stopping: boolean;
};
let session: Session | null = null;
const elapsed = () => (session ? (performance.now() - session.t0) / 1000 : 0);

/** Downsamples whatever the device records at to 16 kHz. */
function to16k(input: Float32Array, from: number): Float32Array {
  if (from === RATE) return new Float32Array(input);
  const ratio = from / RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let k = a; k < b; k++) sum += input[k];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

/** "Meet – abc-defg-hij" → "Google Meet": what was shared, when the tab or window says. */
function appFrom(label: string) {
  const apps: [RegExp, string][] = [
    [/meet\.google|google meet|^meet\b/i, "Google Meet"], [/zoom/i, "Zoom"], [/teams/i, "Microsoft Teams"],
    [/whatsapp/i, "WhatsApp"], [/telegram/i, "Telegram"], [/discord/i, "Discord"], [/slack/i, "Slack"], [/skype/i, "Skype"],
    [/webex/i, "Webex"], [/facetime/i, "FaceTime"], [/line\b/i, "LINE"], [/messenger/i, "Messenger"],
  ];
  return apps.find(([re]) => re.test(label))?.[1] ?? null;
}

export class RecorderError extends Error {}

/**
 * Starts recording. For a call, the browser asks what to share: a tab with "Share tab audio"
 * on, or the entire screen with "Share system audio" for an app.
 */
export async function startRecording(opts: { mode: RecordMode; lang: string; title?: string; app?: string }) {
  if (session || state.status !== "idle") throw new RecorderError("A recording is already running.");
  set({ status: "starting", warning: null, caption: "", mode: opts.mode });
  const streams: MediaStream[] = [];
  let made: string | null = null;
  const stopAll = () => streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).catch(() => { throw new RecorderError("Microphone access is blocked. Allow the microphone for this site and try again."); });
    streams.push(mic);

    let call: MediaStreamTrack | null = null;
    let app = opts.app?.trim() || null;
    if (opts.mode === "call") {
      if (!navigator.mediaDevices.getDisplayMedia) throw new RecorderError("This browser can't record a call's sound. Use Chrome or Edge on a computer, or record in person on speaker.");
      const shared = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Chrome: offer the system's sound when sharing a screen, and don't offer this tab.
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      } as DisplayMediaStreamOptions).catch(() => { throw new RecorderError("Nothing was shared, so the call can't be recorded."); });
      streams.push(shared);
      call = shared.getAudioTracks()[0] ?? null;
      const video = shared.getVideoTracks()[0];
      app ??= appFrom(video?.label ?? "");
      if (!call) {
        throw new RecorderError(
          "No sound was shared. Share again and turn on “Share tab audio” for a tab, or “Share system audio” when sharing the entire screen for an app like WhatsApp or Zoom.",
        );
      }
      // Only the sound is needed: the picture stops here (the sound keeps going).
      video?.stop();
    }

    const startedAt = Date.now();
    const talk = addTalk({
      id: crypto.randomUUID(), createdAt: new Date(startedAt).toISOString(), updatedAt: new Date(startedAt).toISOString(), deletedAt: null,
      title: opts.title?.trim() || defaultTitle(new Date(startedAt)), mode: opts.mode, app, lang: opts.lang, duration: 0,
      status: "recording", engine: null, problem: null, chunks: [], live: [], segments: [], names: {}, summary: null, hasAudio: false,
    });
    made = talk.id;
    active.add(talk.id);

    const ctx = new AudioContext();
    const sink = ctx.createGain();
    sink.gain.value = 0; // the processors must reach the speakers to run, silently
    sink.connect(ctx.destination);
    const mixDest = ctx.createMediaStreamDestination();
    const sides: Side[] = [];
    const add = (channel: Channel, track: MediaStreamTrack) => {
      const side: Side = { channel, track, parts: [], since: 0, level: 0, rec: null, captionsOff: false };
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => {
        if (!session || session.stopping) return;
        const input = e.inputBuffer.getChannelData(0);
        side.parts.push(to16k(input, ctx.sampleRate));
        side.level = Math.min(1, rms(input) * 6);
      };
      src.connect(proc);
      proc.connect(sink);
      src.connect(mixDest);
      sides.push(side);
      return side;
    };
    add(opts.mode === "call" ? "me" : "room", mic.getAudioTracks()[0]);
    if (call) {
      add("them", call);
      call.onended = () => set({ warning: "The call stopped sharing its sound. Your microphone is still recording." });
    }

    const type = ["audio/webm;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const mixed = new MediaRecorder(mixDest.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
    const mixedParts: Blob[] = [];
    mixed.ondataavailable = (e) => { if (e.data.size) mixedParts.push(e.data); };
    mixed.start(1000);

    const local = (await localSpeech(opts.lang)) === "available";
    session = {
      talkId: talk.id, ctx, streams, sides, mixed, mixedParts, t0: performance.now(), localCaptions: local, stopping: false,
      timer: setInterval(tick, 500),
    };
    void Promise.all([serverEngine(), import("../ai/onDevice").then((m) => m.shouldTranscribeOnDevice())]).then(([engine, here]) => {
      if (here) set({ warning: null });
      else if (!engine && !hasCaptions()) set({ warning: "No way to transcribe here: add a speech-to-text key in Settings → AI & API keys, or use Chrome or Edge." });
      else if (!engine) set({ warning: "Using your browser's live captions. A speech-to-text key in Settings gives a better transcript." });
    });
    for (const s of sides) startCaptions(s, opts.lang);
    window.addEventListener("beforeunload", warnUnload);
    set({ status: "recording", talkId: talk.id, startedAt });
    return talk.id;
  } catch (e) {
    stopAll();
    if (made) { active.delete(made); updateTalk(made, { deletedAt: new Date().toISOString(), status: "done" }); }
    set({ status: "idle", talkId: null });
    throw e instanceof RecorderError ? e : new RecorderError(e instanceof Error ? e.message : "Couldn't start recording.");
  }
}

const warnUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };

let lastLevels = 0;
function tick() {
  const s = session;
  if (!s) return;
  const now = elapsed();
  for (const side of s.sides) if (now - side.since >= CHUNK_SECONDS) cut(side, now);
  // Levels a few times a second, not on every audio callback.
  if (performance.now() - lastLevels > 150) {
    lastLevels = performance.now();
    const level = (ch: Channel) => s.sides.find((x) => x.channel === ch)?.level ?? 0;
    set({ levels: { me: Math.max(level("me"), level("room")), them: level("them") } });
  }
}

/** Sends what one side recorded since the last cut. */
function cut(side: Side, at: number) {
  const s = session;
  if (!s) return;
  const audio = concat(side.parts);
  side.parts = [];
  const chunk: TalkChunk = { channel: side.channel, start: side.since, end: at, status: hasSpeech(audio) ? "queued" : "silent", segments: [] };
  side.since = at;
  updateTalk(s.talkId, (t) => ({ chunks: [...t.chunks, chunk], duration: at }));
  if (chunk.status === "queued") enqueue(s.talkId, chunk, wav(audio));
}

function startCaptions(side: Side, lang: string) {
  const SR = speechApi();
  const s = session;
  if (!SR || !s) return;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  if (s.localCaptions) rec.processLocally = true;
  let begun: number | null = null;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      begun ??= Math.max(0, elapsed() - 1.5);
      if (r.isFinal) {
        const text = r[0].transcript.trim();
        const start = begun;
        begun = null;
        const end = elapsed();
        if (text && session) updateTalk(session.talkId, (t) => ({ live: [...t.live, { speaker: side.channel, start, end, text }] }));
      } else interim += r[0].transcript;
    }
    if (interim) set({ caption: `${side.channel === "them" ? "Them" : side.channel === "me" ? "You" : ""}${side.channel === "room" ? "" : ": "}${interim}` });
  };
  rec.onerror = (e) => {
    if (["not-allowed", "service-not-allowed", "network", "language-not-supported", "audio-capture"].includes(e.error ?? "")) side.captionsOff = true;
  };
  rec.onend = () => {
    // Recognition stops by itself after a silence: carry on while recording.
    if (session && !session.stopping && !side.captionsOff) {
      try { if (typeof SR.available === "function") rec.start(side.track); else rec.start(); } catch { side.captionsOff = true; }
    }
  };
  // Recognition that can be given a track came with `available` (on-device speech). Older
  // recognition ignores the track and hears the microphone, which mustn't be filed as "Them".
  const tracks = typeof SR.available === "function";
  if (side.channel === "them" && !tracks) return void (side.captionsOff = true);
  try {
    if (tracks) rec.start(side.track);
    else rec.start();
  } catch {
    return void (side.captionsOff = true);
  }
  side.rec = rec;
}

/** Stops recording; the last pieces are transcribed and the talk is written up. */
export async function stopRecording() {
  const s = session;
  if (!s || s.stopping) return;
  s.stopping = true;
  set({ status: "stopping", caption: "" });
  clearInterval(s.timer);
  const end = (performance.now() - s.t0) / 1000;
  for (const side of s.sides) {
    side.rec?.stop();
    cut(side, end);
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    if (!s.mixed || s.mixed.state === "inactive") return resolve(null);
    s.mixed.onstop = () => resolve(new Blob(s.mixedParts, { type: s.mixed?.mimeType || "audio/webm" }));
    s.mixed.stop();
  });
  s.streams.forEach((x) => x.getTracks().forEach((t) => t.stop()));
  void s.ctx.close();
  window.removeEventListener("beforeunload", warnUnload);
  session = null;
  const id = s.talkId;
  if (blob?.size) await saveAudio(id, blob).then(() => updateTalk(id, { hasAudio: true })).catch(() => {});
  updateTalk(id, { status: "transcribing", duration: end });
  set({ status: "idle", talkId: null, levels: { me: 0, them: 0 }, warning: null });
  await finish(id);
}

// ---- Transcribing, one piece at a time ---------------------------------------------------
const queue: { talkId: string; chunk: TalkChunk; audio: Blob }[] = [];
/** Talks this page is recording or transcribing right now (anything else "transcribing" was left by a closed tab). */
const active = new Set<string>();
let working: Promise<void> | null = null;
/** A talk whose engine said no (no key, no credit): its other pieces aren't sent. */
const refused = new Map<string, string>();

function enqueue(talkId: string, chunk: TalkChunk, audio: Blob) {
  queue.push({ talkId, chunk, audio });
  working ??= drain().finally(() => { working = null; });
}

async function drain() {
  while (queue.length) {
    const job = queue.shift()!;
    const mark = (p: Partial<TalkChunk>, extra: Partial<Talk> = {}) =>
      updateTalk(job.talkId, (t) => ({
        ...extra,
        chunks: t.chunks.map((c) => (c.channel === job.chunk.channel && c.start === job.chunk.start ? { ...c, ...p } : c)),
      }));
    const no = refused.get(job.talkId);
    if (no) { mark({ status: "failed" }); continue; }
    try {
      const { engine, segments } = await send(job.talkId, job.chunk, job.audio);
      mark({ status: "done", segments }, { engine });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transcription failed.";
      const final = (e as { status?: number }).status;
      if (final === 501 || final === 402 || final === 401 || final === 403) refused.set(job.talkId, msg);
      mark({ status: "failed" }, { problem: final === 501 ? null : msg });
    }
  }
}

/** Speakers heard so far on the same side, with something each said, so letters stay the same. */
function known(t: Talk, channel: Channel) {
  const out = new Map<string, string>();
  for (const c of t.chunks) {
    if (c.channel !== channel || c.status !== "done") continue;
    for (const s of c.segments ?? []) {
      const id = s.speaker.replace(/^them:/, "");
      if (s.speaker !== "me" && !out.has(id) && s.text.length > 12) out.set(id, s.text.slice(0, 120));
    }
  }
  return [...out].map(([id, sample]) => ({ id, sample }));
}

/** Talks the server couldn't transcribe (no key, no credit): the rest of their pieces go to Chrome's model. */
const onDeviceNow = new Set<string>();

/**
 * Transcribes one piece. Chrome's model listens when it's the one answering (picked in the
 * model menu, no key, offline), and takes over a talk the server can't do; otherwise the server.
 */
async function send(talkId: string, chunk: TalkChunk, audio: Blob): Promise<{ engine: Talk["engine"]; segments: TalkSegment[] }> {
  const t = getTalk(talkId);
  const opts = { channel: chunk.channel, lang: t?.lang ?? "en-US", known: t ? known(t, chunk.channel) : [] };
  const device = await import("../ai/onDevice");
  const here = async () => ({ engine: "device" as const, segments: place(chunk, await device.onDeviceTranscribe(audio, opts)) });

  if (onDeviceNow.has(talkId) || (await device.shouldTranscribeOnDevice())) {
    try {
      return await here();
    } catch (e) {
      // Chrome's model couldn't: the server, if there is one, gets this piece.
      if (onDeviceNow.has(talkId)) throw e;
      console.warn("[talks] on-device transcription failed, trying the server:", e instanceof Error ? e.message : e);
    }
  }
  try {
    return await sendToServer(chunk, audio, opts);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if ([401, 402, 403, 501].includes(status ?? 0) && (await device.canTranscribeOnDevice())) {
      onDeviceNow.add(talkId);
      return here();
    }
    throw e;
  }
}

async function sendToServer(chunk: TalkChunk, audio: Blob, opts: { channel: Channel; lang: string; known: { id: string; sample: string }[] }) {
  const fd = new FormData();
  fd.append("file", audio, "chunk.wav");
  fd.append("channel", opts.channel);
  fd.append("lang", opts.lang);
  fd.append("known", JSON.stringify(opts.known));
  if (getUserKeys().openrouterTier === "paid") fd.append("paid", "1");
  const res = await fetch("/api/transcribe", { method: "POST", body: fd, headers: await authHeaders() });
  const json = (await res.json().catch(() => ({}))) as { error?: string; engine?: Talk["engine"]; segments?: TalkSegment[] };
  if (!res.ok) throw Object.assign(new Error(json.error || `Transcription failed (${res.status})`), { status: res.status });
  return { engine: json.engine ?? null, segments: place(chunk, json.segments ?? []) };
}

/** A piece's lines, timed from the start of the talk. Without usable times (some models give none), spread in order. */
function place(chunk: TalkChunk, raw: TalkSegment[]): TalkSegment[] {
  const length = chunk.end - chunk.start;
  const timed = raw.some((s) => s.end > 0);
  return raw.map((s, i) => {
    const start = timed ? Math.min(length, s.start) : (i / raw.length) * length;
    const end = timed ? Math.min(length, Math.max(s.end, start)) : ((i + 1) / raw.length) * length;
    return { speaker: s.speaker, start: chunk.start + start, end: chunk.start + end, text: s.text };
  });
}

/** Once every piece is back: the final transcript, then the write-up. */
async function finish(talkId: string) {
  while (working || queue.some((j) => j.talkId === talkId)) {
    working ??= drain().finally(() => { working = null; });
    await working;
  }
  const t = getTalk(talkId);
  if (!t) return;
  const segments = mergeTranscript(t);
  const usedLive = t.live.length > 0 && segments.some((s) => t.live.includes(s));
  updateTalk(talkId, {
    segments,
    status: "done",
    engine: t.engine ?? (usedLive ? "browser" : null),
    problem: segments.length ? t.problem ?? null : t.problem || "Nothing was transcribed. Add a speech-to-text key in Settings → AI & API keys, then transcribe it again.",
  });
  refused.delete(talkId);
  onDeviceNow.delete(talkId);
  active.delete(talkId);
  if (segments.length) await summarize(talkId).catch(() => {});
}

/** The write-up: a title, summary, key points, action items and a profile of each person. */
export async function summarize(talkId: string) {
  const t = getTalk(talkId);
  if (!t) return;
  const segs = t.segments.length ? t.segments : mergeTranscript(t);
  const speakers = speakersOf(t, segs).flatMap((s) => s.ids.map((id) => ({ id, name: s.name })));
  const out = await api.agent("talkSummary", {
    title: t.title,
    when: new Date(t.createdAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }),
    app: t.app ?? undefined,
    speakers,
    transcript: transcriptText(t, segs).slice(0, 24_000),
  });
  updateTalk(talkId, (cur) => {
    const names = { ...cur.names };
    for (const p of out.people) {
      // A name the conversation gave, for a speaker the user hasn't named.
      if (p.name.trim() && !names[p.id]?.trim() && p.id !== "me" && speakers.some((s) => s.id === p.id)) names[p.id] = p.name.trim().slice(0, 60);
    }
    return {
      title: isDefaultTitle(cur.title) && out.title.trim() ? out.title.trim().slice(0, 120) : cur.title,
      names,
      summary: {
        text: out.summary.trim(),
        keyPoints: out.keyPoints.map((x) => x.trim()).filter(Boolean).slice(0, 8),
        actionItems: out.actionItems.map((x) => x.trim()).filter(Boolean).slice(0, 10),
        people: out.people.filter((p) => p.profile.trim() && speakers.some((s) => s.id === p.id)).map((p) => ({ speaker: p.id, profile: p.profile.trim() })),
      },
    };
  });
}

// ---- A file, or a talk again ---------------------------------------------------------------
async function transcribeAudio(talkId: string, audio: Float32Array) {
  const chunks: TalkChunk[] = [];
  for (let at = 0, i = 0; at < audio.length; at += CHUNK_SECONDS * RATE, i++) {
    const piece = audio.subarray(at, Math.min(audio.length, at + CHUNK_SECONDS * RATE));
    const chunk: TalkChunk = { channel: "room", start: at / RATE, end: (at + piece.length) / RATE, status: hasSpeech(piece) ? "queued" : "silent", segments: [] };
    chunks.push(chunk);
    if (chunk.status === "queued") enqueue(talkId, chunk, wav(piece));
  }
  updateTalk(talkId, { chunks, status: "transcribing", duration: audio.length / RATE, problem: null });
  await finish(talkId);
}

/** A recording made elsewhere (a voice note, a phone recorder's file). Needs a server engine. */
export async function transcribeFile(file: File, lang: string) {
  if (!(await serverEngine()) && !(await import("../ai/onDevice").then((m) => m.canTranscribeOnDevice()))) {
    throw new RecorderError("Transcribing a file needs a speech-to-text key (OpenAI or Groq) in Settings → AI & API keys, or OpenRouter with credit.");
  }
  const audio = await decodeFile(file);
  const now = new Date();
  const talk = addTalk({
    id: crypto.randomUUID(), createdAt: now.toISOString(), updatedAt: now.toISOString(), deletedAt: null,
    title: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || defaultTitle(now), mode: "upload", app: null, lang,
    duration: audio.length / RATE, status: "transcribing", engine: null, problem: null, chunks: [], live: [], segments: [], names: {}, summary: null,
  });
  active.add(talk.id);
  await saveAudio(talk.id, file).then(() => updateTalk(talk.id, { hasAudio: true })).catch(() => {});
  void transcribeAudio(talk.id, audio);
  return talk.id;
}

/** Transcribes a kept recording again, e.g. once a key has been added. One voice track: in-person rules. */
export async function retranscribe(talkId: string, audioBlob: Blob) {
  if (!(await serverEngine()) && !(await import("../ai/onDevice").then((m) => m.canTranscribeOnDevice()))) {
    throw new RecorderError("Add a speech-to-text key in Settings → AI & API keys first.");
  }
  const audio = await decodeFile(audioBlob);
  active.add(talkId);
  // The old transcript stays as the fallback for any piece that doesn't come back.
  updateTalk(talkId, (t) => ({ problem: null, live: t.segments.length ? t.segments : t.live, segments: [], summary: null }));
  await transcribeAudio(talkId, audio);
}

/** Finishes talks a closed tab left half-done: whatever came back, then the write-up. */
export function resume(t: Talk) {
  if (t.status !== "transcribing" || active.has(t.id) || state.talkId === t.id) return;
  active.add(t.id);
  updateTalk(t.id, (cur) => ({ chunks: cur.chunks.map((c) => (c.status === "queued" ? { ...c, status: "failed" as const } : c)) }));
  void finish(t.id);
}

