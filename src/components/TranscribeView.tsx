"use client";
// Transcribe: conversations you record, in person or on a call (Google Meet, Zoom, a
// WhatsApp call), transcribed with who said what, written up, and searchable by the
// assistant. A list of talks beside the open one, as Notes has it; on phones the list
// comes first. Recording carries on while you use the rest of the app.
import { useEffect, useMemo, useRef, useState } from "react";
import { useBackDismiss } from "@/lib/backstack";
import { useNow } from "@/lib/hooks";
import { openSettings, useOpenItem } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { updateTalk, useTalks } from "@/lib/talks/db";
import {
  hasCaptions, installLocalSpeech, localSpeech, RecorderError, resume, serverEngine, startRecording, stopRecording,
  transcribeFile, useRecorder, type Engine, type RecordMode,
} from "@/lib/talks/recorder";
import { clock, matchesTalk, speakersOf, transcriptOf, turns } from "@/lib/talks/transcript";
import type { Talk } from "@/lib/types";
import { useAssistant } from "./assistant";
import TalkPage from "./talks/TalkPage";
import { Icon, useToast } from "./ui";

export const LANGS: [string, string][] = [
  ["en-US", "English"], ["id-ID", "Bahasa Indonesia"], ["ms-MY", "Bahasa Melayu"], ["ja-JP", "日本語"], ["ko-KR", "한국어"],
  ["zh-CN", "中文"], ["es-ES", "Español"], ["fr-FR", "Français"], ["de-DE", "Deutsch"], ["pt-BR", "Português"], ["ar-SA", "العربية"],
];
const PREFS = "four-notes:transcribe";
const readPrefs = (): { mode?: RecordMode; lang?: string } => { try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}"); } catch { return {}; } };
const defaultLang = () => {
  const nav = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
  return LANGS.find(([code]) => nav.startsWith(code.slice(0, 2)))?.[0] ?? "en-US";
};

const live = (talks: Talk[], space: string | null) => talks.filter((t) => !t.deletedAt && (t.spaceId ?? null) === space);

function listDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

export default function TranscribeView() {
  const talks = useTalks();
  const { currentSpaceId } = useStore();
  const rec = useRecorder();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { send } = useAssistant();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // A tab closed mid-transcription: finish those with what came back.
  useEffect(() => { for (const t of talks) if (t.status === "transcribing") resume(t); }, [talks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => live(talks, currentSpaceId), [talks, currentSpaceId]);
  const list = useMemo(() => mine.filter((t) => matchesTalk(t, query)), [mine, query]);
  const recordingId = rec.talkId;
  const selected = mine.find((t) => t.id === (selectedId ?? recordingId)) ?? (!mobile && !setup ? list[0] : undefined);

  useOpenItem("talk", (f) => { setQuery(""); setSetup(false); setSelectedId(f.id); setMobileOpen(true); });
  useBackDismiss(mobile && mobileOpen, () => { setMobileOpen(false); setSetup(false); });

  const open = (id: string) => { setSetup(false); setSelectedId(id); setMobileOpen(true); };
  const newRecording = () => { setSetup(true); setSelectedId(null); setMobileOpen(true); };
  const ask = () => {
    const q = query.trim();
    if (!q) return;
    // Sending opens the assistant's panel here, with the answer coming in.
    void send(/[?？]$/.test(q) ? `In my recorded talks: ${q}` : `What did my recorded talks say about ${q}?`);
  };

  const showList = mobile ? !mobileOpen : true;
  const recordingHere = rec.status !== "idle" && rec.talkId;

  return (
    <div className="-mx-4 flex min-h-0 flex-1 md:-mx-8">
      {showList && (
        <aside className="fn-aside flex min-h-0 w-full shrink-0 flex-col md:w-[331px] md:border-r md:border-[var(--border)]">
          <div className="flex min-h-0 w-full flex-1 flex-col px-3 md:w-[330px]">
            <div className="flex items-center gap-1 pb-3 pl-2 pr-1 pt-5 md:pt-6">
              <h2 className="fn-display min-w-0 flex-1 text-[28px]">Transcribe</h2>
              {rec.status === "idle" ? (
                <button onClick={newRecording} className="btn btn-primary pl-2.5 pr-3.5 max-md:h-11">
                  <Icon name="mic" size={16} /> Record
                </button>
              ) : (
                <button onClick={() => recordingHere && open(rec.talkId!)} className="btn btn-secondary pl-2.5 pr-3.5 !text-[var(--danger)] max-md:h-11">
                  <span className="recording h-2 w-2 rounded-full bg-[var(--danger)]" aria-hidden /> Recording
                </button>
              )}
            </div>
            <div className="px-1 pb-3">
              <div className="relative">
                <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); }
                    if (e.key === "Enter" && query.trim() && !list.length) ask();
                  }}
                  placeholder="Search talks"
                  aria-label="Search talks"
                  className="field pl-9 max-md:h-11"
                />
              </div>
              {query.trim().length > 1 && (
                <button onClick={ask} className="mt-2 flex w-full items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)]">
                  <Icon name="sparkle" size={14} className="shrink-0 text-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate">Ask the assistant about “{query.trim()}”</span>
                </button>
              )}
            </div>
            <div className="scroll-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-24 max-md:pb-[calc(var(--tabbar-space)+64px)]">
              <ul className="flex flex-col gap-1">
                {list.map((t) => <TalkRow key={t.id} talk={t} selected={!mobile && !setup && selected?.id === t.id} onOpen={() => open(t.id)} />)}
              </ul>
              {mine.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="font-medium">No talks yet</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">Record a conversation in person, or a Google Meet, Zoom or WhatsApp call. You get who said what, a summary, and a note if you want one.</p>
                </div>
              )}
              {mine.length > 0 && list.length === 0 && <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No talk mentions that. Ask the assistant instead.</p>}
            </div>
          </div>
        </aside>
      )}

      {(mobile ? mobileOpen : true) && (
        setup && rec.status === "idle" ? (
          <NewRecording
            onBack={mobile ? () => { setSetup(false); setMobileOpen(false); } : () => setSetup(false)}
            onStarted={(id) => { setSetup(false); setSelectedId(id); }}
          />
        ) : selected && selected.id === rec.talkId && rec.status !== "idle" ? (
          <LiveRecording talk={selected} onBack={mobile ? () => setMobileOpen(false) : undefined} />
        ) : selected ? (
          <TalkPage
            key={selected.id}
            talk={selected}
            onBack={mobile ? () => setMobileOpen(false) : undefined}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          !mobile && (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-sm text-center">
                <Icon name="wave" size={28} className="mx-auto text-[var(--text-muted)]" />
                <p className="mt-3 font-medium">Record a conversation</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">In person, or a call in another tab or app.</p>
                <button className="btn btn-primary mt-4" onClick={newRecording}><Icon name="mic" size={16} /> Record</button>
              </div>
            </div>
          )
        )
      )}
    </div>
  );
}

function TalkRow({ talk, selected, onOpen }: { talk: Talk; selected: boolean; onOpen: () => void }) {
  const people = speakersOf(talk).map((s) => s.name).filter((n) => n !== "You").slice(0, 3);
  const status = talk.status === "recording" ? "Recording" : talk.status === "transcribing" ? "Transcribing…" : "";
  return (
    <li>
      <button
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={`fn-press flex w-full flex-col gap-1.5 rounded-[var(--radius-control)] px-3.5 py-3 text-left transition-colors ${selected ? "bg-[var(--accent-subtle)]" : "hover:bg-[var(--hover)]"}`}
      >
        <span className="flex items-center gap-2">
          <Icon name={talk.mode === "call" ? "monitor" : talk.mode === "upload" ? "download" : "users"} size={14} className="shrink-0 text-[var(--text-muted)]" />
          <span className="min-w-0 flex-1 truncate font-medium">{talk.title}</span>
          <span className="fn-num shrink-0 text-xs text-[var(--text-muted)]">{listDate(talk.createdAt)}</span>
        </span>
        <span className="line-clamp-2 text-[13px] leading-normal text-[var(--text-secondary)]">
          {talk.summary?.text || turns(talk).slice(0, 2).map((x) => `${x.name}: ${x.text}`).join(" ") || "No words yet"}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--text-muted)]">
          <span className="fn-num">{clock(talk.duration)}</span>
          {talk.app && <><span aria-hidden>·</span><span>{talk.app}</span></>}
          {people.length > 0 && <><span aria-hidden>·</span><span className="truncate">{people.join(", ")}</span></>}
          {status && <span className={`badge ml-auto ${talk.status === "recording" ? "badge-danger" : "badge-info"}`}>{status}</span>}
        </span>
      </button>
    </li>
  );
}

// ---- Starting a recording -----------------------------------------------------------------
function NewRecording({ onBack, onStarted }: { onBack?: () => void; onStarted: (id: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<RecordMode>(() => readPrefs().mode ?? "room");
  const [lang, setLang] = useState(() => readPrefs().lang ?? defaultLang());
  const [title, setTitle] = useState("");
  const [engine, setEngine] = useState<Engine | "checking">("checking");
  const [speech, setSpeech] = useState("unavailable");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canCall = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia) && !/Android|iPhone|iPad/i.test(navigator.userAgent);

  useEffect(() => { void serverEngine().then(setEngine); }, []);
  // Chrome's model: transcribing here ("here": it's the one answering), or ready to take over ("fallback").
  const [device, setDevice] = useState<"here" | "fallback" | null>(null);
  useEffect(() => {
    void import("@/lib/ai/onDevice").then(async (m) => setDevice((await m.shouldTranscribeOnDevice()) ? "here" : (await m.canTranscribeOnDevice()) ? "fallback" : null));
  }, []);
  // A call picked last time on a computer can't be recorded here.
  useEffect(() => { if (!canCall && mode === "call") setMode("room"); }, [canCall, mode]);
  useEffect(() => { void localSpeech(lang).then(setSpeech); }, [lang]);
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ mode, lang })); } catch { /* storage blocked */ } }, [mode, lang]);

  const start = async () => {
    setBusy(true);
    try {
      onStarted(await startRecording({ mode, lang, title }));
    } catch (e) {
      toast(e instanceof RecorderError || e instanceof Error ? e.message : "Couldn't start recording.", "error");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      onStarted(await transcribeFile(file, lang));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't read that file.", "error", { label: "Add a key", run: () => openSettings("api", "stt") });
    } finally {
      setBusy(false);
    }
  };

  const how =
    engine === "checking" ? "" :
    device === "here" ? "Transcribed on this computer by Chrome's model, privately, telling voices apart." :
    engine === "stt" ? "Transcribed with your speech-to-text key, as you go." :
    engine === "audio" ? `Transcribed by an OpenRouter model that also tells voices apart. OpenRouter needs $0.50 of credit for audio${device === "fallback" ? "; without it, Chrome's model on this computer takes over" : ""}.` :
    device === "fallback" ? "Transcribed on this computer by Chrome's model, privately, telling voices apart." :
    hasCaptions() ? "Transcribed by your browser's live captions. A speech-to-text key gives a better transcript, and tells voices apart in person." :
    "This browser can't transcribe on its own. Add a speech-to-text key, or use Chrome or Edge.";

  const option = (id: RecordMode, icon: string, label: string, text: string, disabled?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === id}
      disabled={Boolean(disabled)}
      onClick={() => setMode(id)}
      className={`flex flex-1 basis-56 flex-col gap-1.5 rounded-[var(--radius-control)] border p-4 text-left transition-colors disabled:opacity-50 ${
        mode === id ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--border)] hover:bg-[var(--hover)]"
      }`}
    >
      <Icon name={icon} size={20} className={mode === id ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"} />
      <span className="font-medium">{label}</span>
      <span className="text-[13px] leading-snug text-[var(--text-muted)]">{disabled ?? text}</span>
    </button>
  );

  return (
    <div className="note-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--background)]">
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 md:pl-5 md:pr-4">
        {onBack && (
          <button className="btn btn-plain h-11 gap-1 pl-2 pr-3 text-[var(--foreground)]" onClick={onBack} aria-label="Back">
            <Icon name="chevronLeft" size={20} /> Back
          </button>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[clamp(16px,4vw,40px)] pb-12 pt-8 max-md:pb-[calc(var(--tabbar-space)+64px)]">
        <div className="fn-note-in mx-auto flex w-full max-w-[640px] flex-col gap-6">
          <h1 className="fn-display text-[30px]">New recording</h1>

          <div role="radiogroup" aria-label="What are you recording?" className="flex flex-wrap gap-3">
            {option("room", "users", "In person", "A meeting in a room, an interview, a chat. Put your phone or laptop between you.")}
            {option("call", "monitor", "A call or meeting", "Google Meet, Zoom, Teams or a WhatsApp call on this computer: your voice and theirs.",
              canCall ? undefined : "Needs Chrome or Edge on a computer. On a phone, record in person with the call on speaker.")}
          </div>

          {mode === "call" && (
            <ul className="flex list-disc flex-col gap-1 rounded-[var(--radius-control)] bg-[var(--surface-muted)] py-3 pl-8 pr-4 text-[13px] text-[var(--text-secondary)]">
              <li>For a call in a browser tab (Google Meet, Teams, Zoom on the web): pick its tab and keep <b>Share tab audio</b> on.</li>
              <li>For an app (WhatsApp, Zoom, Telegram): pick <b>Entire screen</b> and turn on <b>Share system audio</b>. On a Mac this needs Chrome 141 or later.</li>
              <li>Wear headphones, so your microphone doesn't pick up the other side as well.</li>
            </ul>
          )}

          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 text-[13px] text-[var(--text-muted)]">
              Name it (optional)
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly sync with Andi" className="field max-md:h-11" />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] text-[var(--text-muted)]">
              Language spoken
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="field w-auto max-md:h-11">
                {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </div>

          {how && (
            <p className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
              <Icon name="info" size={15} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <span>
                {how}{" "}
                {(engine === null || engine === "audio") && device !== "here" && (
                  <button className="underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--foreground)]" onClick={() => openSettings("api", "stt")}>Add a key</button>
                )}
              </span>
            </p>
          )}
          {engine === null && !device && speech === "downloadable" && (
            <button
              className="btn btn-secondary btn-sm self-start max-md:h-11"
              onClick={() => installLocalSpeech(lang).then((ok) => { toast(ok ? "Speech recognition is on this device now." : "The download didn't finish."); void localSpeech(lang).then(setSpeech); })}
            >
              <Icon name="download" size={14} /> Use private, on-device captions for {LANGS.find(([c]) => c === lang)?.[1]}
            </button>
          )}

          <p className="text-[13px] text-[var(--text-muted)]">Tell everyone you&apos;re recording before you start. In many places it&apos;s the law.</p>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
              <Icon name="mic" size={18} /> {mode === "call" ? "Choose what to record" : "Start recording"}
            </button>
            <button className="btn btn-plain btn-lg" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Icon name="download" size={18} className="rotate-180" /> Transcribe a file
            </button>
            <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- While recording ----------------------------------------------------------------------
function Meter({ label, level }: { label: string; level: number }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-12 shrink-0 text-[var(--text-muted)]">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <span className="block h-full rounded-full bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${Math.round(level * 100)}%` }} />
      </span>
    </div>
  );
}

function LiveRecording({ talk, onBack }: { talk: Talk; onBack?: () => void }) {
  const rec = useRecorder();
  const now = useNow(1000);
  const toast = useToast();
  const seconds = rec.startedAt ? Math.max(0, (now.getTime() - rec.startedAt) / 1000) : 0;
  const lines = turns(talk, transcriptOf(talk)).slice(-8);
  const pending = talk.chunks.filter((c) => c.status === "queued").length;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [lines.length, rec.caption]);

  const stop = () => {
    void stopRecording().catch((e) => toast(e instanceof Error ? e.message : "Couldn't stop cleanly.", "error"));
  };

  return (
    <div className="note-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--background)]">
      <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2 md:pl-5 md:pr-4">
        {onBack && (
          <button className="btn btn-plain h-11 gap-1 pl-2 pr-3 text-[var(--foreground)]" onClick={onBack} aria-label="Back to talks">
            <Icon name="chevronLeft" size={20} /> Talks
          </button>
        )}
        <span className="flex-1" />
        <button className="btn btn-danger" onClick={stop} disabled={rec.status === "stopping"}>
          <Icon name="stop" size={16} /> {rec.status === "stopping" ? "Finishing…" : "Stop"}
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[clamp(16px,4vw,40px)] pb-12 pt-8 max-md:pb-[calc(var(--tabbar-space)+64px)]">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6">
          <div className="flex items-center gap-3">
            <span className="recording h-3 w-3 shrink-0 rounded-full bg-[var(--danger)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <input
                value={talk.title}
                onChange={(e) => updateTalk(talk.id, { title: e.target.value })}
                aria-label="Talk name"
                className="input-plain fn-display w-full truncate text-[26px]"
              />
              <p className="fn-num text-[13px] text-[var(--text-muted)]" role="timer">{clock(seconds)}{talk.app ? ` · ${talk.app}` : ""}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {talk.mode === "call" ? (
              <>
                <Meter label="You" level={rec.levels.me} />
                <Meter label="Them" level={rec.levels.them} />
              </>
            ) : (
              <Meter label="Room" level={rec.levels.me} />
            )}
          </div>
          {rec.warning && (
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--surface-muted)] px-3 py-2.5 text-[13px] text-[var(--text-secondary)]">
              <Icon name="info" size={15} className="mt-0.5 shrink-0" /> {rec.warning}
            </p>
          )}
          <section aria-label="Transcript so far" aria-live="polite" className="flex flex-col gap-3">
            {lines.length === 0 && !rec.caption && (
              <p className="text-sm text-[var(--text-muted)]">
                {pending ? "Transcribing the first part…" : "Listening. Words appear here as they're transcribed, every couple of minutes, or as you speak with live captions."}
              </p>
            )}
            {lines.map((l) => (
              <p key={`${l.start}-${l.name}`} className="text-[15px] leading-relaxed">
                <span className="fn-num mr-2 text-xs text-[var(--text-muted)]">{clock(l.start)}</span>
                <span className="font-medium">{l.name}: </span>{l.text}
              </p>
            ))}
            {rec.caption && <p className="text-[15px] italic leading-relaxed text-[var(--text-muted)]">{rec.caption}</p>}
            <div ref={endRef} />
          </section>
          {pending > 0 && <p className="text-xs text-[var(--text-muted)]">{pending === 1 ? "1 part" : `${pending} parts`} being transcribed</p>}
        </div>
      </div>
    </div>
  );
}

