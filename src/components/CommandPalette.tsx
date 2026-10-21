"use client";
// ⌘K / Ctrl+K: search everything (by words or meaning) and quick-add in one step.
//   t pay rent          -> task          n trip ideas   -> note
//   $ coffee 25k        -> expense       s call mom     -> quick note
//   ? how much on food  -> ask the assistant
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useBackDismiss } from "@/lib/backstack";
import { fmtDateTime } from "@/lib/client";
import { isMac, usePresence } from "@/lib/hooks";
import { openItem } from "@/lib/nav";
import { keywordSearch, semanticNotes } from "@/lib/search";
import { useTheme } from "@/lib/theme";
import { formatMoney, parseAmount, useStore } from "@/lib/store";
import type { Note, Tab } from "@/lib/types";
import { guessCategory } from "@/lib/wallet";
import { useAssistant } from "./assistant";
import { Icon, useToast } from "./ui";
import { quickNote } from "@/lib/quickNote";

type Item = {
  key: string; group: string; label: string; icon: string; run: () => void;
  /** Muted words after the label, e.g. a category. */
  detail?: string;
  /** Right-hand meta: a date, an amount, a shortcut prefix. */
  hint?: string;
  /** Run with ⌘↵ / Ctrl+↵ from anywhere in the list. */
  ask?: boolean;
};

/** The kit's key cap: hairline border, 22px tall. */
const KBD = "inline-grid h-[22px] min-w-[22px] place-items-center rounded-[7px] border border-[var(--border)] bg-[var(--surface)] px-1.5 text-xs leading-none text-[var(--text-secondary)]";
const Kbd = ({ children, label }: { children: ReactNode; label?: string }) => (
  <kbd className={KBD} aria-label={label}>{children}</kbd>
);

/** Marks every place the query appears in the text. */
function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q.length < 2) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="bg-transparent font-medium text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-[3px]">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

const shortDate = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function CommandPalette({ open, onClose, setTab, onSettings }: {
  open: boolean; onClose: () => void; setTab: (t: Tab) => void; onSettings: () => void;
}) {
  const presence = usePresence(open);
  useBackDismiss(open, onClose);
  const store = useStore();
  const { send, toggleVoice } = useAssistant();
  const theme = useTheme();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [semantic, setSemantic] = useState<{ q: string; notes: Note[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);

  useEffect(() => {
    if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!open || query.length < 3 || /^(t|todo|task|n|note|\$|spent|s|sticky|\?|ask)\s/i.test(query)) return;
    const h = setTimeout(() => {
      semanticNotes(store.notes, query, 5).then((r) => setSemantic({ q: query, notes: r.map((x) => x.note) })).catch(() => {});
    }, 350);
    return () => clearTimeout(h);
  }, [q, open, store.notes]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const out: Item[] = [];
    const quick = query.match(/^(t|todo|task|n|note|\$|spent|s|sticky|\?|ask)\s+(.+)$/i);

    if (quick) {
      const kind = quick[1].toLowerCase();
      const text = quick[2].trim();
      if (["t", "todo", "task"].includes(kind)) {
        out.push({ key: "qa", group: "Quick add", icon: "todo", label: `Add task “${text}”`, run: () => { const t = store.addTodo({ title: text }); toast(`✅ ${t.title}`); } });
        out.push({ key: "qa-ai", group: "Quick add", icon: "sparkle", label: "Let the assistant set the date and repeat", hint: text, run: () => send(`Add a task: ${text}`) });
      } else if (["n", "note"].includes(kind)) {
        out.push({ key: "qa", group: "Quick add", icon: "note", label: `New note “${text}”`, run: () => { const n = store.addNote({ title: text }); setTab("notes"); openItem("note", n.id); } });
      } else if (["$", "spent"].includes(kind)) {
        const amount = parseAmount(text);
        const merchant = text.replace(/(rp|idr)?\.?\s*\d[\d.,]*\s*(rb|ribu|k|jt|juta)?\b/gi, "").replace(/\b(di|at)\b/gi, "").replace(/\s{2,}/g, " ").trim() || "Expense";
        out.push(amount
          ? { key: "qa", group: "Quick add", icon: "finance", label: `Log ${formatMoney(amount, store.settings.currency)} at ${merchant}`, hint: guessCategory(text), run: () => { store.addTransaction({ merchant, amount, category: guessCategory(text) }); toast(`💸 ${merchant}`); } }
          : { key: "qa", group: "Quick add", icon: "finance", label: "Add an amount, e.g. “$ coffee 25k”", run: () => {} });
      } else if (["s", "sticky"].includes(kind)) {
        out.push({ key: "qa", group: "Quick add", icon: "note", label: `Quick note “${text}”`, run: () => { store.addNote(quickNote(text)); toast("📝 Quick note saved"); } });
      } else {
        out.push({ key: "qa", group: "Ask", icon: "sparkle", label: `Ask: ${text}`, ask: true, run: () => send(text) });
      }
      return out;
    }

    if (query) {
      const hits = keywordSearch(store, query, 8);
      const seen = new Set(hits.map((h) => h.item.id));
      for (const h of hits) {
        if (h.kind === "note") out.push({ key: h.item.id, group: "Notes", icon: "note", label: h.item.title || "Untitled", hint: h.item.content.slice(0, 60), run: () => openItem("note", h.item.id) });
        if (h.kind === "todo") out.push({ key: h.item.id, group: "To-Do", icon: "todo", label: h.item.title, hint: h.item.done ? "Done" : fmtDateTime(h.item.dueAt), run: () => openItem("todo", h.item.id) });
        if (h.kind === "transaction") out.push({ key: h.item.id, group: "Finance", icon: "finance", label: h.item.merchant, detail: h.item.category, hint: `${shortDate(h.item.date)}, ${formatMoney(h.item.amount, h.item.currency)}`, run: () => openItem("transaction", h.item.id) });
      }
      if (semantic?.q === query) {
        for (const n of semantic.notes) {
          if (seen.has(n.id)) continue;
          out.push({ key: `sem-${n.id}`, group: "Related notes", icon: "sparkle", label: n.title || "Untitled", hint: n.content.slice(0, 60), run: () => openItem("note", n.id) });
        }
      }
      out.push({ key: "ask", group: "Add or ask", icon: "sparkle", label: `Ask the assistant about “${query}”`, ask: true, run: () => send(query) });
      out.push({ key: "new-task", group: "Add or ask", icon: "plus", label: `New task “${query}”`, run: () => { const t = store.addTodo({ title: query }); toast(`✅ ${t.title}`); } });
    }

    const commands: Item[] = [
      { key: "go-today", group: "Go to", icon: "today", label: "Today", run: () => setTab("today") },
      { key: "go-notes", group: "Go to", icon: "note", label: "Notes", run: () => setTab("notes") },
      { key: "go-todo", group: "Go to", icon: "todo", label: "To-Do", run: () => setTab("todo") },
      { key: "go-finance", group: "Go to", icon: "finance", label: "Finance", run: () => setTab("finance") },
      { key: "new-note", group: "Create", icon: "plus", label: "New note", hint: "n …", run: () => { const n = store.addNote({ title: "" }); setTab("notes"); openItem("note", n.id); } },
      { key: "new-quick", group: "Create", icon: "note", label: "Quick note", hint: "s …", run: () => { setTab("today"); setTimeout(() => document.getElementById("quick-note-input")?.focus(), 350); } },
      theme.resolved === "dark"
        ? { key: "theme", group: "Actions", icon: "today", label: "Switch to light mode", hint: "theme", run: () => theme.setPref("light") }
        : { key: "theme", group: "Actions", icon: "moon", label: "Switch to dark mode", hint: "theme", run: () => theme.setPref("dark") },
      { key: "voice", group: "Actions", icon: "wave", label: "Voice assistant", run: toggleVoice },
      { key: "settings", group: "Actions", icon: "settings", label: "Settings and sync", hint: mac ? "⌘," : "Ctrl ,", run: onSettings },
    ];
    const lower = query.toLowerCase();
    out.push(...commands.filter((c) => !query || c.label.toLowerCase().includes(lower) || (c.hint ?? "").toLowerCase().includes(lower)));

    // One heading per group: keep each group together, in the order the groups first appear.
    const order: string[] = [];
    for (const it of out) if (!order.includes(it.group)) order.push(it.group);
    return order.flatMap((g) => out.filter((it) => it.group === g));
  }, [q, store, semantic, send, toggleVoice, toast, setTab, onSettings, theme, mac]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);

  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const run = (item?: Item) => {
    if (!item) return;
    onClose();
    item.run();
  };

  if (!presence.mounted) return null;
  const query = q.trim();
  const quickMode = /^(t|todo|task|n|note|\$|spent|s|sticky|\?|ask)\s/i.test(query);
  const groups: { name: string; start: number; items: Item[] }[] = [];
  items.forEach((item, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, start: i, items: [item] });
  });

  return (
    <div className={`no-print fixed inset-0 z-50 flex items-start justify-center px-3 pt-[max(env(safe-area-inset-top),12px)] sm:px-4 sm:pt-[12vh] ${open ? "" : "pointer-events-none"}`}>
      <div className="fn-backdrop absolute inset-0 bg-black/30" data-state={presence.state} onMouseDown={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label="Search or add"
        data-state={presence.state}
        className="fn-dialog floating relative flex max-h-[calc(100dvh-24px)] w-full max-w-[640px] flex-col overflow-hidden sm:max-h-[76vh]"
      >
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] pl-5 pr-4">
          <Icon name="search" size={18} className="shrink-0 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % Math.max(1, items.length)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % Math.max(1, items.length)); }
              else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                run((e.metaKey || e.ctrlKey) && items.some((it) => it.ask) ? items.find((it) => it.ask) : items[active]);
              }
              else if (e.key === "Escape") onClose();
            }}
            placeholder="Search or add"
            aria-label="Search or add"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={items.length ? optionId(active) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            className="input-plain h-10 min-w-0 flex-1 text-[17px]"
          />
          <button type="button" onClick={onClose} className="hidden sm:block" aria-label="Close">
            <Kbd>esc</Kbd>
          </button>
          <button type="button" onClick={onClose} className="btn btn-plain btn-icon -mr-2 h-11 w-11 sm:hidden" aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div id={listId} role="listbox" aria-label="Results" className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {items.length === 0 && <p className="px-3 py-6 text-center text-[var(--text-muted)]">No results</p>}
          {groups.map((g, gi) => (
            <div key={g.name} role="group" aria-labelledby={`${listId}-g-${gi}`} className="flex flex-col gap-0.5">
              <p id={`${listId}-g-${gi}`} className={`px-3 pb-1 text-xs text-[var(--text-muted)] ${gi === 0 ? "pt-2" : "pt-3"}`}>{g.name}</p>
              {g.items.map((item, j) => {
                const i = g.start + j;
                const on = i === active;
                return (
                  <div
                    key={item.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => { if (!on) setActive(i); }}
                    onClick={() => run(item)}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[18px] px-3 py-2 ${on ? "bg-[var(--accent-subtle)]" : ""}`}
                  >
                    <Icon name={item.icon} size={18} className="shrink-0 text-[var(--text-secondary)]" />
                    <span className="min-w-0 flex-1 truncate">
                      {quickMode ? item.label : <Marked text={item.label} query={query} />}
                      {item.detail && <span className="text-[var(--text-muted)]">, {item.detail}</span>}
                    </span>
                    {item.hint && <span className="fn-num max-w-[45%] shrink-0 truncate text-[13px] text-[var(--text-muted)]">{item.hint}</span>}
                    {item.ask ? (
                      <span className="hidden shrink-0 gap-1 sm:flex" aria-hidden><Kbd>{mac ? "⌘" : "Ctrl"}</Kbd><Kbd>↵</Kbd></span>
                    ) : on ? (
                      <span className="hidden shrink-0 sm:inline-flex" aria-hidden><Kbd>↵</Kbd></span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex h-12 shrink-0 items-center gap-4 border-t border-[var(--border-subtle)] px-5 text-xs text-[var(--text-muted)]">
          <span className="hidden items-center gap-1.5 sm:flex"><Kbd label="Up">↑</Kbd><Kbd label="Down">↓</Kbd>Move</span>
          <span className="hidden items-center gap-1.5 sm:flex"><Kbd label="Enter">↵</Kbd>Open</span>
          <span className="flex-1" />
          <span className="truncate">Start with t, n, $, s or ? to add a task, note, spending, quick note or question</span>
        </div>
      </div>
    </div>
  );
}
