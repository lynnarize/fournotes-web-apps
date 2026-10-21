"use client";
// The composer's two quick lists, as in Arc's AI composer: "/" at the start of a line opens
// commands that start a request for you, and "@" puts one of your notes into the message as a
// single token (the assistant then reads that note in full). Both open above the line being
// typed; arrows move, Enter or Tab inserts, Escape closes.
import type { Ref } from "react";
import { isQuick } from "@/lib/quickNote";
import type { Note } from "@/lib/types";
import { KindMark } from "./Answer";
import { Glyph, type GlyphName } from "./icons";

type Command = { id: string; label: string; hint: string; icon: GlyphName; insert: string };

/** Each fills in the start of a request; sending it is still yours. */
const COMMANDS: Command[] = [
  { id: "note", label: "Note", hint: "Write a note", icon: "pen", insert: "Write a note about " },
  { id: "task", label: "Task", hint: "Add something to To-Do", icon: "squareCheck", insert: "Add a task: " },
  { id: "spent", label: "Spent", hint: "Log what you spent", icon: "receipt", insert: "Spent " },
  { id: "remind", label: "Remind", hint: "A reminder at a time", icon: "calendarCheck", insert: "Remind me to " },
  { id: "plan", label: "Plan my day", hint: "What to focus on today", icon: "target", insert: "What should I focus on today?" },
  { id: "summarize", label: "Summarize", hint: "Sum up a note, then type @ and its name", icon: "fileText", insert: "Summarize " },
];

export type Trigger = { kind: "slash" | "at"; query: string; start: number; end: number };

/** What's being typed at the caret: "/rem" at the start of a line, or "@wee" after a space. */
export function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const slash = before.match(/(^|\n)\/([a-z ]{0,20})$/i);
  if (slash) return { kind: "slash", query: slash[2].toLowerCase(), start: caret - slash[2].length - 1, end: caret };
  const at = before.match(/(^|\s)@([^\n@]{0,40})$/);
  if (at) return { kind: "at", query: at[2].toLowerCase(), start: caret - at[2].length - 1, end: caret };
  return null;
}

export type Option = { id: string; label: string; hint: string; icon: GlyphName | "quick"; apply: string; token?: string };

export function optionsFor(t: Trigger | null, notes: Note[]): Option[] {
  if (!t) return [];
  if (t.kind === "slash") {
    return COMMANDS.filter((c) => c.id.startsWith(t.query) || c.label.toLowerCase().startsWith(t.query))
      .map((c) => ({ id: c.id, label: c.label, hint: c.hint, icon: c.icon, apply: c.insert }));
  }
  return notes
    .filter((n) => !n.deletedAt && n.title.trim() && n.title.toLowerCase().includes(t.query.trim()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)
    .map((n) => {
      const title = n.title.trim();
      return { id: n.id, label: title, hint: isQuick(n) ? "Quick note" : "Note", icon: isQuick(n) ? "quick" : "fileText", apply: `@${title} `, token: title };
    });
}

/** The list, above the line being typed. */
export function SuggestList({ id, trigger, options, active, onPick, onHover }: {
  id: string;
  trigger: Trigger;
  options: Option[];
  active: number;
  onPick: (o: Option) => void;
  onHover: (i: number) => void;
}) {
  const label = trigger.kind === "slash" ? "Commands" : "Your notes";
  return (
    <div className="fn-pop absolute bottom-full left-2 z-20 mb-2 w-[min(340px,calc(100%-16px))] rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-floating)]">
      <p className="px-2.5 pb-1 pt-1.5 text-[12px] text-[var(--text-muted)]">{label}</p>
      <ul id={id} role="listbox" aria-label={label}>
        {options.map((o, i) => (
          <li
            key={o.id}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            // Keeps the cursor in the text box: the pick happens on mouse down.
            onMouseDown={(e) => { e.preventDefault(); onPick(o); }}
            onMouseEnter={() => onHover(i)}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-2.5 ${i === active ? "bg-[var(--accent-subtle)]" : ""}`}
          >
            {o.icon === "quick" ? <KindMark kind="quick" size={16} /> : <Glyph name={o.icon} size={16} className="shrink-0 text-[var(--text-secondary)]" />}
            <span className="min-w-0 flex-1 truncate text-[14px]">{o.label}</span>
            <span className="max-w-[45%] shrink-0 truncate text-[12px] text-[var(--text-muted)]">{trigger.kind === "slash" ? `/${o.id}` : o.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The mentions that are still whole in the text (editing inside one turns it back into words). */
export function liveTokens(text: string, tokens: string[]) {
  return tokens.filter((t) => text.includes(`@${t}`));
}

/** The text drawn under a transparent text box, so each @mention shows as one tinted token. */
export function Mirror({ text, tokens, mirrorRef, className }: { text: string; tokens: string[]; mirrorRef: Ref<HTMLDivElement>; className: string }) {
  const re = new RegExp(`(${[...tokens].sort((a, b) => b.length - a.length).map((t) => `@${escape(t)}`).join("|")})`, "g");
  return (
    <div ref={mirrorRef} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[var(--foreground)] ${className}`}>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <span key={i} className="rounded-[6px] bg-[var(--accent-subtle)] [box-shadow:0_0_0_2px_var(--accent-subtle)]">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
      {"​"}
    </div>
  );
}
