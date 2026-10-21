"use client";
// To-Do: a board (To do, Doing, Done) with the open task in a panel beside it. Columns are
// neutral; colour marks only real status (due soon, overdue), always with words. Phones show
// one status at a time, picked with a segmented control, and open a task full screen.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { downloadIcs, googleCalendarUrl, toLocalInput } from "@/lib/client";
import { suggestReminder } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { useBackDismiss } from "@/lib/backstack";
import { useNow } from "@/lib/hooks";
import { openItem, scrollToId, useOpenItem } from "@/lib/nav";
import { makeRrule, normaliseRrule, parseRrule, rruleLabel, type Freq } from "@/lib/recurrence";
import { alive, formatMoney, parseAmount, useStore } from "@/lib/store";
import type { ExpenseCategory, Todo } from "@/lib/types";
import EmptyStart from "./EmptyStart";
import { Icon, useToast } from "./ui";

const PRIORITY_LABEL = { high: "High priority", medium: "Medium priority", low: "Low priority" };

type Status = "todo" | "doing" | "done";
const COLUMNS: { id: Status; label: string; empty: string; hint: string; phoneHint: string }[] = [
  { id: "todo", label: "To do", empty: "Nothing to do", hint: "Add a task, or drag one back here.", phoneHint: "Add a task with New." },
  { id: "doing", label: "Doing", empty: "Nothing in progress", hint: "Drag a task here when you start it.", phoneHint: "Set a task to Doing when you start it." },
  { id: "done", label: "Done", empty: "Nothing done yet", hint: "Finished tasks land here.", phoneHint: "Finished tasks land here." },
];
const statusOf = (t: Todo): Status => (t.done ? "done" : t.doing ? "doing" : "todo");
const DONE_SHOWN = 30;
const DAY = 86_400_000;

// ---- Filters (narrow the board; they never change a task) ---------------------------
type Filter = "all" | "week" | "repeat" | "bills" | "linked";
const FILTERS: { id: Filter; label: string; test: (t: Todo, now: number) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "week", label: "Due this week", test: (t, now) => !!t.dueAt && Date.parse(t.dueAt) < now + 7 * DAY },
  { id: "repeat", label: "Repeating", test: (t) => !!t.rrule },
  { id: "bills", label: "Bills", test: (t) => !!t.bill },
  { id: "linked", label: "Linked to a note", test: (t) => !!t.noteId },
];

// ---- Dates --------------------------------------------------------------------------
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayDiff = (iso: string, now = new Date()) => Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / DAY);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
/** "Today, 6:00 PM", "Tomorrow, 9:00 AM", "Sat, Oct 24, 9:00 AM". */
function when(iso: string, now = new Date()) {
  const n = dayDiff(iso, now);
  const d = new Date(iso);
  const day = n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday"
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  return `${day}, ${clock(iso)}`;
}
/** Overdue, or due within three days: the only times a task takes a status colour. */
function dueStatus(t: Todo, now = new Date()): { tone: "danger" | "warning"; text: string } | null {
  if (t.done || !t.dueAt) return null;
  if (Date.parse(t.dueAt) < now.getTime()) return { tone: "danger", text: "Overdue" };
  const n = dayDiff(t.dueAt, now);
  if (n > 3) return null;
  return { tone: "warning", text: n === 0 ? `Due today, ${clock(t.dueAt)}` : n === 1 ? `Due tomorrow, ${clock(t.dueAt)}` : `Due in ${n} days` };
}
/** "Monthly", "Every 2 weeks". */
function repeatShort(rrule: string) {
  const r = parseRrule(rrule);
  if (!r) return "";
  if (r.interval === 1) return { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" }[r.freq];
  return rruleLabel(rrule);
}
function doneWhen(iso: string, now = new Date()) {
  const n = dayDiff(iso, now);
  if (n === 0) return "Done today";
  if (n === -1) return "Done yesterday";
  return `Done ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
/** Phones list a status under headings: overdue, today, this week, later, no date. */
function dueGroup(t: Todo, now = new Date()) {
  if (t.done) return "";
  if (!t.dueAt) return "No date";
  if (Date.parse(t.dueAt) < now.getTime()) return "Overdue";
  const n = dayDiff(t.dueAt, now);
  return n === 0 ? "Today" : n < 7 ? "This week" : "Later";
}
const currencySymbol = (cur: string) => formatMoney(0, cur).replace(/[\d.,\s]/g, "") || cur;

function columns(todos: Todo[]) {
  const c: Record<Status, Todo[]> = { todo: [], doing: [], done: [] };
  for (const t of todos) c[statusOf(t)].push(t);
  // Soonest first (overdue on top); undated tasks after dated ones, newest first.
  const byDue = (a: Todo, b: Todo) => (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~") || b.createdAt.localeCompare(a.createdAt);
  c.todo.sort(byDue);
  c.doing.sort(byDue);
  c.done.sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  return c;
}

/** Moves a task between columns; finishing one still logs its bill and schedules the next repeat. */
function useMove() {
  const { todos, toggleTodo, updateTodo } = useStore();
  const toast = useToast();
  return (id: string, to: Status) => {
    const t = todos.find((x) => x.id === id);
    if (!t || statusOf(t) === to) return;
    if (to === "done") {
      const extra = toggleTodo(id, true);
      if (extra.length) toast(extra.join("\n"));
      return;
    }
    if (t.done) toggleTodo(id, false);
    updateTodo(id, { doing: to === "doing" });
  };
}

/** A task made with "New" that was closed before anything was typed into it. */
const isBlank = (t: Todo) => !t.deletedAt && !t.title.trim() && !t.notes?.trim() && !t.dueAt && !t.remindAt && !t.bill && !t.rrule && !t.noteId;

type PanelAnim = "peek" | "focus-in" | "settle" | "push";

export default function TodoView() {
  const { todos, addTodo, updateTodo, remove } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  // The task "New" just made: removed again if it's closed while still empty.
  const [fresh, setFresh] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [anim, setAnim] = useState<PanelAnim>("peek");
  const [mobile, setMobile] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // Phones: the status shown.
  const [tab, setTab] = useState<Status>("todo");
  const now = useNow();
  const live = alive(todos);
  const shownTodos = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test;
    const t = now.getTime();
    return alive(todos).filter((x) => test(x, t));
  }, [todos, filter, now]);
  const cols = useMemo(() => columns(shownTodos), [shownTodos]);
  const move = useMove();
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));
  const openTodo = live.find((t) => t.id === openId);
  const openCount = live.filter((t) => !t.done).length;
  const doneThisWeek = live.filter((t) => t.done && t.completedAt && now.getTime() - Date.parse(t.completedAt) < 7 * DAY).length;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Empty tasks left behind (e.g. by switching tabs) are cleaned up when To-Do opens.
  useEffect(() => {
    const cutoff = Date.now() - 10_000;
    for (const t of todos) if (isBlank(t) && new Date(t.updatedAt).getTime() < cutoff) remove("todos", t.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dropFresh = (except?: string) => {
    const t = fresh && fresh !== except ? todos.find((x) => x.id === fresh) : undefined;
    if (t && isBlank(t)) remove("todos", t.id);
    if (fresh !== except) setFresh(null);
  };
  const show = (id: string) => {
    dropFresh(id);
    if (!openId) setAnim(mobile ? "push" : "peek");
    setOpenId(id);
  };
  const close = () => {
    dropFresh();
    setOpenId(null);
    setExpanded(false);
  };
  const create = (status: Status = "todo") => {
    dropFresh();
    const t = addTodo({ title: "" });
    if (status === "doing") updateTodo(t.id, { doing: true });
    if (status === "done") updateTodo(t.id, { done: true, completedAt: new Date().toISOString() });
    setFresh(t.id);
    setAnim(mobile ? "push" : "peek");
    setOpenId(t.id);
  };
  const toggleExpand = () => {
    setAnim(expanded ? "settle" : "focus-in");
    setExpanded((v) => !v);
  };

  // Back (phones, Android) and Escape close the panel.
  useBackDismiss(!!openTodo, close);
  useEffect(() => {
    if (!openTodo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=menu], [role=dialog]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useOpenItem("todo", (f) => {
    const t = todos.find((x) => x.id === f.id);
    if (t?.done) setAllDone(true);
    if (t) setTab(statusOf(t));
    setFilter("all");
    scrollToId(`todo-${f.id}`);
    show(f.id);
  });

  const card = (t: Todo) => (
    <TodoCard
      key={t.id}
      todo={t}
      now={now}
      mobile={mobile}
      selected={openId === t.id}
      onOpen={() => show(t.id)}
      onDragStart={() => setDragging(t.id)}
      onDragEnd={() => { setDragging(null); setOver(null); }}
      dragging={dragging === t.id}
    />
  );
  const emptyColumn = (c: (typeof COLUMNS)[number]) => (
    <div className="board-empty flex flex-col items-center gap-1.5 px-5 py-7 text-center">
      <p className="font-medium">{filter === "all" ? c.empty : "Nothing here"}</p>
      <p className="text-[13px] text-[var(--text-muted)]">{filter === "all" ? (mobile ? c.phoneHint : c.hint) : "No tasks in this column match the filter."}</p>
    </div>
  );

  // Phones: the chosen status, under date headings.
  const phoneItems = tab === "done" && !allDone ? cols.done.slice(0, DONE_SHOWN) : cols[tab];
  const phoneGroups = useMemo(() => {
    const out: { label: string; items: Todo[] }[] = [];
    for (const t of phoneItems) {
      const label = dueGroup(t, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(t);
      else out.push({ label, items: [t] });
    }
    return out;
  }, [phoneItems, now]);

  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        {/* Under the page title: how much is open, and New. */}
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[var(--text-secondary)]">
            <span className="fn-num">{openCount}</span> open, <span className="fn-num">{doneThisWeek}</span> done this week
          </p>
          <button onClick={() => create(mobile ? tab : "todo")} className="btn btn-primary pl-3 pr-4 max-md:h-11">
            <Icon name="plus" size={16} /> New task
          </button>
        </div>

        {perm === "default" && (
          <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] py-2 pl-4 pr-2 text-sm">
            <Icon name="bell" size={16} className="shrink-0 text-[var(--text-secondary)]" />
            <span className="min-w-0 flex-1">Allow notifications so reminders can pop up.</span>
            <button className="btn btn-secondary btn-sm max-md:h-11" onClick={() => Notification.requestPermission().then(setPerm)}>Turn on</button>
          </div>
        )}

        {live.length === 0 ? (
          <EmptyStart
            title="Nothing to do yet"
            hint="Press New task, or ask the assistant. It understands dates, reminders and repeats."
            prompts={["Remind me to pay rent every month on the 5th at 9am", "Call the dentist tomorrow at 10am"]}
          />
        ) : (
          <>
            {mobile && (
              <div role="group" aria-label="Status" className="seg mb-4 flex w-full rounded-[22px]">
                {COLUMNS.map((c) => (
                  <button key={c.id} type="button" aria-pressed={tab === c.id} onClick={() => setTab(c.id)} className="h-[38px] flex-1 rounded-[19px] text-sm">
                    {c.label} <span className="fn-num font-normal text-[var(--text-muted)]">{cols[c.id].length}</span>
                  </button>
                ))}
              </div>
            )}

            <div role="group" aria-label="Filter tasks" className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className="pill pill-sm shrink-0 max-md:h-9 max-md:text-sm">
                  {f.label}
                </button>
              ))}
            </div>

            {mobile ? (
              <div className="flex flex-col gap-4">
                {phoneItems.length === 0 && emptyColumn(COLUMNS.find((c) => c.id === tab)!)}
                {phoneGroups.map((g) => (
                  <section key={g.label || "all"} aria-label={g.label || undefined}>
                    {g.label && <h2 className="px-1 pb-2 text-[13px] text-[var(--text-muted)]">{g.label}</h2>}
                    <ul className="flex flex-col gap-2">{g.items.map(card)}</ul>
                  </section>
                ))}
                {tab === "done" && cols.done.length > phoneItems.length && (
                  <button className="btn btn-plain h-11 self-start" onClick={() => setAllDone(true)}>Show {cols.done.length - phoneItems.length} older</button>
                )}
              </div>
            ) : (
              // Side by side, scrolling sideways when the task panel takes room.
              <div className="scroll-thin flex items-start gap-4 overflow-x-auto pb-2">
                {COLUMNS.map((col) => {
                  const items = cols[col.id];
                  const shown = col.id === "done" && !allDone ? items.slice(0, DONE_SHOWN) : items;
                  return (
                    <section
                      key={col.id}
                      aria-labelledby={`col-${col.id}`}
                      className={`board-col flex min-w-[250px] flex-1 flex-col gap-2 p-2 ${over === col.id && dragging ? "board-drop" : ""}`}
                      onDragOver={(e) => { if (!dragging) return; e.preventDefault(); setOver(col.id); }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                      onDrop={(e) => { e.preventDefault(); if (dragging) move(dragging, col.id); setDragging(null); setOver(null); }}
                    >
                      <header className="flex h-10 items-center gap-2 pl-3 pr-1">
                        <h2 id={`col-${col.id}`} className="text-sm font-medium">{col.label}</h2>
                        <span className="fn-num flex-1 text-[13px] text-[var(--text-muted)]">{items.length}</span>
                        <button
                          className="btn btn-plain btn-sm btn-icon"
                          onClick={() => create(col.id)}
                          aria-label={`Add a task to ${col.label}`}
                          title={`Add to ${col.label}`}
                        >
                          <Icon name="plus" size={16} />
                        </button>
                      </header>
                      {shown.length > 0 ? <ul className="flex flex-col gap-2">{shown.map(card)}</ul> : emptyColumn(col)}
                      {col.id === "done" && items.length > shown.length && (
                        <button className="btn btn-plain h-10 w-full rounded-[var(--radius-control)]" onClick={() => setAllDone(true)}>
                          Show {items.length - shown.length} older
                        </button>
                      )}
                      {col.id !== "done" && (
                        <button
                          className="btn btn-plain h-10 w-full justify-start rounded-[var(--radius-control)] px-3 text-[var(--text-muted)]"
                          onClick={() => create(col.id)}
                        >
                          <Icon name="plus" size={16} /> Add a task
                        </button>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {openTodo && (
        <TaskPanel
          key={openTodo.id}
          todo={openTodo}
          isNew={fresh === openTodo.id}
          expanded={expanded || mobile}
          mobile={mobile}
          anim={anim}
          onToggleExpand={toggleExpand}
          onClose={close}
          onMove={(to) => move(openTodo.id, to)}
        />
      )}
    </div>
  );
}

/** A small grey label on a card: date, repeat, reminder, linked note. */
function Chip({ icon, children, title }: { icon?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-muted)] px-2 text-xs text-[var(--text-secondary)]">
      {icon && <Icon name={icon} size={12} className="shrink-0" />}
      {children}
    </span>
  );
}

function TodoCard({ todo, now, mobile, selected, onOpen, onDragStart, onDragEnd, dragging }: {
  todo: Todo; now: Date; mobile: boolean; selected: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void; dragging: boolean;
}) {
  const { notes, settings, remove, updateTodo } = useStore();
  const toast = useToast();
  const move = useMove();
  const justFiled = useFiledFlash(todo.id);
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const title = todo.title || "Untitled task";
  const status = dueStatus(todo, now);

  // What the card says besides its title, in the order it's read.
  const meta: { key: string; icon: string; text: string; title?: string }[] = [];
  if (todo.done) {
    if (todo.completedAt) meta.push({ key: "done", icon: "check", text: doneWhen(todo.completedAt, now) });
  } else {
    if (todo.dueAt && (!status || status.tone === "danger")) meta.push({ key: "due", icon: "calendar", text: when(todo.dueAt, now), title: "Due" });
    if (todo.rrule) meta.push({ key: "repeat", icon: "repeat", text: repeatShort(todo.rrule), title: rruleLabel(todo.rrule) });
    if (todo.remindAt) {
      const sameDay = todo.dueAt && dayDiff(todo.remindAt, now) === dayDiff(todo.dueAt, now);
      meta.push({ key: "remind", icon: "bell", text: sameDay ? clock(todo.remindAt) : when(todo.remindAt, now), title: `Reminder ${when(todo.remindAt, now)}` });
    }
    if (todo.priority !== "medium") meta.push({ key: "priority", icon: "flag", text: todo.priority === "high" ? "High" : "Low", title: PRIORITY_LABEL[todo.priority] });
  }
  if (note) meta.push({ key: "note", icon: "link", text: note.title || "Note", title: "Linked note" });
  const badge = status && <span className={`badge badge-dot ${status.tone === "danger" ? "badge-danger" : "badge-warning"}`}>{status.text}</span>;

  return (
    <li
      id={`todo-${todo.id}`}
      draggable={!mobile}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", todo.title); onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`board-card group relative flex items-start gap-3 p-3.5 max-md:rounded-[22px] max-md:p-4 ${selected ? "board-selected" : ""} ${dragging ? "opacity-40" : ""} ${justFiled ? "fn-flash" : ""}`}
    >
      <button
        role="checkbox"
        aria-checked={todo.done}
        onClick={() => move(todo.id, todo.done ? "todo" : "done")}
        aria-label={todo.done ? `Mark ${title} as not done` : `Complete ${title}`}
        className="check relative mt-px before:absolute before:-inset-3 max-md:h-6 max-md:w-6"
      >
        {todo.done && <Icon name="check" size={12} className="[stroke-width:2.5]" />}
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left" aria-label={`${title}, open details`}>
        <span className="flex items-start gap-2">
          <span className={`min-w-0 flex-1 break-words text-sm leading-5 max-md:text-[15px] max-md:leading-6 ${todo.done ? "text-[var(--text-muted)] line-through" : ""}`}>
            {todo.title || <span className="text-[var(--text-muted)]">New task</span>}
          </span>
          {todo.bill && !mobile && (
            <span className="fn-num shrink-0 text-[13px] leading-5 text-[var(--text-secondary)]">{formatMoney(todo.bill.amount, todo.bill.currency || settings.currency)}</span>
          )}
        </span>
        {mobile ? (
          (badge || meta.length > 0 || todo.bill) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-[var(--text-muted)]">
              {badge}
              {[...meta.map((m) => ({ key: m.key, text: m.text })), ...(todo.bill ? [{ key: "bill", text: formatMoney(todo.bill.amount, todo.bill.currency || settings.currency) }] : [])].map((m, i) => (
                <Fragment key={m.key}>
                  {(i > 0 || badge) && <span aria-hidden>·</span>}
                  <span className={m.key === "bill" ? "fn-num" : "max-w-[12rem] truncate"}>{m.text}</span>
                </Fragment>
              ))}
            </span>
          )
        ) : (
          (badge || meta.length > 0) && (
            <span className={`flex flex-wrap items-center gap-1.5 ${todo.done ? "mt-1.5" : "mt-2.5"}`}>
              {badge}
              {meta.map((m) =>
                m.key === "done" ? (
                  <span key={m.key} className="text-xs text-[var(--text-muted)]">{m.text}</span>
                ) : (
                  <Chip key={m.key} icon={m.icon} title={m.title}>
                    <span className={m.key === "note" ? "max-w-[10rem] truncate" : "fn-num"}>{m.text}</span>
                  </Chip>
                ),
              )}
            </span>
          )
        )}
      </button>
      {/* Done: clear it away in one click (Undo in the toast). */}
      {todo.done && (
        <button
          className="btn btn-plain btn-sm btn-icon -my-1 -mr-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:!text-[var(--danger)] focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:opacity-100"
          onClick={() => {
            remove("todos", todo.id);
            toast(`Deleted “${title}”`, "ok", { label: "Undo", run: () => updateTodo(todo.id, { deletedAt: null }) });
          }}
          aria-label={`Delete “${title}”`}
          title="Delete"
        >
          <Icon name="trash" size={15} />
        </button>
      )}
    </li>
  );
}

/** One property row of the task panel: the name on the left, the value on the right. */
function Prop({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex min-h-12 items-center gap-3 py-1.5 pl-3.5 pr-2 ${last ? "" : "border-b border-[var(--border-subtle)]"}`}>
      <span className="w-[76px] shrink-0 text-[13px] text-[var(--text-muted)]">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * A task opened beside the board. Phones get it full screen; the expand button does the
 * same on larger screens.
 */
function TaskPanel({ todo, isNew, expanded, mobile, anim, onToggleExpand, onClose, onMove }: {
  todo: Todo; isNew: boolean; expanded: boolean; mobile: boolean; anim: PanelAnim;
  onToggleExpand: () => void; onClose: () => void; onMove: (to: Status) => void;
}) {
  const { updateTodo, remove, notes, todos, categories, settings } = useStore();
  const toast = useToast();
  const [suggestion, setSuggestion] = useState<{ at: string; reason: string } | null>(null);
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const rule = parseRrule(todo.rrule);
  const status = statusOf(todo);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const billCurrency = todo.bill?.currency || settings.currency;

  const autoSuggestion = useMemo(
    () => (!todo.done && !todo.remindAt ? suggestReminder(todo, todos) : null),
    [todo, todos],
  );
  const shown = suggestion ?? autoSuggestion;
  const created = new Date(todo.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const billText = todo.bill ? `${formatMoney(todo.bill.amount, billCurrency)} under ${todo.bill.category}` : "";
  // What finishing the task will do, said once under its properties.
  const consequence = todo.bill
    ? `Finishing it logs ${billText}${todo.rrule ? ", then schedules the next one." : "."}`
    : todo.rrule ? `${rruleLabel(todo.rrule)}. Finishing it schedules the next one.` : "";
  const del = () => {
    const id = todo.id;
    remove("todos", id);
    toast("Task deleted", "ok", { label: "Undo", run: () => updateTodo(id, { deletedAt: null }) });
    onClose();
  };

  return (
    <div
      data-anim={anim}
      role="complementary"
      aria-label="Task details"
      className={`note-card flex min-h-0 flex-col bg-[var(--surface)] ${
        expanded
          ? "fixed inset-0 z-[45] pt-[env(safe-area-inset-top)]"
          : "sticky top-4 max-h-[calc(100dvh-2rem)] w-[380px] shrink-0 rounded-[var(--radius-panel)] border border-[var(--border)] lg:w-[420px]"
      }`}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 md:px-4 md:pt-4">
        {mobile ? (
          <>
            <button className="btn btn-plain h-11 gap-1 pl-2 pr-3 text-[var(--foreground)]" onClick={onClose} aria-label="Back to To-Do">
              <Icon name="chevronLeft" size={20} /> To-Do
            </button>
            <span className="flex-1" />
          </>
        ) : (
          <>
            <span className="flex-1 pl-2 text-[13px] text-[var(--text-muted)]">Task</span>
            <button className="btn btn-plain btn-icon" onClick={onToggleExpand} aria-label={expanded ? "Back to side panel" : "Open full screen"} title={expanded ? "Back to side panel" : "Open full screen"}>
              <Icon name={expanded ? "shrink" : "expand"} size={18} />
            </button>
            <button className="btn btn-plain btn-icon" onClick={onClose} aria-label="Close task" title="Close (Esc)">
              <Icon name="x" size={18} />
            </button>
          </>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-3 md:px-6">
        <div className={`fn-note-in mx-auto flex flex-col gap-5 ${expanded ? "max-w-2xl md:pt-6" : ""}`}>
          <textarea
            value={todo.title}
            rows={1}
            autoFocus={isNew}
            onChange={(e) => updateTodo(todo.id, { title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); detailsRef.current?.focus(); } }}
            aria-label="Task title"
            placeholder="New task"
            className={`input-plain w-full resize-none [field-sizing:content] ${
              expanded && !mobile ? "fn-display text-[32px]" : "text-[22px] font-medium leading-tight tracking-[-0.02em]"
            } ${todo.done ? "text-[var(--text-muted)] line-through" : ""}`}
          />

          <div role="radiogroup" aria-label="Status" className="seg flex">
            {COLUMNS.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={status === c.id} onClick={() => onMove(c.id)} className="flex-1 max-md:h-[38px]">
                {c.label}
              </button>
            ))}
          </div>

          <div className="rounded-[var(--radius-control)] border border-[var(--border)]">
            <Prop label="Due">
              <input type="datetime-local" value={toLocalInput(todo.dueAt)} aria-label="Due date" data-empty={!todo.dueAt}
                onChange={(e) => {
                  const dueAt = e.target.value ? new Date(e.target.value).toISOString() : null;
                  // A repeat follows the new date's day of the month.
                  updateTodo(todo.id, { dueAt, ...(rule && dueAt ? { rrule: normaliseRrule(makeRrule(rule.freq, rule.interval), dueAt) } : {}) });
                }}
                className="prop-input fn-num" />
            </Prop>
            <Prop label="Remind">
              <input type="datetime-local" value={toLocalInput(todo.remindAt)} aria-label="Remind me" data-empty={!todo.remindAt}
                onChange={(e) => { setSuggestion(null); updateTodo(todo.id, { remindAt: e.target.value ? new Date(e.target.value).toISOString() : null, reminded: false }); }}
                className="prop-input fn-num" />
              {shown ? (
                <span className="mb-1 flex w-full items-center gap-2 rounded-[12px] bg-[var(--surface-muted)] py-1 pl-2.5 pr-1 text-xs text-[var(--text-secondary)]">
                  <Icon name="sparkle" size={12} className="shrink-0 text-[var(--accent)]" />
                  <span className="min-w-0 flex-1"><span className="fn-num font-medium text-[var(--foreground)]">{when(shown.at)}</span>, {shown.reason}</span>
                  <button className="btn btn-plain btn-sm h-7 px-2.5 text-[var(--foreground)]" onClick={() => { updateTodo(todo.id, { remindAt: shown.at, reminded: false }); setSuggestion(null); }}>Use</button>
                </span>
              ) : (
                !todo.done && !todo.remindAt && (
                  <button className="btn btn-plain btn-sm mb-1 h-7 px-2 text-xs" onClick={() => {
                    const s = suggestReminder(todo, todos);
                    if (s) setSuggestion(s);
                    else toast("Complete a few tasks first so the app can learn when you usually get things done.");
                  }}>
                    <Icon name="sparkle" size={12} className="text-[var(--accent)]" /> Suggest a time
                  </button>
                )
              )}
            </Prop>
            <Prop label="Repeats">
              <select
                aria-label="Repeat frequency"
                value={rule?.freq ?? ""}
                data-empty={!rule}
                onChange={(e) => updateTodo(todo.id, {
                  // A month-end date keeps its day: the 31st comes back on the 31st, not the 28th for ever after February.
                  rrule: e.target.value ? normaliseRrule(makeRrule(e.target.value as Freq, rule?.interval ?? 1), todo.dueAt ?? todo.remindAt) : null,
                })}
                className="prop-input w-auto"
              >
                <option value="">Doesn&apos;t repeat</option>
                <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option>
              </select>
              {rule && (
                <label className="flex items-center gap-1 text-[13px] text-[var(--text-muted)]">every
                  <input type="number" min={1} max={99} value={rule.interval} aria-label="Repeat interval"
                    onChange={(e) => updateTodo(todo.id, { rrule: makeRrule(rule.freq, Math.max(1, Number(e.target.value) || 1), rule.monthDay) })}
                    className="prop-input fn-num w-16" />
                </label>
              )}
            </Prop>
            <Prop label="Priority">
              <select value={todo.priority} aria-label="Priority" onChange={(e) => updateTodo(todo.id, { priority: e.target.value as Todo["priority"] })} className="prop-input w-auto">
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </Prop>
            <Prop label="Bill">
              <div className="flex h-9 min-w-0 flex-1 basis-32 items-center rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-2.5 transition-colors focus-within:border-[var(--accent)] hover:border-[var(--border-strong)]">
                <span className="mr-1.5 text-[var(--text-muted)]" aria-hidden>{currencySymbol(billCurrency)}</span>
                <input
                  key={todo.bill?.amount ?? "none"}
                  defaultValue={todo.bill ? todo.bill.amount.toLocaleString("en-US") : ""}
                  placeholder="No bill"
                  inputMode="decimal"
                  aria-label={`Bill amount in ${billCurrency} (logs spending when done)`}
                  title="Logs the spending when the task is done"
                  onBlur={(e) => {
                    const amount = e.target.value.trim() ? parseAmount(e.target.value) : null;
                    updateTodo(todo.id, { bill: amount ? { amount, category: todo.bill?.category ?? "Bills & Utilities", currency: todo.bill?.currency } : null });
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  className="input-plain fn-num h-full min-w-0 flex-1 placeholder:text-[var(--text-muted)]"
                />
              </div>
              {todo.bill && (
                <select
                  aria-label="Bill category"
                  value={todo.bill.category}
                  onChange={(e) => todo.bill && updateTodo(todo.id, { bill: { ...todo.bill, category: e.target.value as ExpenseCategory } })}
                  className="prop-input w-auto max-w-full"
                >
                  {categories.filter((c) => c !== "Income").map((c) => <option key={c}>{c}</option>)}
                </select>
              )}
            </Prop>
            <Prop label="Note">
              <select value={todo.noteId ?? ""} aria-label="Linked note" data-empty={!todo.noteId} onChange={(e) => updateTodo(todo.id, { noteId: e.target.value || null })} className="prop-input min-w-0 flex-1">
                <option value="">No note</option>
                {alive(notes).map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
              </select>
              {note && <button className="btn btn-plain btn-sm" onClick={() => openItem("note", note.id)}>Open</button>}
            </Prop>
            <Prop label="Created" last>
              <span className="fn-num px-2.5 text-[var(--text-secondary)]">{created}</span>
            </Prop>
          </div>
          {consequence && <p className="-mt-2 text-xs text-[var(--text-muted)]">{consequence}</p>}

          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-[var(--text-muted)]">Add to calendar</p>
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm flex-1 max-md:h-11" onClick={() => window.open(googleCalendarUrl(todo), "_blank", "noopener")}>Google</button>
              <button className="btn btn-secondary btn-sm flex-1 max-md:h-11" onClick={() => downloadIcs(todo)} title="Downloads an .ics file">Apple</button>
              <button className="btn btn-secondary btn-sm flex-1 max-md:h-11" onClick={() => downloadIcs(todo)} title="Downloads an .ics file">Outlook</button>
            </div>
          </div>

          <textarea
            ref={detailsRef}
            value={todo.notes ?? ""}
            onChange={(e) => updateTodo(todo.id, { notes: e.target.value })}
            placeholder="Add details, links or steps"
            aria-label="Task notes"
            className="field min-h-28 resize-none leading-relaxed [field-sizing:content]"
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 md:px-5">
        <button className="btn btn-danger btn-lg px-4" onClick={del}>Delete</button>
        <span className="flex-1" />
        {todo.done ? (
          <button className="btn btn-secondary btn-lg" onClick={() => onMove("todo")}>Mark as not done</button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => onMove("done")}>
            <Icon name="check" size={16} /> {todo.bill ? "Mark as paid" : "Mark as done"}
          </button>
        )}
      </div>
    </div>
  );
}
