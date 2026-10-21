"use client";
// The Notes editor: a big, clean writing surface with a formatting toolbar.
// Rich text lives in note.html (TipTap); every change also writes note.content, the
// plain-text form that search, the assistant and the daily brief read.
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { setActiveNote } from "@/lib/activeNote";
import { api, downloadFile, fmtDateTime } from "@/lib/client";
import { canSearchWeb, lastChecked, NEEDS_CLAUDE, recheckNote, updateSection } from "@/lib/keepCurrent";
import { openAssistant, openItem, openSettings } from "@/lib/nav";
import { docToPlain, plainToHtml, taskStates, type DocNode } from "@/lib/noteText";
import { alive, formatMoney, parseAmount, useStore } from "@/lib/store";
import type { KeepCurrent, Note } from "@/lib/types";
import { guessCategory } from "@/lib/wallet";
import { useAssistant } from "../assistant";
import { useNow } from "@/lib/hooks";
import { Icon, useToast } from "../ui";
import { Dropdown, MenuItem, MenuLabel, MenuSep } from "./Dropdown";

// ---- Options ------------------------------------------------------------------------
const FONTS = [
  { label: "Sans Serif", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  { label: "Rounded", value: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif" },
];
const SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40];
const DEFAULT_SIZE = 16;
const TEXT_COLORS = [
  { label: "Default", value: "" }, { label: "Gray", value: "#787774" }, { label: "Red", value: "#d4351c" },
  { label: "Orange", value: "#b85c00" }, { label: "Yellow", value: "#946b00" }, { label: "Green", value: "#0f7b6c" },
  { label: "Blue", value: "#2f6fdd" }, { label: "Purple", value: "#9065b0" }, { label: "Pink", value: "#c14c8a" },
];
const HIGHLIGHTS = [
  { label: "None", value: "" }, { label: "Yellow", value: "#fde68a" }, { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" }, { label: "Pink", value: "#fbcfe8" }, { label: "Purple", value: "#ddd6fe" },
  { label: "Orange", value: "#fed7aa" },
];

const TEMPLATES: { label: string; icon: string; body: () => string; title?: string }[] = [
  {
    label: "Meeting notes", icon: "users", title: "Meeting notes",
    body: () => `**Date:** ${today()}\n**Attendees:** \n\n## Agenda\n- \n\n## Notes\n\n## Action items\n☐ `,
  },
  { label: "To-do list", icon: "checklist", title: "To-do", body: () => "☐ \n☐ \n☐ " },
  {
    label: "Daily journal", icon: "today", title: today(),
    body: () => "## Grateful for\n- \n\n## Today's focus\n- \n\n## Notes\n",
  },
  {
    label: "Trip plan", icon: "calendar", title: "Trip to …",
    body: () => "**Dates:** \n**Budget:** \n\n## Itinerary\n- Day 1: \n\n## Packing\n☐ Passport / ID\n☐ Charger\n☐ ",
  },
  {
    label: "Budget plan", icon: "finance", title: `Budget ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    body: () => "## Income\n- Salary: \n\n## Spending\n- Rent: \n- Food: \n- Transport: \n- Bills: \n\n## Saving\n- ",
  },
  {
    label: "Study notes", icon: "note", title: "Study notes",
    body: () => "## Topic\n\n## Key ideas\n- \n\n## Questions\n- \n\n## Summary\n",
  },
];

const ASK_PROMPTS = [
  "Write a note: agenda for a meeting about ",
  "Write a note: packing list for a trip to ",
  "Write a note: weekly meal plan on a budget of ",
];

// The "/" menu: things this line can become elsewhere in the app, then ways to shape it.
const SLASH = [
  { id: "todo", label: "To-do", hint: "A task linked to this note", icon: "todo", group: "do" },
  { id: "remind", label: "Remind me tomorrow", hint: "A task with a reminder at 9:00", icon: "bell", group: "do" },
  { id: "expense", label: "Expense", hint: "Log what you spent, like lunch 45k", icon: "finance", group: "do" },
  { id: "sticky", label: "Sticky", hint: "Pin this line to the top", icon: "pin", group: "do" },
  { id: "ask", label: "Ask AI", hint: "Send this line to the assistant", icon: "sparkle", group: "do" },
  { id: "checklist", label: "Checklist", hint: "Items to tick off", icon: "checklist", group: "format" },
  { id: "bullet", label: "Bulleted list", hint: "A plain list", icon: "listBullet", group: "format" },
  { id: "numbered", label: "Numbered list", hint: "A list in order", icon: "listOrdered", group: "format" },
  { id: "heading", label: "Heading", hint: "A section title", icon: "textSize", group: "format" },
  { id: "quote", label: "Quote", hint: "Set a passage apart", icon: "quote", group: "format" },
  { id: "divider", label: "Divider", hint: "A line between sections", icon: "divider", group: "format" },
  { id: "date", label: "Today's date", hint: "Insert the date", icon: "calendar", group: "format" },
  { id: "time", label: "Time", hint: "Insert the time now", icon: "clock", group: "format" },
] as const;
type SlashId = (typeof SLASH)[number]["id"];

const AI_TASKS = [
  { id: "summarize", label: "Summarize", icon: "listBullet", result: "Summary" },
  { id: "improve", label: "Improve writing", icon: "sparkle", result: "Improved" },
  { id: "fix", label: "Fix spelling and grammar", icon: "check", result: "Corrected" },
  { id: "shorter", label: "Make shorter", icon: "shrink", result: "Shorter version" },
  { id: "continue", label: "Continue writing", icon: "arrowRight", result: "Continuation" },
] as const;
type AiTask = (typeof AI_TASKS)[number]["id"];
/** What the suggestion card can hold: a writing task's result, or a note written from the interview. */
type AiResult = AiTask | "interview";
const RESULT_LABEL: Record<AiResult, string> = { ...Object.fromEntries(AI_TASKS.map((t) => [t.id, t.result])), interview: "Your note, written up" } as Record<AiResult, string>;
/** The interview stops asking after this many answers and writes the note. */
const INTERVIEW_MAX = 6;

function today() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const keep = (e: React.MouseEvent) => e.preventDefault();

/** A plain toolbar button that doesn't steal the editor's selection. */
function TB({ icon, label, onClick, active, disabled, className = "" }: {
  icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={keep}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`tb-btn ${className}`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/** A round icon button in the top bar and footer (44px on phones). */
function IconBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-plain btn-icon max-md:h-11 max-md:w-11" onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={18} />
    </button>
  );
}

/** Where a note came from, when it wasn't typed here. */
const SOURCE_NAME: Partial<Record<Note["source"], string>> = {
  chat: "Written by the assistant", ocr: "Scanned", recording: "Voice recording", share: "Shared",
};

/** A run of related tools, after a hairline; it wraps as one piece. */
const Group = ({ children }: { children: React.ReactNode }) => (
  <div className="flex shrink-0 items-center gap-0.5">
    <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)]" />
    {children}
  </div>
);

const TOOLBAR_KEY = "four-notes:toolbar-expanded";

/**
 * The formatting tools in one slim pill; the chevron at its end shows the rest on lines
 * below, and hides them again. It is only there when they don't all fit.
 */
function Toolbar({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { setExpanded(localStorage.getItem(TOOLBAR_KEY) === "1"); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Wrapped onto a second line means some tools are out of sight while collapsed.
    const check = () => {
      const kids = [...el.children] as HTMLElement[];
      setOverflows(kids.some((k) => k.offsetTop > kids[0].offsetTop + 4));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const toggle = () => {
    setExpanded((v) => {
      try { localStorage.setItem(TOOLBAR_KEY, v ? "0" : "1"); } catch { /* storage blocked */ }
      return !v;
    });
  };
  return (
    <div role="toolbar" aria-label="Formatting" className="relative rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-1 [@media(pointer:coarse)]:rounded-[26px]">
      <div
        ref={ref}
        className={`flex flex-wrap items-center gap-y-1 overflow-hidden transition-[max-height] duration-300 ${
          overflows ? "pr-9 [@media(pointer:coarse)]:pr-12" : ""
        } ${expanded ? "max-h-[400px]" : "max-h-8 [@media(pointer:coarse)]:max-h-11"}`}
      >
        {children}
      </div>
      {overflows && (
        <button
          type="button"
          onMouseDown={keep}
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer tools" : "Show all tools"}
          title={expanded ? "Show fewer tools" : "Show all tools"}
          className="tb-btn absolute right-1 top-1 bg-[var(--surface)]"
        >
          <Icon name="chevronDown" size={16} className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

/** "just now", "5 minutes ago", "yesterday", "on Oct 12". */
function ago(iso: string, now: Date) {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minute${Math.floor(s / 60) === 1 ? "" : "s"} ago`;
  const d = new Date(iso);
  if (s < 86_400 && d.getDate() === now.getDate()) return `${Math.floor(s / 3600)} hour${Math.floor(s / 3600) === 1 ? "" : "s"} ago`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return `on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}`;
}

export default function NoteEditor({ note, onBack, listHidden, onToggleList, focusMode, onToggleFocus, anim, onAnimDone }: {
  note: Note;
  /** Phones: back to the list. */
  onBack?: () => void;
  listHidden?: boolean;
  onToggleList?: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  /** The card's transition (see .note-card[data-anim] in globals.css). */
  anim?: string;
  onAnimDone?: () => void;
}) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const { send } = useAssistant();
  const toast = useToast();
  const noteRef = useRef(note);
  noteRef.current = note;

  const [status, setStatus] = useState<"saved" | "saving">("saved");
  // The "/" menu opens under the caret, or above it near the bottom of the window.
  const [slash, setSlash] = useState<{ from: number; query: string; x: number; top?: number; bottom?: number; active: number } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const [aiBusy, setAiBusy] = useState<AiTask | null>(null);
  const [ai, setAi] = useState<{ task: AiResult; text: string; range: { from: number; to: number } | null } | null>(null);
  // Interview mode: the assistant asks, you answer, and it writes the note from your answers.
  const [interview, setInterview] = useState<{ answers: { q: string; a: string }[]; question: string | null; draft: string; busy: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop(): void } | null>(null);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // ---- Saving (debounced) ---------------------------------------------------------
  const initialHtml = useRef(note.html ?? plainToHtml(note.content));
  const lastSaved = useRef(initialHtml.current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const tasksRef = useRef<Map<string, boolean>>(new Map());

  const persist = useCallback(() => {
    timer.current = null;
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const html = ed.getHTML();
    lastSaved.current = html;
    storeRef.current.updateNote(noteRef.current.id, { html, content: docToPlain(ed.getJSON() as DocNode) });
    setStatus("saved");
  }, []);

  /** Ticking a checklist item ticks the to-do linked to this note with the same title. */
  const syncTicks = useCallback((ed: Editor) => {
    const next = taskStates(ed.getJSON() as DocNode);
    for (const [title, checked] of next) {
      if (tasksRef.current.get(title) === undefined || tasksRef.current.get(title) === checked) continue;
      const linked = alive(storeRef.current.todos).find((t) => t.noteId === noteRef.current.id && t.title.trim() === title);
      if (linked && linked.done !== checked) {
        const extra = storeRef.current.toggleTodo(linked.id, checked);
        if (extra.length) toast(extra.join("\n"));
      }
    }
    tasksRef.current = next;
  }, [toast]);

  const detectSlash = useCallback((ed: Editor) => {
    const { $from, empty } = ed.state.selection;
    if (!empty || !$from.parent.isTextblock) return setSlash(null);
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const m = before.match(/(^|\s)\/([\w-]{0,14})$/);
    if (!m) return setSlash(null);
    const c = ed.view.coordsAtPos($from.pos);
    const below = window.innerHeight - c.bottom;
    const place = below < 380 && c.top > below ? { bottom: window.innerHeight - c.top + 6 } : { top: c.bottom + 6 };
    setSlash((s) => ({
      from: $from.pos - m[2].length - 1,
      query: m[2],
      x: Math.max(8, Math.min(c.left - 18, window.innerWidth - 328)),
      ...place,
      active: s?.query === m[2] ? s.active : 0,
    }));
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      TextStyleKit.configure({ lineHeight: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Superscript,
      Subscript,
      CharacterCount,
      Placeholder.configure({ placeholder: "Start writing… type / for commands" }),
    ],
    content: initialHtml.current,
    editorProps: {
      attributes: { class: "fn-editor", "aria-label": "Note content", spellcheck: "true" },
      handleKeyDown: (_view, e) => {
        const s = slashRef.current;
        if (!s) return false;
        const items = filtered(s.query);
        if (!items.length) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const d = e.key === "ArrowDown" ? 1 : -1;
          setSlash({ ...s, active: (s.active + d + items.length) % items.length });
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          runSlashRef.current(items[Math.min(s.active, items.length - 1)].id);
          return true;
        }
        if (e.key === "Escape") {
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed;
      tasksRef.current = taskStates(ed.getJSON() as DocNode);
      // An empty transaction so the toolbar and the template picker read the initial state.
      queueMicrotask(() => { if (!ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta("addToHistory", false)); });
    },
    onUpdate: ({ editor: ed }) => {
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(persist, 400);
      syncTicks(ed);
      detectSlash(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => detectSlash(ed),
    onBlur: () => setTimeout(() => setSlash(null), 150),
  });

  // Let the notes list ask whether this note has text, even before the save lands.
  useEffect(() => {
    const id = note.id;
    setActiveNote({ id, hasText: () => Boolean(editorRef.current && !editorRef.current.isDestroyed && !editorRef.current.isEmpty) });
    return () => setActiveNote(null, id);
  }, [note.id]);

  // Save anything pending when switching notes or leaving the tab.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      persist();
    }
    recRef.current?.stop();
  }, [persist]);

  // Another device changed this note (sync): show it, unless you're typing in it.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const incoming = note.html ?? plainToHtml(note.content);
    if (incoming !== lastSaved.current) {
      editor.commands.setContent(incoming, { emitUpdate: false });
      lastSaved.current = incoming;
      tasksRef.current = taskStates(editor.getJSON() as DocNode);
    }
  }, [editor, note.html, note.content]);

  // Title grows onto more lines instead of scrolling sideways.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [note.title, focusMode, listHidden]);

  const ui = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return null;
      const ts = ed.getAttributes("textStyle") as { fontFamily?: string; fontSize?: string; color?: string };
      return {
        bold: ed.isActive("bold"), italic: ed.isActive("italic"), underline: ed.isActive("underline"), strike: ed.isActive("strike"),
        superscript: ed.isActive("superscript"), subscript: ed.isActive("subscript"),
        bullet: ed.isActive("bulletList"), ordered: ed.isActive("orderedList"), task: ed.isActive("taskList"),
        quote: ed.isActive("blockquote"), code: ed.isActive("codeBlock"),
        heading: ([1, 2, 3] as const).find((l) => ed.isActive("heading", { level: l })) ?? 0,
        align: (["center", "right"] as const).find((a) => ed.isActive({ textAlign: a })) ?? "left",
        font: ts.fontFamily ?? "",
        size: ts.fontSize ? parseInt(ts.fontSize, 10) : DEFAULT_SIZE,
        color: ts.color ?? "",
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
        inList: ed.isActive("listItem") || ed.isActive("taskItem"),
        empty: ed.isEmpty,
        words: ed.storage.characterCount?.words?.() ?? 0,
      };
    },
  });

  // ---- "/" commands -------------------------------------------------------------------
  const filtered = (q: string) =>
    SLASH.filter((c) => c.id.startsWith(q.toLowerCase()) || c.label.toLowerCase().includes(q.toLowerCase()));

  const runSlash = (id: SlashId) => {
    const ed = editorRef.current;
    const s = slashRef.current;
    if (!ed || !s) return;
    setSlash(null);
    ed.chain().focus().deleteRange({ from: s.from, to: ed.state.selection.from }).run();
    const { $from } = ed.state.selection;
    const line = $from.parent.textContent.replace(/⏰/g, "").trim();
    const blockStart = $from.start();
    const blockEnd = $from.end();
    const needLine = () => toast("Type something on this line first, then use the command.", "error");
    const { addTodo, addTransaction, addSticky } = storeRef.current;
    const n = noteRef.current;
    const asTask = () => { if (!ed.isActive("taskList")) ed.chain().focus().toggleTaskList().run(); };

    switch (id) {
      case "todo":
        if (!line) return needLine();
        addTodo({ title: line, noteId: n.id });
        asTask();
        toast(`✅ Task added and linked: ${line}`);
        break;
      case "remind": {
        if (!line) return needLine();
        const at = new Date();
        at.setDate(at.getDate() + 1);
        at.setHours(9, 0, 0, 0);
        addTodo({ title: line, noteId: n.id, dueAt: at.toISOString(), remindAt: at.toISOString() });
        ed.chain().focus().insertContentAt(blockEnd, " ⏰").run();
        asTask();
        toast(`⏰ Reminder ${fmtDateTime(at.toISOString())}: ${line}`);
        break;
      }
      case "expense": {
        const amount = line ? parseAmount(line) : null;
        if (!amount) return toast("Add an amount on the line, e.g. “lunch 45k”.", "error");
        const merchant = line.replace(/(rp|idr)?\.?\s*\d[\d.,]*\s*(rb|ribu|k|jt|juta)?\b/gi, "").replace(/\s{2,}/g, " ").trim() || "Expense";
        const tx = addTransaction({ merchant, amount, category: guessCategory(line), noteId: n.id });
        ed.chain().focus().insertContentAt(blockStart, "💸 ").run();
        toast(`💸 Logged ${formatMoney(amount, tx.currency)} (${tx.category})`);
        break;
      }
      case "sticky":
        if (!line) return needLine();
        addSticky({ text: line });
        toast("📌 Pinned to the sticky bar");
        break;
      case "ask":
        if (!line) return needLine();
        send(`${line}\n\n(Context: from my note “${n.title || "Untitled"}”)`);
        break;
      case "checklist": ed.chain().focus().toggleTaskList().run(); break;
      case "bullet": ed.chain().focus().toggleBulletList().run(); break;
      case "numbered": ed.chain().focus().toggleOrderedList().run(); break;
      case "heading": ed.chain().focus().toggleHeading({ level: 2 }).run(); break;
      case "quote": ed.chain().focus().toggleBlockquote().run(); break;
      case "divider": ed.chain().focus().setHorizontalRule().run(); break;
      case "date": ed.chain().focus().insertContent(today()).run(); break;
      case "time": ed.chain().focus().insertContent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })).run(); break;
    }
  };
  const runSlashRef = useRef(runSlash);
  runSlashRef.current = runSlash;

  // ---- Toolbar actions ------------------------------------------------------------------
  const chain = () => editor!.chain().focus();

  const insertLink = () => {
    const prev = (editor?.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Link address", prev || "https://");
    if (url === null) return;
    if (!url.trim()) return chain().extendMarkRange("link").unsetLink().run();
    const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    chain().extendMarkRange("link").setLink({ href }).run();
  };

  const dictate = () => {
    if (listening) return recRef.current?.stop();
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return toast("Dictation uses your browser's speech recognition. Try Chrome, Edge or Safari.", "error");
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) editorRef.current?.chain().focus().insertContent(e.results[i][0].transcript.trim() + " ").run();
      }
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      toast(e.error === "not-allowed" || e.error === "audio-capture" ? "Microphone access is blocked for this site." : `Dictation stopped (${e.error}).`, "error");
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    rec.start();
    setListening(true);
    editor?.commands.focus();
  };

  const runAi = async (task: AiTask) => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const useSelection = !empty && task !== "continue";
    const text = useSelection ? editor.state.doc.textBetween(from, to, "\n") : docToPlain(editor.getJSON() as DocNode);
    if (!text.trim()) return toast("Write something first, or select the text you want help with.", "error");
    setAiBusy(task);
    setAi(null);
    try {
      const res = await api.write(task, text, note.title);
      setAi({ task, text: res.text, range: useSelection ? { from, to } : null });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The AI couldn't do that right now.", "error");
    } finally {
      setAiBusy(null);
    }
  };

  const applyAi = (mode: "replace" | "below") => {
    if (!editor || !ai) return;
    const html = plainToHtml(ai.text);
    if (mode === "replace") {
      if (ai.range) chain().insertContentAt(ai.range, html).run();
      else editor.commands.setContent(html, { emitUpdate: true });
    } else {
      chain().insertContentAt(ai.range ? ai.range.to : editor.state.doc.content.size, html).run();
    }
    setAi(null);
    toast("✨ Added to your note. Undo with ⌘Z / Ctrl+Z if it's not right.");
  };

  // ---- Interview ---------------------------------------------------------------------
  const interviewInput = (answers: { q: string; a: string }[]) => ({ title: note.title, content: plain().slice(0, 4000), answers });
  const askNext = async (answers: { q: string; a: string }[]) => {
    setInterview({ answers, question: null, draft: "", busy: true });
    try {
      const { question } = await api.agent("interviewAsk", interviewInput(answers));
      setInterview({ answers, question: question.trim(), draft: "", busy: false });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The assistant couldn't ask right now.", "error");
      setInterview(answers.length ? { answers, question: null, draft: "", busy: false } : null);
    }
  };
  const writeUp = async (answers: { q: string; a: string }[]) => {
    setInterview((s) => s && { ...s, busy: true });
    try {
      const { markdown } = await api.agent("interviewWrite", interviewInput(answers));
      setInterview(null);
      setAi({ task: "interview", text: markdown.trim(), range: null });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The assistant couldn't write it up right now.", "error");
      setInterview((s) => s && { ...s, busy: false });
    }
  };
  const answer = () => {
    if (!interview?.question || !interview.draft.trim()) return;
    const answers = [...interview.answers, { q: interview.question, a: interview.draft.trim() }];
    if (answers.length >= INTERVIEW_MAX) void writeUp(answers);
    else void askNext(answers);
  };

  // ---- Keep current ------------------------------------------------------------------
  const checkNow = async (kc: KeepCurrent) => {
    setChecking(true);
    try {
      const changed = await recheckNote({ ...noteRef.current, keepCurrent: kc }, store.updateNote);
      toast(changed ? "Found changes since you wrote this. They're at the top of the note." : `Nothing has changed. It'll be checked again in a ${kc.every}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't check the web right now.", "error");
    } finally {
      setChecking(false);
    }
  };
  const keepCurrentOn = async () => {
    if (!(await canSearchWeb())) return toast(NEEDS_CLAUDE, "error", { label: "Add a key", run: () => openSettings("api") });
    const kc: KeepCurrent = { every: "month", checkedAt: null };
    store.updateNote(note.id, { keepCurrent: kc });
    void checkNow(kc);
  };
  const applyUpdate = (add: boolean) => {
    const kc = note.keepCurrent;
    const u = kc?.update;
    if (!kc || !u) return;
    if (add && editor) chain().insertContentAt(editor.state.doc.content.size, plainToHtml(updateSection(u))).run();
    store.updateNote(note.id, { keepCurrent: { ...kc, checkedAt: u.at, update: null } });
    if (add) toast("Added to the end of the note. Undo with ⌘Z / Ctrl+Z if it's not right.");
  };

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    if (!editor) return;
    editor.commands.setContent(plainToHtml(t.body()), { emitUpdate: true });
    if ((!note.title.trim() || note.title === "Untitled") && t.title) store.updateNote(note.id, { title: t.title });
    chain().focus("end").run();
  };

  const plain = () => (editor ? docToPlain(editor.getJSON() as DocNode) : note.content);

  const share = async () => {
    const text = `${note.title || "Untitled"}\n\n${plain()}`;
    if (navigator.share) {
      try { await navigator.share({ title: note.title || "Note", text }); } catch { /* cancelled */ }
      return;
    }
    await navigator.clipboard.writeText(text).catch(() => {});
    toast("Copied the note. Paste it anywhere to share.");
  };

  const copy = async () => {
    await navigator.clipboard.writeText(`${note.title || "Untitled"}\n\n${plain()}`).catch(() => {});
    toast("Note copied");
  };

  const print = () => {
    const w = window.open("", "_blank", "noopener=no");
    if (!w || !editor) return toast("Allow pop-ups to print.", "error");
    w.document.write(
      `<!doctype html><meta charset="utf-8"><title>${esc(note.title || "Note")}</title>` +
        `<style>body{font-family:'Open Sans',system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.65;color:#111}` +
        `h1{font-size:30px}ul[data-type=taskList]{list-style:none;padding-left:4px}li[data-checked=true]>div{text-decoration:line-through;color:#888}` +
        `blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:14px;color:#555}</style>` +
        `<h1>${esc(note.title || "Untitled")}</h1>${editor.getHTML()}`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const duplicate = () => {
    const copyNote = store.addNote({ title: note.title.trim() ? `${note.title} copy` : "Untitled copy", content: plain(), html: editor?.getHTML(), tags: [...note.tags], source: note.source, imageDataUrl: note.imageDataUrl });
    openItem("note", copyNote.id);
    toast("Note duplicated");
  };

  // No "are you sure?": the toast offers Undo instead, as the macOS app does.
  const del = () => {
    const id = note.id;
    if (focusMode) onToggleFocus();
    store.remove("notes", id);
    toast("Note deleted", "ok", { label: "Undo", run: () => { storeRef.current.updateNote(id, { deletedAt: null }); openItem("note", id); } });
    onBack?.();
  };

  const addTag = (raw: string) => {
    const tag = raw.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30);
    if (tag && !note.tags.includes(tag)) store.updateNote(note.id, { tags: [...note.tags, tag] });
    setTagDraft(null);
  };

  const setReminder = (at: Date) => {
    if (Number.isNaN(at.getTime())) return;
    store.addTodo({ title: note.title || "Look at this note", noteId: note.id, dueAt: at.toISOString(), remindAt: at.toISOString() });
    toast(`⏰ Reminder set for ${fmtDateTime(at.toISOString())}`);
  };
  /** In an hour; or a day or a week from now, at 9:00. */
  const remindIn = (hours: number) => {
    const at = new Date(Date.now() + hours * 3_600_000);
    if (hours >= 24) at.setHours(9, 0, 0, 0);
    setReminder(at);
  };
  const [pickReminder, setPickReminder] = useState(false);

  const linkedTodos = alive(store.todos).filter((t) => t.noteId === note.id);
  const linkedTxs = alive(store.transactions).filter((t) => t.noteId === note.id);
  const slashItems = slash ? filtered(slash.query) : [];
  const slashActive = slash ? slashItems[Math.min(slash.active, slashItems.length - 1)]?.id : undefined;
  // Keep the highlighted command in view while the arrows move through a long list.
  useEffect(() => {
    if (slashActive) document.getElementById(`slash-${slashActive}`)?.scrollIntoView({ block: "nearest" });
  }, [slashActive]);
  const now = useNow(30_000);
  const tomorrow9 = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  })();
  const fontLabel = FONTS.find((f) => f.value === (ui?.font ?? ""))?.label ?? "Custom";
  const textStyleLabel = ui?.heading ? `Heading ${ui.heading}` : ui?.quote ? "Quote" : ui?.code ? "Code" : "Normal text";
  const created = new Date(note.createdAt);
  const column = `mx-auto w-full ${focusMode ? "max-w-[720px]" : "max-w-[680px]"}`;
  const words = ui?.words ?? 0;
  const askAbout = () => openAssistant(`About my note “${note.title.trim() || "Untitled"}”: `);

  return (
    <div
      data-anim={anim}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onAnimDone?.(); }}
      className={`note-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--background)] ${
        focusMode ? "fixed inset-0 z-[45] pt-[env(safe-area-inset-top)]" : ""
      }`}
    >
      {/* Top bar: where you are, whether it's saved, and what you can do with the note. */}
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 md:pl-5 md:pr-4">
        {onBack ? (
          <button className="btn btn-plain h-11 gap-1 pl-2 pr-3 text-[var(--foreground)]" onClick={onBack} aria-label="Back to notes">
            <Icon name="chevronLeft" size={20} /> Notes
          </button>
        ) : (
          onToggleList && !focusMode && (
            <IconBtn icon={listHidden ? "collapseRight" : "collapseLeft"} label={listHidden ? "Show note list" : "Hide note list"} onClick={onToggleList} />
          )
        )}
        <IconBtn icon={focusMode ? "shrink" : "expand"} label={focusMode ? "Exit focus mode (Esc)" : "Focus mode"} onClick={onToggleFocus} />
        <nav className="ml-1.5 hidden min-w-0 flex-1 items-center gap-1.5 text-[13px] text-[var(--text-muted)] sm:flex" aria-label="Breadcrumb">
          <span className="shrink-0">Notes</span>
          <Icon name="chevron" size={14} className="shrink-0" />
          <span aria-current="page" className="truncate text-[var(--text-secondary)]">{note.title || "Untitled"}</span>
        </nav>
        <span className="flex-1 sm:hidden" />
        <span className="mr-1.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--text-muted)]" role="status">
          {status === "saving" ? "Saving…" : <><Icon name="check" size={14} /> Saved</>}
        </span>
        <button className="btn btn-secondary max-sm:w-11 max-sm:px-0 max-md:h-11" onClick={share} aria-label="Share">
          <Icon name="share" size={16} /> <span className="max-sm:hidden">Share</span>
        </button>
        <Dropdown label="More actions" button={<Icon name="more" size={18} />} width={230} align="right" chevron={false} className="btn btn-plain btn-icon max-md:h-11 max-md:w-11">
          {(close) => (
            <>
              <MenuItem icon="copy" label="Copy note text" onSelect={() => { close(); void copy(); }} />
              <MenuItem icon="noteAdd" label="Duplicate" onSelect={() => { close(); duplicate(); }} />
              <MenuItem icon="download" label="Download as text" onSelect={() => {
                close();
                downloadFile(`${(note.title || "note").replace(/[^\w\- ]+/g, "").trim() || "note"}.txt`, `${note.title}\n\n${plain()}\n`, "text/plain");
              }} />
              <MenuItem icon="print" label="Print" onSelect={() => { close(); print(); }} />
              <MenuSep />
              {note.keepCurrent ? (
                <>
                  <MenuItem icon="search" label={checking ? "Checking the web…" : "Check for changes now"} onSelect={() => { close(); if (!checking && note.keepCurrent) void checkNow(note.keepCurrent); }} />
                  <MenuItem icon="x" label="Stop keeping current" onSelect={() => { close(); store.updateNote(note.id, { keepCurrent: null }); toast("This note won't be checked any more."); }} />
                </>
              ) : (
                <MenuItem icon="repeat" label="Keep this note current" onSelect={() => { close(); void keepCurrentOn(); }} />
              )}
              <MenuSep />
              <MenuItem icon="trash" label="Delete note" danger onSelect={() => { close(); del(); }} />
            </>
          )}
        </Dropdown>
      </div>

      {/* Toolbar: one slim pill, the groups from the most used to the least; the chevron shows the rest. */}
      <div className="shrink-0 px-[clamp(16px,4vw,40px)] pt-3">
        <div className={column}>
          <Toolbar>
            <Dropdown label="Insert" chevron={false} button={<Icon name="plus" size={18} />} width={240}>
              {(close) => (
                <>
                  <MenuItem icon="checklist" label="Checklist" onSelect={() => { close(); chain().toggleTaskList().run(); }} />
                  <MenuItem icon="listBullet" label="Bulleted list" onSelect={() => { close(); chain().toggleBulletList().run(); }} />
                  <MenuItem icon="listOrdered" label="Numbered list" onSelect={() => { close(); chain().toggleOrderedList().run(); }} />
                  <MenuItem icon="quote" label="Quote" onSelect={() => { close(); chain().toggleBlockquote().run(); }} />
                  <MenuItem icon="code" label="Code block" onSelect={() => { close(); chain().toggleCodeBlock().run(); }} />
                  <MenuItem icon="divider" label="Divider" onSelect={() => { close(); chain().setHorizontalRule().run(); }} />
                  <MenuSep />
                  <MenuItem icon="link" label="Link…" onSelect={() => { close(); insertLink(); }} />
                  <MenuItem icon="calendar" label="Today's date" onSelect={() => { close(); chain().insertContent(today()).run(); }} />
                  <MenuItem icon="clock" label="Current time" onSelect={() => { close(); chain().insertContent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })).run(); }} />
                </>
              )}
            </Dropdown>
            <Group>
              <Dropdown label="Text style" title={textStyleLabel} button={<Icon name="textSize" size={18} />} width={220} chevron={false}>
                {(close) => (
                  <>
                    <MenuItem label="Normal text" active={textStyleLabel === "Normal text"} onSelect={() => { close(); chain().setParagraph().run(); }} />
                    {([1, 2, 3] as const).map((l) => (
                      <MenuItem key={l} label={`Heading ${l}`} active={ui?.heading === l} onSelect={() => { close(); chain().toggleHeading({ level: l }).run(); }} />
                    ))}
                    <MenuItem label="Quote" active={!!ui?.quote} onSelect={() => { close(); chain().toggleBlockquote().run(); }} />
                    <MenuItem label="Code" active={!!ui?.code} onSelect={() => { close(); chain().toggleCodeBlock().run(); }} />
                  </>
                )}
              </Dropdown>
              <Dropdown label="Font" button={<span className="w-[4.4rem] truncate text-left text-[13px]">{fontLabel}</span>} width={220}>
                {(close) => FONTS.map((f) => (
                  <MenuItem key={f.label} label={f.label} active={(ui?.font ?? "") === f.value} onSelect={() => {
                    close();
                    if (f.value) chain().setFontFamily(f.value).run();
                    else chain().unsetFontFamily().run();
                  }} />
                ))}
              </Dropdown>
              <Dropdown label="Font size" button={<span className="fn-num w-6 text-[13px]">{ui?.size ?? DEFAULT_SIZE}</span>} width={140}>
                {(close) => SIZES.map((sz) => (
                  <MenuItem key={sz} label={String(sz)} active={(ui?.size ?? DEFAULT_SIZE) === sz} onSelect={() => {
                    close();
                    if (sz === DEFAULT_SIZE) chain().unsetFontSize().run();
                    else chain().setFontSize(`${sz}px`).run();
                  }} />
                ))}
              </Dropdown>
            </Group>
            <Group>
              <TB icon="bold" label="Bold (⌘B)" onClick={() => chain().toggleBold().run()} active={ui?.bold} />
              <TB icon="italic" label="Italic (⌘I)" onClick={() => chain().toggleItalic().run()} active={ui?.italic} />
              <TB icon="underline" label="Underline (⌘U)" onClick={() => chain().toggleUnderline().run()} active={ui?.underline} />
              <TB icon="strike" label="Strikethrough" onClick={() => chain().toggleStrike().run()} active={ui?.strike} />
            </Group>
            <Group>
              <TB icon="listBullet" label="Bulleted list" onClick={() => chain().toggleBulletList().run()} active={ui?.bullet} />
              <TB icon="listOrdered" label="Numbered list" onClick={() => chain().toggleOrderedList().run()} active={ui?.ordered} />
              <TB icon="checklist" label="Checklist" onClick={() => chain().toggleTaskList().run()} active={ui?.task} />
            </Group>
            <Group>
              <Dropdown label="AI" title="AI writing help" chevron={false} width={260} button={
                <>
                  {aiBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" /> : <Icon name="sparkle" size={17} className="text-[var(--accent)]" />}
                  <span className="text-[13px] text-[var(--foreground)]">Ask AI</span>
                </>
              }>
                {(close) => (
                  <>
                    <MenuLabel>{editor && !editor.state.selection.empty ? "For the selected text" : "For this note"}</MenuLabel>
                    {AI_TASKS.map((t) => (
                      <MenuItem key={t.id} icon={t.icon} label={t.label} onSelect={() => { close(); void runAi(t.id); }} />
                    ))}
                    <MenuItem icon="users" label="Interview me" onSelect={() => { close(); setAi(null); void askNext([]); }} />
                    <MenuSep />
                    <MenuItem icon="todo" label="Turn into to-dos…" onSelect={() => {
                      close();
                      if (!plain().trim()) return toast("Write something first.", "error");
                      // Filled in, not sent: the user reviews (or adds to) the request first.
                      openAssistant(`Turn the action items in my note “${note.title.trim() || "Untitled"}” into to-dos`);
                    }} />
                    <MenuItem icon="sparkle" label="Ask the assistant…" onSelect={() => { close(); askAbout(); }} />
                  </>
                )}
              </Dropdown>
            </Group>
            <Group>
              {/* Left is lit only once chosen, not on every ordinary paragraph. */}
              <TB icon="alignLeft" label="Left-align" onClick={() => chain().setTextAlign("left").run()} active={editor?.isActive({ textAlign: "left" })} />
              <TB icon="alignCenter" label="Center-align" onClick={() => chain().setTextAlign("center").run()} active={ui?.align === "center"} />
              <TB icon="alignRight" label="Right-align" onClick={() => chain().setTextAlign("right").run()} active={ui?.align === "right"} />
            </Group>
            <Group>
              <TB icon="link" label="Insert link" onClick={insertLink} />
              <TB icon="calendar" label="Insert today's date" onClick={() => chain().insertContent(today()).run()} />
              <TB icon="mic" label={listening ? "Stop dictation" : "Dictate"} onClick={dictate} active={listening} className={listening ? "recording !text-[var(--danger)]" : ""} />
            </Group>
            <Group>
              <TB icon="undo" label="Undo (⌘Z)" onClick={() => chain().undo().run()} disabled={!ui?.canUndo} />
              <TB icon="redo" label="Redo (⇧⌘Z)" onClick={() => chain().redo().run()} disabled={!ui?.canRedo} />
            </Group>
            <Group>
              <TB icon="indent" label="Indent (Tab)" disabled={!ui?.inList} onClick={() => chain().sinkListItem(editor!.isActive("taskItem") ? "taskItem" : "listItem").run()} />
              <TB icon="outdent" label="Outdent (⇧Tab)" disabled={!ui?.inList} onClick={() => chain().liftListItem(editor!.isActive("taskItem") ? "taskItem" : "listItem").run()} />
            </Group>
            <Group>
              <TB icon="superscript" label="Superscript" onClick={() => chain().toggleSuperscript().run()} active={ui?.superscript} />
              <TB icon="subscript" label="Subscript" onClick={() => chain().toggleSubscript().run()} active={ui?.subscript} />
            </Group>
            <Group>
              <Dropdown label="Font colour" chevron={false} button={<Icon name="palette" size={18} />} width={244}>
                {(close) => (
                  <div className="flex flex-wrap gap-1.5 p-1.5">
                    {TEXT_COLORS.map((c) => (
                      <button key={c.label} type="button" onMouseDown={keep} title={c.label} aria-label={`Text color ${c.label}`} aria-pressed={(ui?.color ?? "") === c.value}
                        onClick={() => { close(); if (c.value) chain().setColor(c.value).run(); else chain().unsetColor().run(); }}
                        className={`grid h-9 w-9 place-items-center rounded-[14px] border transition-colors hover:bg-[var(--hover)] ${(ui?.color ?? "") === c.value ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
                      >
                        <span className="text-[15px] font-medium" style={{ color: c.value || "var(--foreground)" }}>A</span>
                      </button>
                    ))}
                  </div>
                )}
              </Dropdown>
              <Dropdown label="Highlight" chevron={false} button={<Icon name="highlight" size={18} />} width={214}>
                {(close) => (
                  <div className="flex flex-wrap gap-1.5 p-1.5">
                    {HIGHLIGHTS.map((c) => (
                      <button key={c.label} type="button" onMouseDown={keep} title={c.label} aria-label={`Highlight ${c.label}`}
                        onClick={() => { close(); if (c.value) chain().setHighlight({ color: c.value }).run(); else chain().unsetHighlight().run(); }}
                        className="h-9 w-9 rounded-[14px] border border-[var(--border)] transition-transform hover:scale-105"
                        style={{ background: c.value || "linear-gradient(135deg, transparent 45%, var(--danger) 47%, var(--danger) 53%, transparent 55%)" }}
                      />
                    ))}
                  </div>
                )}
              </Dropdown>
              <TB icon="eraser" label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()} />
            </Group>
          </Toolbar>
        </div>
      </div>

      {/* Writing area: the title, the note's properties and the text scroll as one. */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-[clamp(16px,4vw,40px)] pb-12 pt-8 md:pt-10">
        <article className={`fn-note-in flex flex-col gap-6 ${column}`}>
          <textarea
            ref={titleRef}
            rows={1}
            value={note.title}
            onChange={(e) => store.updateNote(note.id, { title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
            placeholder="Untitled"
            aria-label="Note title"
            className="input-plain fn-display block w-full resize-none overflow-hidden text-[30px] md:text-[36px]"
          />

          {/* Properties: focus mode keeps only what you might still change. */}
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-[120px_minmax(0,1fr)]">
            {!focusMode && (
              <>
                <dt className="text-[var(--text-muted)]">Created</dt>
                <dd className="fn-num text-[var(--text-secondary)]" title={created.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}>
                  {created.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                </dd>
                {SOURCE_NAME[note.source] && (
                  <>
                    <dt className="text-[var(--text-muted)]">Source</dt>
                    <dd className="text-[var(--text-secondary)]">{SOURCE_NAME[note.source]}</dd>
                  </>
                )}
              </>
            )}
            <dt className="text-[var(--text-muted)]">Tags</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {note.tags.map((t) => (
                <span key={t} className="fn-pop inline-flex h-[26px] items-center gap-1 rounded-full bg-[var(--surface-muted)] pl-2.5 pr-1 text-[var(--text-secondary)]">
                  {t[0]?.toUpperCase() + t.slice(1)}
                  <button
                    onClick={() => store.updateNote(note.id, { tags: note.tags.filter((x) => x !== t) })}
                    aria-label={`Remove tag ${t}`}
                    title="Remove tag"
                    className="relative grid h-[18px] w-[18px] place-items-center rounded-full text-[var(--text-muted)] before:absolute before:-inset-2 hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
              {tagDraft === null ? (
                <button
                  className="h-[26px] rounded-full border border-dashed border-[var(--border-strong)] px-2.5 text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]"
                  onClick={() => setTagDraft("")}
                >
                  Add tag
                </button>
              ) : (
                <input
                  autoFocus
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); }
                    if (e.key === "Escape") { e.stopPropagation(); setTagDraft(null); }
                  }}
                  onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
                  placeholder="Tag name"
                  aria-label="New tag"
                  className="field h-[26px] w-32 rounded-full px-2.5 text-[13px]"
                />
              )}
            </dd>
            {note.keepCurrent && (
              <>
                <dt className="text-[var(--text-muted)]">Kept current</dt>
                <dd className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
                  <select
                    aria-label="How often to check the web"
                    value={note.keepCurrent.every}
                    onChange={(e) => note.keepCurrent && store.updateNote(note.id, { keepCurrent: { ...note.keepCurrent, every: e.target.value as KeepCurrent["every"] } })}
                    // Inline: .prop-input's full width would otherwise push the last check onto its own line.
                    style={{ width: "auto" }}
                    className="prop-input h-[26px] min-h-0 px-1.5 text-[13px]"
                  >
                    <option value="week">Checked weekly</option>
                    <option value="month">Checked monthly</option>
                  </select>
                  <span className="text-[var(--text-muted)]">
                    {checking ? "Checking now…" : (() => { const at = lastChecked(note); return at ? `Last checked ${ago(at, now)}` : "Not checked yet"; })()}
                  </span>
                </dd>
              </>
            )}
            {(linkedTodos.length > 0 || linkedTxs.length > 0) && (
              <>
                <dt className="text-[var(--text-muted)]">Linked</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  {linkedTodos.map((t) => (
                    <button key={t.id} onClick={() => openItem("todo", t.id)}
                      className={`inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] ${t.done ? "line-through" : ""}`}
                    >
                      <Icon name="todo" size={14} className="shrink-0" /><span className="truncate">{t.title || "Untitled task"}</span>
                    </button>
                  ))}
                  {linkedTxs.map((t) => (
                    <button key={t.id} onClick={() => openItem("transaction", t.id)}
                      className="inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                    >
                      <Icon name="finance" size={14} className="shrink-0" /><span className="truncate">{t.merchant}</span>
                      <span className="fn-num shrink-0 text-[var(--text-muted)]">{formatMoney(t.amount, t.currency)}</span>
                    </button>
                  ))}
                </dd>
              </>
            )}
          </dl>

          <div className="h-px bg-[var(--border-subtle)]" aria-hidden />

          {note.imageDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={note.imageDataUrl} alt="Scanned source" className="max-h-56 self-start rounded-[var(--radius-control)] border border-[var(--border)]" />
          )}

          {note.keepCurrent?.update?.changed && (
            <section className="fn-rise card overflow-hidden" aria-label="Changes since you wrote this">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3 text-sm font-medium">
                <Icon name="repeat" size={15} className="text-[var(--warning)]" />
                Since you wrote this
                <span className="text-xs font-normal text-[var(--text-muted)]">checked {ago(note.keepCurrent.update.at, now)}</span>
              </div>
              <div className="flex flex-col gap-2 px-5 py-3 text-sm">
                {note.keepCurrent.update.summary && <p className="text-[var(--text-secondary)]">{note.keepCurrent.update.summary}</p>}
                <ul className="list-disc space-y-1 pl-5">{note.keepCurrent.update.changes.map((c) => <li key={c}>{c}</li>)}</ul>
                {note.keepCurrent.update.sources.length > 0 && (
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                    {note.keepCurrent.update.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--foreground)]">{s.title}</a>
                    ))}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
                <button className="btn btn-primary btn-sm" onClick={() => applyUpdate(true)}>Add to note</button>
                <button className="btn btn-plain btn-sm ml-auto" onClick={() => applyUpdate(false)}>Dismiss</button>
              </div>
            </section>
          )}

          {interview && (
            <section className="fn-rise card overflow-hidden" aria-label="Interview">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3 text-sm font-medium">
                <Icon name="users" size={15} className="text-[var(--accent)]" />
                Interview
                <span className="text-xs font-normal text-[var(--text-muted)]">
                  {interview.answers.length ? `${interview.answers.length} answered, up to ${INTERVIEW_MAX}` : "A few questions, then I write it up from your answers"}
                </span>
              </div>
              <div className="flex flex-col gap-3 px-5 py-4">
                {interview.busy ? (
                  <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
                    <Icon name="sparkle" size={15} className="fn-dot text-[var(--accent)]" />
                    {interview.question === null && interview.answers.length < INTERVIEW_MAX ? "Thinking of a question…" : "Writing it up…"}
                  </p>
                ) : interview.question ? (
                  <>
                    <p className="text-[15px] font-medium">{interview.question}</p>
                    <textarea
                      autoFocus
                      value={interview.draft}
                      onChange={(e) => setInterview({ ...interview, draft: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); answer(); } }}
                      placeholder="Your answer, as rough as you like"
                      aria-label="Your answer"
                      className="field min-h-20 resize-none leading-relaxed [field-sizing:content]"
                    />
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">Ready to write it up from your answers.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
                {interview.question && (
                  <button className="btn btn-primary btn-sm" onClick={answer} disabled={interview.busy || !interview.draft.trim()}>
                    {interview.answers.length + 1 >= INTERVIEW_MAX ? "Answer and write it up" : "Next question"}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => void writeUp(interview.answers)} disabled={interview.busy || !interview.answers.length}>
                  Write the note
                </button>
                <button className="btn btn-plain btn-sm ml-auto" onClick={() => setInterview(null)}>Stop</button>
              </div>
            </section>
          )}

          {aiBusy && (
            <div className="card flex items-center gap-2 rounded-[var(--radius-control)] px-4 py-3 text-sm text-[var(--text-secondary)]" role="status">
              <Icon name="sparkle" size={16} className="fn-dot text-[var(--accent)]" />
              {AI_TASKS.find((t) => t.id === aiBusy)?.label}…
            </div>
          )}
          {ai && (
            <section className="fn-rise card overflow-hidden" aria-label="AI suggestion">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3 text-sm font-medium">
                <Icon name="sparkle" size={15} className="text-[var(--accent)]" />
                {RESULT_LABEL[ai.task]}
                <span className="text-xs font-normal text-[var(--text-muted)]">{ai.task === "interview" ? "from your answers" : ai.range ? "of the selected text" : "of this note"}</span>
              </div>
              <div className="fn-editor fn-editor-preview max-h-72 overflow-y-auto px-5 py-3" dangerouslySetInnerHTML={{ __html: plainToHtml(ai.text) }} />
              <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
                {ai.task === "summarize" || ai.task === "continue" ? (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => applyAi("below")}>
                      {ai.task === "continue" ? "Add to note" : "Insert below"}
                    </button>
                    {ai.task === "summarize" && <button className="btn btn-secondary btn-sm" onClick={() => applyAi("replace")}>Replace</button>}
                  </>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => applyAi("replace")}>Replace</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => applyAi("below")}>Insert below</button>
                  </>
                )}
                <button className="btn btn-plain btn-sm" onClick={() => { void navigator.clipboard.writeText(ai.text); toast("Copied"); }}>Copy</button>
                <button className="btn btn-plain btn-sm ml-auto" onClick={() => setAi(null)}>Discard</button>
              </div>
            </section>
          )}

          <EditorContent editor={editor} />

          {ui?.empty && (
            <div className="fn-rise space-y-6">
              <div>
                <p className="group-label mb-2.5">Start from a template</p>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map((t) => (
                    <button key={t.label} onClick={() => applyTemplate(t)} className="pill max-md:h-11">
                      <Icon name={t.icon} size={16} /> {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="group-label mb-2.5">Or let the assistant write it</p>
                <div className="flex flex-wrap gap-2">
                  {ASK_PROMPTS.map((p) => (
                    <button key={p} onClick={() => openAssistant(p)} className="pill max-md:h-11">
                      <Icon name="sparkle" size={15} className="text-[var(--accent)]" /> {p.replace(/^Write a note: /, "").replace(/ (of|to|about)? ?$/, "…")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </article>
      </div>

      {/* Footer: length and age on the left; the assistant's corner pill keeps the right edge clear. */}
      <div className={`flex min-h-[52px] shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] pl-4 pr-[172px] text-xs text-[var(--text-muted)] sm:pr-[196px] md:pl-6 ${focusMode ? "pb-[env(safe-area-inset-bottom)]" : "max-md:mb-[var(--tabbar-space)]"}`}>
        <span className="fn-num whitespace-nowrap">{words} word{words === 1 ? "" : "s"}</span>
        <span aria-hidden className="max-sm:hidden">·</span>
        <span className="truncate max-sm:hidden">Edited {ago(note.updatedAt, now)}</span>
        <span className="flex-1" />
        <Dropdown label="Set a reminder" title="Remind me about this note" chevron={false} width={270} align="right"
          className="btn btn-plain btn-sm max-md:h-11 max-sm:w-11 max-sm:px-0"
          button={<><Icon name="bell" size={15} /><span className="max-sm:hidden">Remind me</span></>}
        >
          {(close) =>
            pickReminder ? (
              <form
                className="space-y-2.5 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = (e.currentTarget.elements.namedItem("when") as HTMLInputElement).value;
                  close();
                  setPickReminder(false);
                  setReminder(new Date(v));
                }}
              >
                <p className="text-sm font-medium">Remind me about this note</p>
                <input name="when" type="datetime-local" defaultValue={tomorrow9} aria-label="Date and time" className="field fn-num" />
                <div className="flex justify-end gap-1.5">
                  <button type="button" className="btn btn-plain btn-sm" onClick={() => setPickReminder(false)}>Back</button>
                  <button className="btn btn-primary btn-sm">Set reminder</button>
                </div>
              </form>
            ) : (
              <>
                <MenuLabel>Remind me about this note</MenuLabel>
                <MenuItem icon="clock" label="In an hour" onSelect={() => { close(); remindIn(1); }} />
                <MenuItem icon="today" label="Tomorrow at 9:00" onSelect={() => { close(); remindIn(24); }} />
                <MenuItem icon="calendar" label="Next week" onSelect={() => { close(); remindIn(24 * 7); }} />
                <MenuSep />
                <MenuItem icon="bell" label="Pick a date and time…" onSelect={() => setPickReminder(true)} />
              </>
            )
          }
        </Dropdown>
        <button className="btn btn-secondary btn-sm max-md:h-11 max-sm:w-11 max-sm:px-0" onClick={askAbout} aria-label="Ask about this note">
          <Icon name="sparkle" size={15} /><span className="max-sm:hidden">Ask about this note</span>
        </button>
      </div>

      {/* "/" menu: a floating panel under the caret. */}
      {slash && slashItems.length > 0 && (
        <div
          className="fn-pop floating fixed z-[80] flex w-[320px] max-w-[calc(100vw-16px)] flex-col p-1.5 text-sm"
          style={{ top: slash.top, bottom: slash.bottom, left: slash.x }}
        >
          <p className="px-3 pb-1.5 pt-2 text-xs text-[var(--text-muted)]" id="slash-label">Turn this line into</p>
          <ul role="listbox" aria-labelledby="slash-label" className="scroll-thin max-h-[min(320px,45vh)] overflow-y-auto">
            {slashItems.map((c, i) => {
              const on = c.id === slashActive;
              return (
                <Fragment key={c.id}>
                  {i > 0 && c.group !== slashItems[i - 1].group && <li role="presentation" className="mx-3 my-1.5 h-px bg-[var(--border-subtle)]" />}
                  <li
                    id={`slash-${c.id}`}
                    role="option"
                    aria-selected={on}
                    onMouseDown={(e) => { e.preventDefault(); runSlash(c.id); }}
                    onMouseEnter={() => setSlash({ ...slash, active: i })}
                    className={`flex cursor-pointer items-center gap-3 rounded-[20px] px-3 py-2 ${on ? "bg-[var(--accent-subtle)]" : ""}`}
                  >
                    <Icon name={c.icon} size={18} className={`shrink-0 ${on ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={on ? "font-medium" : ""}>{c.label}</span>
                      <span className="truncate text-xs text-[var(--text-muted)]">{c.hint}</span>
                    </span>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">/{c.id}</span>
                  </li>
                </Fragment>
              );
            })}
          </ul>
          <p className="mt-1.5 border-t border-[var(--border-subtle)] px-3 pb-1.5 pt-2 text-xs text-[var(--text-muted)]">↑ ↓ to move, Enter to insert</p>
        </div>
      )}
    </div>
  );
}

// Minimal typing for the Web Speech API used by dictation.
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onerror: (e: { error?: string }) => void; onend: () => void; start(): void; stop(): void;
};
