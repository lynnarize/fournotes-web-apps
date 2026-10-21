"use client";
// Assistant state shared by the chat dock, sidebar and command palette:
// chat (with retrieval over your notes), photo OCR auto-sorting, voice recording
// -> summarized note, hands-free voice mode, and an offline outbox.
// A question is answered from numbered sources picked from your own data, and the
// answer cites them as [n] (see answerSources in lib/search.ts and assistant/cite.ts).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { serverStatus, type ServerStatus } from "@/lib/aiRoute";
import { getUserKeys, isValidKey } from "@/lib/byok";
import { api, resizeImage } from "@/lib/client";
import { markFiled, pulseTabs } from "@/lib/highlight";
import { openSettings } from "@/lib/nav";
import { answerSources, semanticNotes } from "@/lib/search";
import { activeNoteId } from "@/lib/activeNote";
import { agrees, answerOnly, groundAmounts, isQuestion, noteQuestion, savesPreviousReply } from "@/lib/intent";
import { isWorthSaving, noteContentFromReply, offersToSave, replyNoteTitle } from "@/lib/replyNote";
import { useStore, type ChangeLink, type ListKind } from "@/lib/store";
import type { AIAction, AnswerSource, ChatMessage, Note, NoteSource, Tab } from "@/lib/types";
import { citations, renumbered, sourcesText, withoutCitations } from "./assistant/cite";
import { choiceName, modelDisplayName, pickedModel } from "./ModelMenu";
import { useToast } from "./ui";

export type UIMessage = ChatMessage & {
  id: string;
  filed?: string[];
  /** Same order as `filed`: where each item landed, for "Show" buttons. */
  links?: ChangeLink[];
  /** What this reply created (not what it changed): Undo removes these. */
  newItems?: { kind: ListKind; id: string }[];
  /** Undo was used: the created items are gone. */
  undone?: boolean;
  imageUrl?: string;
  error?: boolean;
  queued?: boolean;
  /** The user stopped waiting for this reply. */
  stopped?: boolean;
  splitTxId?: string; // receipt just filed -> offer "split this bill"
  /** The user message this reply answers: titles the reply when it's saved as a note. */
  questionId?: string;
  /** On a user message sent as text: what to send again for Retry. */
  retryText?: string;
  /** Saved to Notes already, so "Save as note" isn't offered again. */
  savedAsNote?: boolean;
  /** On the "Saved it to Notes" message: the reply it saved, so Undo can offer saving again. */
  savedFrom?: string;
  /** A refusal from the server's guard: not offered as a note. */
  refused?: boolean;
  /** A reply about one of the user's notes: offers to look further on the web. */
  webTopic?: WebTopic;
  /** The pages a web answer drew on. */
  sources?: { title: string; url: string }[];
  /** The numbered items from the user's own data the answer could cite as [n]. */
  dataSources?: AnswerSource[];
  /** Which model wrote the reply, as the server reported it (or the one asked, when it doesn't say). */
  model?: string;
  /** How long the reply took to arrive, measured here, in milliseconds. */
  ms?: number;
  /** Written by the rule-based stand-in, not a model. */
  demo?: boolean;
};
/** The note a question was about, and what was asked of it. */
export type WebTopic = { noteId: string; noteTitle: string; question: string };

/** A reply worth keeping: long, and not itself a record of what was filed. */
export const canSaveAsNote = (m: UIMessage) =>
  m.role === "assistant" && !m.error && !m.refused && !m.stopped && !m.savedAsNote && !m.filed?.length && isWorthSaving(withoutCitations(m.content));

/** Retry is offered on the last reply, when it filed nothing and answers something typed. */
export function canRetry(messages: UIMessage[], m: UIMessage) {
  if (m.role !== "assistant" || m.filed?.length || !m.questionId) return false;
  const last = [...messages].reverse().find((x) => x.role === "assistant");
  return last?.id === m.id && Boolean(messages.find((x) => x.id === m.questionId)?.retryText);
}
export type VoiceState = "off" | "listening" | "thinking" | "speaking";

type Ctx = {
  messages: UIMessage[];
  busy: string | null; // label of the running job
  /** The running job is a chat reply, which Stop can cancel. */
  canStop: boolean;
  recording: boolean;
  liveTranscript: string;
  voice: VoiceState;
  queued: number;
  /** Today shows the conversation in place of its overview, with the composer at the bottom. */
  todayChat: boolean;
  setTodayChat(on: boolean): void;
  send(text: string): Promise<string | null>;
  /** Stop waiting for the reply being written. */
  stop(): void;
  /** Ask the question behind this reply again (the last reply only). */
  retry(replyId: string): void;
  /** Remove what this reply created. */
  undo(replyId: string): void;
  scan(file: Blob, source?: NoteSource): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): void;
  toggleVoice(): void;
  clear(): void;
  /** Saves an assistant reply to Notes exactly as it was shown. */
  saveAsNote(replyId: string): void;
  /** Recommendations from the web for a note, in the chat, with sources (Claude only). */
  searchWeb(topic: WebTopic): Promise<void>;
  /** The note's subject in a new tab's web search. Only those words leave the app. */
  openWebSearch(topic: WebTopic): void;
};

const AssistantCtx = createContext<Ctx | null>(null);
export const useAssistant = () => useContext(AssistantCtx)!;

const tabFor = (actions: AIAction[]): Tab | null => {
  const a = actions[0];
  if (!a) return null;
  if (a.type === "add_transaction" || a.type === "set_budget" || a.type === "split_transaction") return "finance";
  if (a.type === "create_todo" || a.type === "complete_todo" || a.type === "start_todo") return "todo";
  if (a.type === "create_note") return "notes";
  return null;
};

// Minimal typing for the Web Speech API (not in TS DOM lib everywhere).
export type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onerror: (e: { error?: string }) => void; onend: () => void; start(): void; stop(): void; abort(): void;
};
export const getSpeechRecognition = () => {
  const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return W.SpeechRecognition ?? W.webkitSpeechRecognition;
};

// ---- Speech-to-text availability ---------------------------------------------
// Recordings are transcribed on the server when there's a key (the user's or the
// app's), otherwise live in the browser. Check before recording, not after.
let serverStt: Promise<boolean> | null = null;
const serverHasStt = () =>
  (serverStt ??= fetch("/api/ai/status").then((r) => r.json()).then((d: { stt?: boolean }) => Boolean(d.stt)).catch(() => false));
const userHasStt = () => {
  const k = getUserKeys().sttKey;
  return Boolean(k && isValidKey(k));
};

const NO_STT =
  "Speech-to-text isn't set up, so recordings can't be turned into text. Add an OpenAI or Groq key in Settings → AI & API keys, or use Chrome, Edge or Safari.";
const NO_BROWSER_SPEECH = "Voice mode uses your browser's speech recognition, which this browser doesn't have. Try Chrome, Edge or Safari.";

/** Browser speech errors that mean it will never work here (others, like "no-speech", are normal). */
export function speechErrorMessage(code?: string): string | null {
  switch (code) {
    case "not-allowed":
    case "audio-capture":
      return "Microphone access is blocked. Allow the microphone for this site and try again.";
    case "service-not-allowed":
      return "This browser has speech recognition turned off. Add a speech-to-text key in Settings → AI & API keys, or try Chrome, Edge or Safari.";
    case "network":
      return "The browser's speech recognition couldn't connect (it needs internet, and some browsers such as Brave or Arc block it). Add a speech-to-text key in Settings → AI & API keys.";
    case "language-not-supported":
      return "The browser's speech recognition doesn't support this language. Add a speech-to-text key in Settings → AI & API keys.";
    default:
      return null;
  }
}

/**
 * Notes the message names outright — a quoted title (“Groceries”) or "this note" for the
 * one open in the editor — always go to the assistant in full, whatever retrieval ranks.
 */
function namedNotes(notes: Note[], text: string): Note[] {
  const live = notes.filter((n) => !n.deletedAt);
  const open = activeNoteId();
  const titles = [...text.matchAll(/[“"«]([^”"»]{1,120})[”"»]/g)].map((m) => m[1].trim().toLowerCase());
  const out: Note[] = [];
  for (const t of titles) {
    const hits = live.filter((n) => (n.title.trim() || "untitled").toLowerCase() === t);
    const pick = hits.find((n) => n.id === open) ?? hits[0];
    if (pick && !out.includes(pick)) out.push(pick);
  }
  // A note put in with "@" in the composer: "@Weekend trip ideas".
  const lower = text.toLowerCase();
  for (const n of live) {
    const t = n.title.trim().toLowerCase();
    if (t && lower.includes(`@${t}`) && !out.includes(n)) out.push(n);
  }
  if (open && /\bthis note\b/i.test(text)) {
    const n = live.find((x) => x.id === open);
    if (n && !out.includes(n)) out.unshift(n);
  }
  return out;
}

const TAB_OF: Record<string, Tab | undefined> = { notes: "notes", todos: "todo", transactions: "finance", budget: "finance", stickies: "today" };

const OUTBOX = "four-notes:outbox";
const readOutbox = (): string[] => { try { return JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"); } catch { return []; } };
const writeOutbox = (xs: string[]) => { try { localStorage.setItem(OUTBOX, JSON.stringify(xs)); } catch { /* ignore */ } };
const rid = () => Math.random().toString(36).slice(2);

export function AssistantProvider({ children, onFiled }: { children: ReactNode; onFiled: (tab: Tab) => void }) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const toast = useToast();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [recording, setRecording] = useState(false);
  const [liveTranscript, setLive] = useState("");
  const [voice, setVoice] = useState<VoiceState>("off");
  const [queued, setQueued] = useState(0);
  const recRef = useRef<{ media: MediaRecorder; speech: SpeechRec | null; chunks: Blob[]; finalText: string } | null>(null);
  /** The chat request in flight, so Stop can cancel it. */
  const abortRef = useRef<AbortController | null>(null);
  const [canStop, setCanStop] = useState(false);
  const [todayChat, setTodayChat] = useState(false);
  /** Which AI the server has, for naming the model when a reply doesn't say. */
  const serverRef = useRef<ServerStatus | null>(null);
  useEffect(() => { serverStatus().then((s) => { serverRef.current = s; }); }, []);
  const askedModel = () => choiceName(pickedModel(getUserKeys(), serverRef.current)) || undefined;

  const push = (m: Omit<UIMessage, "id">) => setMessages((xs) => [...xs, { ...m, id: rid() }]);

  const handleResult = useCallback(
    (reply: string, actions: AIAction[], extra?: { imageDataUrl?: string; source?: NoteSource; message?: Partial<UIMessage> }) => {
      const { all } = storeRef.current;
      const before = new Set([...all.notes, ...all.todos, ...all.transactions].map((x) => x.id));
      const { filed, links, transactionIds, created } = storeRef.current.applyActions(actions, extra);
      markFiled(created.map((c) => c.id));
      pulseTabs([...new Set(links.map((l) => (l ? TAB_OF[l.kind] : undefined)).filter((t): t is Tab => Boolean(t)))]);
      const isCapture = extra?.source === "ocr" || extra?.source === "share";
      // Only what didn't exist before can be undone by removing it (a task marked done, a split, a budget can't).
      const newItems = created.filter((c) => c.kind !== "stickies" && !before.has(c.id));
      push({
        role: "assistant", content: reply, filed, links, newItems: newItems.length ? newItems : undefined,
        splitTxId: isCapture ? transactionIds[0] : undefined, ...extra?.message,
      });
      if (filed.length) toast(filed.join("\n"));
      const tab = tabFor(actions);
      if (tab && extra?.source !== "chat") onFiled(tab);
    },
    [toast, onFiled],
  );

  const fail = useCallback((e: unknown, questionId?: string) => {
    const msg = e instanceof Error ? e.message : String(e);
    push({ role: "assistant", content: msg, error: true, questionId });
    toast(msg, "error");
  }, [toast]);

  /** A speech problem: say so in the chat, with a shortcut to the key settings. */
  const failSpeech = useCallback((msg: string) => {
    push({ role: "assistant", content: msg, error: true });
    toast(msg, "error", /key/i.test(msg) ? { label: "Add a key", run: () => openSettings("api", "stt") } : undefined);
  }, [toast]);

  // Ask the server once, early, so the record button can answer instantly.
  useEffect(() => { serverHasStt(); }, []);

  const send = useCallback(async (text: string): Promise<string | null> => {
    // Offline, Chrome's built-in model can still answer; otherwise the message waits.
    if (!navigator.onLine && !(await import("@/lib/ai/onDevice").then((m) => m.shouldUseOnDevice()))) {
      push({ role: "user", content: text, queued: true });
      const box = [...readOutbox(), text];
      writeOutbox(box);
      setQueued(box.length);
      toast("You're offline. The message is queued and will be sent when you reconnect.");
      return null;
    }
    const userMsg: UIMessage = { id: rid(), role: "user", content: text, retryText: text };
    // "save that" (or "yes" to a reply that offered to save itself): the reply above, saved as shown.
    // No model rewrites it — one used to save a garbled copy from memory.
    const previous = [...messagesRef.current].reverse().find((m) => m.role === "assistant" && !m.error);
    if (previous && canSaveAsNote(previous) && (savesPreviousReply(text) || (agrees(text) && offersToSave(previous.content)))) {
      setMessages((xs) => [...xs, { ...userMsg, retryText: undefined }]);
      saveRef.current(previous.id);
      return null;
    }
    // Sent with nothing after the colon, models announced "I've saved your note" and saved nothing.
    const about = noteQuestion(text);
    const asked = about && !about.ask ? `About my note “${about.title}”: give me a short summary of it and one or two useful suggestions.` : text;
    const history = [...messagesRef.current.filter((m) => !m.error && !m.queued && !m.stopped), { ...userMsg, content: asked }].map(({ role, content }) => ({ role, content }));
    setMessages((xs) => [...xs, userMsg]);
    setBusy("Thinking…");
    const abort = new AbortController();
    abortRef.current = abort;
    setCanStop(true);
    try {
      // Retrieval: send the full text of the notes most related to the question.
      const s = storeRef.current;
      const relevant = await semanticNotes(s.notes, text, 4).catch(() => []);
      const named = namedNotes(s.notes, text);
      const picked = [...named, ...relevant.filter((r) => r.score > 0.2 && !named.includes(r.note)).map((r) => r.note)].slice(0, 5);
      // A question or a request for ideas is answered, never filed.
      const question = answerOnly(text);
      // A question is answered from numbered items of the user's own data, which the answer cites as [n].
      const dataSources = question
        ? answerSources(
            { notes: s.notes, todos: s.todos, transactions: s.transactions, budgets: s.settings.budgets, categories: s.categories, currency: s.settings.currency },
            text,
            picked,
          )
        : [];
      const context = s.buildContext(picked, dataSources);
      if (abort.signal.aborted) throw new DOMException("Stopped", "AbortError");
      const started = performance.now();
      const res = await api.chat(history, context, { tools: !question, signal: abort.signal });
      const ms = performance.now() - started;
      // A question about a note is answered, never filed: models used to save the note again.
      const note = about && storeRef.current.notes.find((n) => !n.deletedAt && (n.title.trim() || "Untitled").toLowerCase() === about.title.toLowerCase());
      const webTopic = note ? { noteId: note.id, noteTitle: note.title || "Untitled", question: about!.ask } : undefined;
      // Amounts are checked against the message, whichever model answered ("25k" is not 25).
      const actions = webTopic && isQuestion(text) ? [] : groundAmounts(res.actions, text);
      // A refusal from the guard wasn't written by a model; demo replies are rule-based.
      const model = res.refused ? undefined : res.model ? modelDisplayName(res.model) : res.demo ? undefined : askedModel();
      handleResult(res.reply, actions, {
        source: "chat",
        message: {
          questionId: userMsg.id, webTopic, refused: res.refused, demo: res.demo, model, ms,
          dataSources: dataSources.length ? dataSources : undefined,
        },
      });
      return res.reply;
    } catch (e) {
      if (abort.signal.aborted) {
        push({ role: "assistant", content: "Stopped. Nothing was saved.", stopped: true, questionId: userMsg.id });
        return null;
      }
      fail(e, userMsg.id);
      return null;
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setCanStop(false);
      }
      setBusy(null);
    }
  }, [handleResult, fail, toast]);
  const sendRef = useRef(send);
  sendRef.current = send;

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const retry = useCallback((replyId: string) => {
    if (busyRef.current) return;
    const xs = messagesRef.current;
    const reply = xs.find((m) => m.id === replyId);
    const at = reply?.questionId ? xs.findIndex((m) => m.id === reply.questionId) : -1;
    const text = xs[at]?.retryText;
    if (!reply || at < 0 || !text) return;
    // The question and its reply leave the thread, then the question is asked again.
    const kept = xs.slice(0, at);
    messagesRef.current = kept;
    setMessages(kept);
    void sendRef.current(text);
  }, []);

  const undo = useCallback((replyId: string) => {
    const m = messagesRef.current.find((x) => x.id === replyId);
    if (!m?.newItems?.length || m.undone) return;
    for (const it of m.newItems) storeRef.current.remove(it.kind, it.id);
    setMessages((ms) => ms.map((x) => (x.id === replyId ? { ...x, undone: true } : x.id === m.savedFrom ? { ...x, savedAsNote: false } : x)));
    toast(m.newItems.length === 1 ? "Undone. It's been removed." : `Undone. ${m.newItems.length} items removed.`);
  }, [toast]);

  const saveAsNote = useCallback((replyId: string) => {
    const xs = messagesRef.current;
    const at = xs.findIndex((m) => m.id === replyId);
    const reply = xs[at];
    if (!reply) return;
    const question = xs.find((m) => m.id === reply.questionId)?.content
      ?? [...xs.slice(0, at)].reverse().find((m) => m.role === "user" && !agrees(m.content))?.content;
    // Citations stay readable in the note: renumbered as shown ([1]), with what they point to listed under the text.
    const cited = citations(reply.content, reply.dataSources);
    const list = sourcesText(cited.list);
    const body = noteContentFromReply(renumbered(reply.content, cited));
    const { filed, links, created } = storeRef.current.applyActions(
      [{ type: "create_note", title: replyNoteTitle(withoutCitations(reply.content), question), content: list ? `${body}\n\n${list}` : body }],
      { source: "chat" },
    );
    markFiled(created.map((c) => c.id));
    pulseTabs(["notes"]);
    setMessages((ms) => [
      ...ms.map((m) => (m.id === replyId ? { ...m, savedAsNote: true } : m)),
      { id: rid(), role: "assistant", content: "Saved it to Notes, as written.", filed, links, newItems: created.filter((c) => c.kind !== "stickies"), savedFrom: replyId },
    ]);
  }, []);
  const saveRef = useRef(saveAsNote);
  saveRef.current = saveAsNote;

  const searchWeb = useCallback(async (topic: WebTopic) => {
    const note = storeRef.current.notes.find((n) => n.id === topic.noteId && !n.deletedAt);
    if (!note) return;
    push({ role: "user", content: `Ideas from the web for “${topic.noteTitle}”` });
    setBusy("Searching the web…");
    try {
      const started = performance.now();
      const res = await api.webIdeas(note.title, note.content, topic.question);
      // Web search is Claude's: the model asked is the one that answered.
      push({ role: "assistant", content: res.text, sources: res.sources, model: askedModel(), ms: performance.now() - started });
    } catch (e) { fail(e); } finally { setBusy(null); }
  }, [fail]);

  const openWebSearch = useCallback((topic: WebTopic) => {
    const words = topic.question ? `${topic.noteTitle} ${topic.question}` : topic.noteTitle;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(words)}`, "_blank", "noopener,noreferrer");
  }, []);

  // Offline outbox: flush when the connection comes back (and on startup).
  useEffect(() => {
    if (!store.ready) return;
    setQueued(readOutbox().length);
    const flush = async () => {
      const items = readOutbox();
      if (!items.length || !navigator.onLine) return;
      writeOutbox([]);
      setQueued(0);
      setMessages((xs) => xs.filter((m) => !m.queued));
      for (const t of items) await sendRef.current(t);
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [store.ready]);

  const scan = useCallback(async (file: Blob, source: NoteSource = "ocr") => {
    setBusy("Reading the image…");
    try {
      const { blob, dataUrl, thumb } = await resizeImage(file);
      push({ role: "user", content: source === "share" ? "Shared an image" : "Scanned an image", imageUrl: dataUrl });
      const res = await api.captureImage(blob, storeRef.current.buildContext());
      handleResult(res.reply, res.actions, { imageDataUrl: thumb, source });
    } catch (e) { fail(e); } finally { setBusy(null); }
  }, [handleResult, fail]);

  const startRecording = useCallback(async () => {
    // Where will the text come from? Say so now if nowhere, before recording anything.
    const SR = getSpeechRecognition();
    const serverText = userHasStt() || (await serverHasStt());
    if (!serverText && !SR) return failSpeech(NO_STT);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const state = { media, speech: null as SpeechRec | null, chunks: [] as Blob[], finalText: "", cancelled: false };
      media.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);

      // Live transcription in the browser (the only source of text without a key).
      if (SR) {
        const speech = new SR();
        speech.lang = "en-US";
        speech.continuous = true;
        speech.interimResults = true;
        speech.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) state.finalText += r[0].transcript + " ";
            else interim += r[0].transcript;
          }
          setLive(state.finalText + interim);
        };
        speech.onerror = (e) => {
          const msg = speechErrorMessage(e.error);
          // With a key the server transcribes the audio anyway, unless the mic itself is blocked.
          if (!msg || (serverText && e.error !== "not-allowed" && e.error !== "audio-capture")) return;
          state.cancelled = true;
          if (recRef.current === state) recRef.current = null;
          setRecording(false);
          if (media.state !== "inactive") media.stop();
          failSpeech(msg);
        };
        speech.onend = () => {};
        speech.start();
        state.speech = speech;
      }

      media.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setLive("");
        if (state.cancelled) return;
        const transcript = state.finalText.trim();
        if (!serverText && !transcript) {
          return failSpeech("I didn't catch any speech. Try again a little closer to the microphone.");
        }
        const audio = new Blob(state.chunks, { type: media.mimeType || "audio/webm" });
        setBusy("Summarizing the recording…");
        push({ role: "user", content: `Voice recording${transcript ? `: “${transcript.slice(0, 120)}${transcript.length > 120 ? "…" : ""}”` : ""}` });
        try {
          const res = await api.captureAudio(audio, transcript, storeRef.current.buildContext());
          handleResult(res.reply, res.actions, { source: "recording" });
        } catch (e) { fail(e); } finally { setBusy(null); }
      };

      media.start(1000);
      recRef.current = state;
      setRecording(true);
    } catch (e) {
      failSpeech(speechErrorMessage("not-allowed")!);
      console.warn("[recording]", e);
    }
  }, [handleResult, fail, failSpeech]);

  const stopRecording = useCallback(() => {
    const s = recRef.current;
    if (!s) return;
    s.speech?.stop();
    // Give speech recognition a moment to deliver its last final result.
    setTimeout(() => { if (s.media.state !== "inactive") s.media.stop(); }, 400);
    recRef.current = null;
    setRecording(false);
  }, []);

  // ---- Voice mode: listen -> send -> speak reply -> listen again ------------------
  const voiceRef = useRef<{ on: boolean; rec: SpeechRec | null }>({ on: false, rec: null });

  const stopVoice = useCallback(() => {
    voiceRef.current.on = false;
    voiceRef.current.rec?.abort();
    voiceRef.current.rec = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    setVoice("off");
    setLive("");
  }, []);

  const listenRef = useRef<() => void>(() => {});
  listenRef.current = () => {
    const SR = getSpeechRecognition();
    if (!SR) {
      stopVoice();
      failSpeech(NO_BROWSER_SPEECH);
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";
    let fatal = false;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setLive(finalText + interim);
    };
    rec.onerror = (e) => {
      const msg = speechErrorMessage(e.error);
      if (!msg) return; // "no-speech" etc.: just listen again
      fatal = true;
      stopVoice();
      // Voice mode can't use a speech-to-text key, so don't suggest adding one.
      failSpeech(e.error === "not-allowed" || e.error === "audio-capture" ? msg : `Voice mode isn't available in this browser (${e.error}). Try Chrome, Edge or Safari.`);
    };
    rec.onend = async () => {
      voiceRef.current.rec = null;
      if (!voiceRef.current.on || fatal) return;
      const text = finalText.trim();
      setLive("");
      if (!text) return listenRef.current();
      if (/^(stop|berhenti|selesai|exit|keluar|cukup)[.!]?$/i.test(text)) return stopVoice();
      setVoice("thinking");
      const reply = await sendRef.current(text);
      if (!voiceRef.current.on) return;
      if (reply && storeRef.current.settings.voiceReplies && "speechSynthesis" in window) {
        setVoice("speaking");
        const u = new SpeechSynthesisUtterance(withoutCitations(reply).replace(/\s*\(demo mode[^)]*\)/i, "").replace(/[*_#`]/g, "").slice(0, 700));
        u.lang = "en-US";
        u.onend = u.onerror = () => { if (voiceRef.current.on) listenRef.current(); };
        speechSynthesis.speak(u);
      } else {
        listenRef.current();
      }
    };
    voiceRef.current.rec = rec;
    setVoice("listening");
    rec.start();
  };

  const toggleVoice = useCallback(() => {
    if (voiceRef.current.on) return stopVoice();
    if (recRef.current) return toast("Stop the recording first.", "error");
    if (!getSpeechRecognition()) return failSpeech(NO_BROWSER_SPEECH);
    voiceRef.current.on = true;
    toast("Voice mode is on. Speak naturally, and say “stop” to end.");
    listenRef.current();
  }, [stopVoice, toast, failSpeech]);

  useEffect(() => () => { voiceRef.current.on = false; voiceRef.current.rec?.abort(); }, []);

  return (
    <AssistantCtx.Provider
      value={{
        messages, busy, canStop, recording, liveTranscript, voice, queued, todayChat, setTodayChat,
        send, stop, retry, undo, scan, startRecording, stopRecording, toggleVoice,
        clear: () => setMessages((xs) => xs.filter((m) => m.queued)),
        saveAsNote, searchWeb, openWebSearch,
      }}
    >
      {children}
    </AssistantCtx.Provider>
  );
}
