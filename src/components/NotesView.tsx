"use client";
// Notes: a list of notes beside a large editor (the app's sidebar is the third pane).
// On phones the list comes first and a note opens full screen (back returns to the list).
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeNoteHasText } from "@/lib/activeNote";
import { useBackDismiss } from "@/lib/backstack";
import { useFiledFlash } from "@/lib/highlight";
import { usePresence } from "@/lib/hooks";
import { scrollToId, useOpenItem } from "@/lib/nav";
import { snippet } from "@/lib/noteText";
import { usePeople } from "@/lib/people";
import { isQuick } from "@/lib/quickNote";
import { semanticNotes } from "@/lib/search";
import { alive, useStore } from "@/lib/store";
import type { Note } from "@/lib/types";
import EmptyStart from "./EmptyStart";
import Conflicts from "./notes/Conflicts";
import { Dropdown, MenuItem } from "./notes/Dropdown";
import { PeopleList, PersonPage } from "./notes/People";
import { Icon } from "./ui";

// The editor (and its library) loads only when Notes is opened.
const NoteEditor = dynamic(() => import("./notes/NoteEditor"), {
  ssr: false,
  loading: () => <div className="flex-1 animate-pulse bg-[var(--surface-muted)]" aria-label="Loading editor" />,
});

const SOURCE_LABEL: Record<Note["source"], string> = { manual: "", chat: "From chat", ocr: "Scanned", recording: "Recording", share: "Shared" };
const SORTS = { updated: "Last edited", created: "Date created", title: "Title, A to Z" } as const;
type Sort = keyof typeof SORTS;
type Show = "all" | "quick" | "people";
const PREFS = "four-notes:notes-view";

/** "Oct 15", or "Oct 15, 2025" once it is not this year. */
function cardDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

/** The heading a note is listed under: this month, last month, then the month's name. */
function monthGroup(iso: string, now = new Date()) {
  const d = new Date(iso);
  const back = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
  if (back <= 0) return "This month";
  if (back === 1) return "Last month";
  return d.toLocaleDateString("en-US", { month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tagLabel = (t: string) => t[0]?.toUpperCase() + t.slice(1);

function NoteCard({ note, selected, tasks, expenses, onOpen }: { note: Note; selected: boolean; tasks: number; expenses: number; onOpen: () => void }) {
  const flash = useFiledFlash(note.id);
  const preview = snippet(note.content);
  const source = SOURCE_LABEL[note.source];
  const tags = note.tags;
  const linked = [tasks ? plural(tasks, "task") : "", expenses ? plural(expenses, "expense") : ""].filter(Boolean).join(", ");
  return (
    <li id={`note-row-${note.id}`} className={flash ? "fn-flash" : ""}>
      <button
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={`fn-press flex w-full flex-col gap-1.5 rounded-[var(--radius-control)] px-3.5 py-3 text-left transition-colors ${
          selected ? "bg-[var(--accent-subtle)]" : "hover:bg-[var(--hover)]"
        }`}
      >
        <span className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate font-medium ${note.title ? "" : "text-[var(--text-muted)]"}`}>{note.title || "Untitled"}</span>
          <span className="fn-num shrink-0 text-xs text-[var(--text-muted)]">{cardDate(note.updatedAt)}</span>
        </span>
        <span className="line-clamp-2 text-[13px] leading-normal text-[var(--text-secondary)]">{preview || "No text yet"}</span>
        {(tags.length > 0 || linked || source) && (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--text-muted)]">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-px">{tagLabel(t)}</span>
            ))}
            {tags.length > 3 && <span>+{tags.length - 3}</span>}
            {linked && <span className="flex items-center gap-1"><Icon name="link" size={12} />{linked}</span>}
            {source && <span>{source}</span>}
          </span>
        )}
      </button>
    </li>
  );
}

/** A note that was opened but never written in: no title, no text, no scan, nothing linked. */
const isBlank = (n: Note, todos: { noteId?: string | null; deletedAt?: string | null }[], txs: { noteId?: string | null; deletedAt?: string | null }[]) =>
  !n.deletedAt && (!n.title.trim() || n.title === "Untitled") && !n.content.trim() && !n.imageDataUrl &&
  !todos.some((t) => t.noteId === n.id && !t.deletedAt) && !txs.some((t) => t.noteId === n.id && !t.deletedAt);

export default function NotesView() {
  const { notes, todos, transactions, addNote, remove } = useStore();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [personKey, setPersonKey] = useState<string | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const people = usePeople({ notes, todos, transactions });
  const [ranked, setRanked] = useState<{ q: string; ids: string[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("updated");
  const [listHidden, setListHidden] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  // Which transition the editor card plays: into / out of focus mode, or sliding in on phones.
  const [anim, setAnim] = useState<"focus-in" | "focus-out" | "settle" | undefined>();
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enterFocus = () => { clearTimeout(exitTimer.current); setFocusMode(true); setAnim("focus-in"); };
  const exitFocus = () => {
    if (!focusMode) return;
    setAnim("focus-out");
    clearTimeout(exitTimer.current);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = setTimeout(() => { setFocusMode(false); setAnim("settle"); }, reduce ? 0 : 170);
  };
  useEffect(() => () => clearTimeout(exitTimer.current), []);
  const [mobile, setMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop: the list folds away instead of vanishing.
  const listPresence = usePresence(!listHidden, 240);
  // Phones: the list slides back in when you return from a note (not on first load).
  const [returned, setReturned] = useState(false);

  // Remembered view preferences.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as { sort?: Sort; listHidden?: boolean };
      if (p.sort && p.sort in SORTS) setSort(p.sort);
      if (p.listHidden) setListHidden(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFS, JSON.stringify({ sort, listHidden })); } catch { /* storage blocked */ }
  }, [sort, listHidden]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  /** Leaving a note you never wrote in discards it, so "New note" doesn't pile up blanks. */
  const leave = (nextId: string | null) => {
    const current = selectedId && notes.find((n) => n.id === selectedId);
    if (!current || current.id === nextId) return;
    // Ask the open editor first: its latest typing may not be saved yet.
    if (activeNoteHasText(current.id) === true) return;
    if (isBlank(current, todos, transactions)) remove("notes", current.id);
  };
  const open = (id: string) => {
    leave(id);
    setSelectedId(id);
    setMobileOpen(true);
  };

  // Back closes the open note on phones, and leaves focus mode everywhere.
  useBackDismiss(mobile && mobileOpen && !focusMode, () => { leave(null); setMobileOpen(false); setReturned(true); setAnim(undefined); });
  useBackDismiss(focusMode && anim !== "focus-out", exitFocus);

  // Blanks left behind earlier (e.g. by switching tabs): clean them up when Notes opens.
  // Only ones older than a few seconds, and never the open note, so a note that was just
  // created (or React's development re-mount) is never touched.
  useEffect(() => {
    const cutoff = Date.now() - 10_000;
    for (const n of notes) {
      if (n.id !== selectedId && isBlank(n, todos, transactions) && new Date(n.updatedAt).getTime() < cutoff) remove("notes", n.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useOpenItem("note", (f) => {
    setQuery("");
    setShow("all");
    open(f.id);
    scrollToId(`note-row-${f.id}`, "nearest");
  });
  useOpenItem("person", (f) => {
    setQuery("");
    setShow("people");
    setPersonKey(f.id);
    setMobileOpen(true);
  });

  // Search: instant substring filter, then ranking by meaning (or BM25) after a pause.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const h = setTimeout(() => {
      semanticNotes(notes, q, 30).then((r) => setRanked({ q, ids: r.map((x) => x.note.id) })).catch(() => {});
    }, 400);
    return () => clearTimeout(h);
  }, [query, notes]);

  const list = useMemo(() => {
    const live = alive(notes).filter((n) => show !== "quick" || isQuick(n));
    const q = query.trim().toLowerCase();
    if (!q) {
      const by = {
        updated: (a: Note, b: Note) => b.updatedAt.localeCompare(a.updatedAt),
        created: (a: Note, b: Note) => b.createdAt.localeCompare(a.createdAt),
        title: (a: Note, b: Note) => (a.title || "Untitled").localeCompare(b.title || "Untitled"),
      }[sort];
      return [...live].sort(by);
    }
    const substring = live.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    if (ranked?.q.toLowerCase() !== q) return substring;
    const byId = new Map(live.map((n) => [n.id, n]));
    const out = ranked.ids.map((id) => byId.get(id)!).filter(Boolean);
    for (const n of substring) if (!out.includes(n)) out.push(n);
    return out;
  }, [notes, query, ranked, sort, show]);

  const liveCount = alive(notes).length;
  const quickCount = alive(notes).filter(isQuick).length;
  // Listed under month headings while sorted by date; a search or A to Z is one plain list.
  const searched = query.trim().length > 0;
  const groups = useMemo(() => {
    if (searched || sort === "title") return [{ label: "", notes: list }];
    const out: { label: string; notes: Note[] }[] = [];
    for (const n of list) {
      const label = monthGroup(sort === "created" ? n.createdAt : n.updatedAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.notes.push(n);
      else out.push({ label, notes: [n] });
    }
    return out;
  }, [list, searched, sort]);
  const selected =
    (selectedId && alive(notes).find((n) => n.id === selectedId)) || (!mobile ? list[0] : undefined) || undefined;
  const shownPeople = query.trim() ? people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())) : people;
  const person = show === "people" ? people.find((p) => p.key === personKey) ?? (!mobile ? shownPeople[0] : undefined) : undefined;
  const linkedTasks = (id: string) => alive(todos).filter((t) => t.noteId === id).length;
  const linkedExpenses = (id: string) => alive(transactions).filter((t) => t.noteId === id).length;

  const newNote = () => {
    setQuery("");
    setShow("all");
    leave(null);
    const n = addNote({ title: "" }); // empty, so the "Untitled" placeholder doesn't need deleting
    setSelectedId(n.id);
    setMobileOpen(true);
    requestAnimationFrame(() => setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Note title']")?.focus(), 150));
  };

  if (liveCount === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl pt-5 md:pt-6">
        <h2 className="fn-display mb-5 text-[28px]">Notes</h2>
        <EmptyStart
          title="No notes yet"
          hint="Write one, scan a page, or say what's on your mind and it lands here."
          prompts={["Note: weekend trip ideas", "Summarize this: standup notes, ship Friday, Andi on QA"]}
        />
        <div className="mt-4 flex justify-center">
          <button onClick={newNote} className="btn btn-primary btn-lg">
            <Icon name="noteAdd" size={18} /> Write a note
          </button>
        </div>
      </div>
    );
  }

  const showList = mobile ? !mobileOpen || (show === "people" && !person) : !listHidden;
  const showEditor = !!selected && (mobile ? mobileOpen : true);

  return (
    // Fills the space below the header exactly: the list and the note each scroll on
    // their own, so headers, toolbar and footer stay in place.
    <div className="-mx-4 flex min-h-0 flex-1 md:-mx-8">
      {(mobile ? showList : listPresence.mounted) && (
        <aside
          className={`fn-aside flex min-h-0 w-full shrink-0 flex-col md:w-[331px] md:border-r md:border-[var(--border)] ${mobile && returned ? "fn-list-back" : ""}`}
          data-state={mobile ? undefined : listPresence.state}
          inert={!mobile && listHidden ? true : undefined}
        >
          {/* Fixed width inside, so the rows don't reflow while the list folds. */}
          <div className="flex min-h-0 w-full flex-1 flex-col px-3 md:w-[330px]">
          {/* The list carries the tab's title, as the macOS app has it. */}
          <div className="flex items-center gap-1 pb-3 pl-2 pr-1 pt-5 md:pt-6">
            <h2 className="fn-display min-w-0 flex-1 text-[28px]" title={plural(liveCount, "note")}>Notes</h2>
            <Dropdown
              label="Sort notes"
              title={`Sorted by ${SORTS[sort].toLowerCase()}`}
              button={<Icon name="sort" size={18} />}
              width={220}
              chevron={false}
              align="right"
              className="btn btn-plain btn-icon max-md:h-11 max-md:w-11"
            >
              {(close) => (Object.keys(SORTS) as Sort[]).map((s) => (
                <MenuItem key={s} label={SORTS[s]} active={sort === s} onSelect={() => { close(); setSort(s); }} />
              ))}
            </Dropdown>
            <Dropdown
              label="More"
              button={<Icon name="more" size={18} />}
              width={250}
              chevron={false}
              align="right"
              className="btn btn-plain btn-icon max-md:h-11 max-md:w-11"
            >
              {(close) => (
                <>
                  <MenuItem icon="warning" label="Find notes that disagree…" onSelect={() => { close(); setConflictsOpen(true); }} />
                  <MenuItem icon="users" label="People in your notes" onSelect={() => { close(); setQuery(""); setShow("people"); }} />
                </>
              )}
            </Dropdown>
            <button onClick={newNote} className="btn btn-primary pl-2.5 pr-3.5 max-md:h-11">
              <Icon name="plus" size={16} /> New
            </button>
          </div>
          <div className="px-1 pb-3">
            <div className="relative">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); } }}
                placeholder={show === "people" ? "Search people" : "Search notes"}
                aria-label={show === "people" ? "Search people" : "Search notes"}
                className="field pl-9 max-md:h-11"
              />
            </div>
            {show !== "people" && query.trim().length >= 3 && ranked?.q.toLowerCase() === query.trim().toLowerCase() && (
              <p className="px-2 pt-1.5 text-xs text-[var(--text-muted)]">Best matches first</p>
            )}
          </div>
          <div role="group" aria-label="Show" className="seg mx-1 mb-1 flex">
            <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")} className="flex-1 max-md:h-[38px]">
              All <span className="fn-num font-normal text-[var(--text-muted)]">{liveCount}</span>
            </button>
            {(quickCount > 0 || show === "quick") && (
              <button type="button" aria-pressed={show === "quick"} onClick={() => setShow("quick")} className="flex-1 max-md:h-[38px]">
                Quick <span className="fn-num font-normal text-[var(--text-muted)]">{quickCount}</span>
              </button>
            )}
            <button type="button" aria-pressed={show === "people"} onClick={() => setShow("people")} className="flex-1 max-md:h-[38px]">
              People {people.length > 0 && <span className="fn-num font-normal text-[var(--text-muted)]">{people.length}</span>}
            </button>
          </div>
          <div className="scroll-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-24">
            {show === "people" && (
              <PeopleList people={shownPeople} selected={!mobile ? person?.key : undefined} onOpen={(k) => { setPersonKey(k); setMobileOpen(true); }} />
            )}
            {show !== "people" && groups.map((g) => (
              <section key={g.label || "all"} aria-label={g.label || undefined}>
                {g.label && <h3 className="group-label px-2 pb-1.5 pt-3">{g.label}</h3>}
                <ul className="flex flex-col gap-1">
                  {g.notes.map((n) => (
                    <NoteCard key={n.id} note={n} selected={!mobile && selected?.id === n.id} tasks={linkedTasks(n.id)} expenses={linkedExpenses(n.id)} onOpen={() => open(n.id)} />
                  ))}
                </ul>
              </section>
            ))}
            {show !== "people" && list.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
                {searched ? "No matching notes." : "No quick notes yet. Jot one down on Today."}
              </p>
            )}
          </div>
          </div>
        </aside>
      )}

      <Conflicts open={conflictsOpen} onClose={() => setConflictsOpen(false)} />

      {show === "people" && person && (mobile ? mobileOpen : true) && (
        <PersonPage person={person} onBack={mobile ? () => { setMobileOpen(false); setReturned(true); } : undefined} />
      )}

      {show !== "people" && showEditor && selected && (
        <NoteEditor
          key={selected.id}
          note={selected}
          onBack={mobile ? () => { leave(null); setMobileOpen(false); setReturned(true); setAnim(undefined); } : undefined}
          listHidden={listHidden}
          onToggleList={mobile ? undefined : () => setListHidden((v) => !v)}
          focusMode={focusMode}
          onToggleFocus={() => (focusMode ? exitFocus() : enterFocus())}
          anim={anim ?? (mobile ? "push" : undefined)}
          // Phones keep the last value, so clearing it can't replay the slide-in.
          onAnimDone={() => setAnim((a) => (a === "focus-out" || mobile ? a : undefined))}
        />
      )}
    </div>
  );
}
