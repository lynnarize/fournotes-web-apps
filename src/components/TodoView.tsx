"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadIcs, fmtDateTime, googleCalendarUrl, toLocalInput } from "@/lib/client";
import { suggestReminder } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { useBackDismiss } from "@/lib/backstack";
import { openItem, scrollToId, useOpenItem } from "@/lib/nav";
import { makeRrule, normaliseRrule, parseRrule, rruleLabel, type Freq } from "@/lib/recurrence";
import { alive, formatMoney, parseAmount, useStore } from "@/lib/store";
import type { ExpenseCategory, Todo } from "@/lib/types";
import EmptyStart from "./EmptyStart";
import { Dropdown, MenuItem, MenuSep } from "./notes/Dropdown";
import { Icon, useToast } from "./ui";

const PRIORITY_DOT = { high: "var(--danger)", medium: "#d9730d", low: "var(--faint)" };
const PRIORITY_LABEL = { high: "High priority", medium: "Medium priority", low: "Low priority" };

// A board like Notion's: To Do → Doing → Done. Colours come from --board-* in globals.css.
type Status = "todo" | "doing" | "done";
const COLUMNS: { id: Status; label: string; hue: string }[] = [
  { id: "todo", label: "To Do", hue: "red" },
  { id: "doing", label: "Doing", hue: "amber" },
  { id: "done", label: "Done", hue: "green" },
];
const statusOf = (t: Todo): Status => (t.done ? "done" : t.doing ? "doing" : "todo");
const DONE_SHOWN = 30;

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
  const live = alive(todos);
  const cols = useMemo(() => columns(alive(todos)), [todos]);
  const move = useMove();
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));
  const openTodo = live.find((t) => t.id === openId);

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
    if (todos.find((t) => t.id === f.id)?.done) setAllDone(true);
    scrollToId(`todo-${f.id}`);
    show(f.id);
  });

  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        {perm === "default" && (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-[var(--sticky-blue)] px-3 py-2 text-sm">
            <Icon name="bell" /> Allow notifications so reminders can pop up.
            <button className="ml-auto rounded-md bg-[var(--text)] px-2 py-1 text-xs text-[var(--bg)]"
              onClick={() => Notification.requestPermission().then(setPerm)}>Enable</button>
          </div>
        )}

        <div className="mb-4 flex items-center gap-2">
          <span className="flex min-h-9 items-center gap-2 rounded-full bg-[var(--hover)] px-3.5 text-sm font-medium">
            <Icon name="todo" size={16} /> Board
          </span>
          <span className="text-sm text-[var(--faint)]">{live.filter((t) => !t.done).length} open</span>
          <button onClick={() => create()} className="fn-press ml-auto flex min-h-10 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-white hover:brightness-110">
            <Icon name="plus" size={16} /> New
          </button>
        </div>

        {live.length === 0 && (
          <EmptyStart
            title="Nothing to do yet"
            hint="Press New, or ask the assistant — it understands dates, reminders and repeats."
            prompts={["Remind me to pay rent every month on the 5th at 9am", "Call the dentist tomorrow at 10am"]}
          />
        )}

        {/* Phones: columns stack. Wider: side by side, scrolling sideways when the task panel is open. */}
        <div className="scroll-thin grid gap-3 md:flex md:items-start md:overflow-x-auto md:pb-2">
          {COLUMNS.map((col) => {
            const items = cols[col.id];
            const shown = col.id === "done" && !allDone ? items.slice(0, DONE_SHOWN) : items;
            return (
              <section
                key={col.id}
                aria-label={col.label}
                className={`board-col rounded-2xl p-2 transition-shadow md:min-w-[250px] md:flex-1 ${over === col.id && dragging ? "board-drop" : ""}`}
                data-hue={col.hue}
                onDragOver={(e) => { if (!dragging) return; e.preventDefault(); setOver(col.id); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                onDrop={(e) => { e.preventDefault(); if (dragging) move(dragging, col.id); setDragging(null); setOver(null); }}
              >
                <header className="flex items-center gap-2 px-1.5 pb-2 pt-1">
                  <h2 className="board-label rounded-md px-2 py-0.5 text-[15px] font-medium">{col.label}</h2>
                  <span className="board-ink text-sm tabular-nums">{items.length}</span>
                  <button
                    className="board-ink tap-target ml-auto !h-9 !w-9 hover:bg-[var(--hover)]"
                    onClick={() => create(col.id)}
                    aria-label={`Add a task to ${col.label}`}
                    title={`Add to ${col.label}`}
                  >
                    <Icon name="plus" size={18} />
                  </button>
                </header>
                <ul className="space-y-2">
                  {shown.map((t) => (
                    <TodoCard
                      key={t.id}
                      todo={t}
                      selected={openId === t.id}
                      onOpen={() => show(t.id)}
                      onDragStart={() => setDragging(t.id)}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                      dragging={dragging === t.id}
                    />
                  ))}
                </ul>
                {col.id === "done" && items.length > shown.length && (
                  <button className="board-ink mt-2 w-full rounded-lg py-2 text-sm hover:bg-[var(--hover)]" onClick={() => setAllDone(true)}>
                    Show {items.length - shown.length} older
                  </button>
                )}
                <button
                  className="board-new board-ink mt-2 flex min-h-12 w-full items-center gap-2 rounded-xl border px-3.5 text-[15px] hover:bg-[var(--hover)]"
                  onClick={() => create(col.id)}
                >
                  <Icon name="plus" size={16} /> New task
                </button>
              </section>
            );
          })}
        </div>
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

function TodoCard({ todo, selected, onOpen, onDragStart, onDragEnd, dragging }: {
  todo: Todo; selected: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void; dragging: boolean;
}) {
  const { notes, settings, remove, updateTodo } = useStore();
  const toast = useToast();
  const move = useMove();
  const justFiled = useFiledFlash(todo.id);
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const overdue = !todo.done && !!todo.dueAt && new Date(todo.dueAt) < new Date();
  const hasMeta = note || todo.bill || todo.rrule || todo.dueAt || (todo.remindAt && !todo.done);

  return (
    <li
      id={`todo-${todo.id}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", todo.title); onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`board-card group relative rounded-xl transition-[opacity,transform] ${selected ? "board-selected" : ""} ${dragging ? "opacity-40" : ""} ${justFiled ? "fn-flash" : ""}`}
    >
      <div className="flex items-start gap-2.5 px-3 py-3">
        <button
          onClick={() => move(todo.id, todo.done ? "todo" : "done")}
          aria-label={todo.done ? "Mark as not done" : "Mark as done"}
          aria-pressed={todo.done}
          className={`relative mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors before:absolute before:-inset-3 ${
            todo.done ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--faint)] hover:border-[var(--accent)]"
          }`}
        >
          {todo.done && <Icon name="check" size={12} />}
        </button>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left" aria-label={`${todo.title || "Untitled task"}, open details`}>
          <span className={`block break-words text-[15px] font-medium leading-5 ${todo.done ? "text-[var(--faint)] line-through" : ""}`}>
            {todo.title || <span className="text-[var(--faint)]">New task</span>}
          </span>
          {hasMeta && (
            <span className="mt-2 flex flex-wrap items-center gap-1">
              {todo.dueAt && (
                <span className={`chip ${overdue ? "!text-[var(--danger)]" : ""}`}>
                  <Icon name="calendar" size={11} />{overdue ? "Overdue · " : ""}{fmtDateTime(todo.dueAt)}
                </span>
              )}
              {todo.remindAt && !todo.done && <span className="chip" title={`Reminder ${fmtDateTime(todo.remindAt)}`}><Icon name="bell" size={11} />{todo.dueAt ? "" : fmtDateTime(todo.remindAt)}</span>}
              {todo.rrule && <span className="chip" title={rruleLabel(todo.rrule)}><Icon name="repeat" size={11} />{rruleLabel(todo.rrule).replace("Every ", "")}</span>}
              {todo.bill && <span className="chip">{formatMoney(todo.bill.amount, todo.bill.currency || settings.currency, true)}</span>}
              {note && <span className="chip max-w-[11rem]"><Icon name="link" size={11} /><span className="truncate">{note.title || "Note"}</span></span>}
            </span>
          )}
        </button>
        {/* Done: clear it away in one click (Undo in the toast). */}
        {todo.done && (
          <button
            className="-my-1 -mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--faint)] opacity-0 transition-opacity hover:bg-[var(--hover)] hover:text-[var(--danger)] focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
            onClick={() => {
              remove("todos", todo.id);
              toast(`Deleted “${todo.title || "Untitled task"}”`, "ok", { label: "Undo", run: () => updateTodo(todo.id, { deletedAt: null }) });
            }}
            aria-label={`Delete “${todo.title || "Untitled task"}”`}
            title="Delete"
          >
            <Icon name="trash" size={15} />
          </button>
        )}
        {todo.priority !== "medium" && !todo.done && (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_DOT[todo.priority] }} title={PRIORITY_LABEL[todo.priority]} aria-label={PRIORITY_LABEL[todo.priority]} />
        )}
      </div>
    </li>
  );
}

/** One property row of the task panel: icon and name on the left, the value on the right. */
function Prop({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex min-h-10 items-center gap-2.5 text-[var(--muted)]">
        <Icon name={icon} size={17} className="shrink-0" /> <span className="truncate">{label}</span>
      </div>
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-2">{children}</div>
    </>
  );
}

/**
 * A task opened beside the board, in the same card as the Notes editor. Phones get it
 * full screen; the expand button does the same on larger screens.
 */
function TaskPanel({ todo, isNew, expanded, mobile, anim, onToggleExpand, onClose, onMove }: {
  todo: Todo; isNew: boolean; expanded: boolean; mobile: boolean; anim: PanelAnim;
  onToggleExpand: () => void; onClose: () => void; onMove: (to: Status) => void;
}) {
  const { updateTodo, remove, notes, todos, categories } = useStore();
  const toast = useToast();
  const [suggestion, setSuggestion] = useState<{ at: string; reason: string } | null>(null);
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const rule = parseRrule(todo.rrule);
  const status = statusOf(todo);
  const detailsRef = useRef<HTMLTextAreaElement>(null);

  const autoSuggestion = useMemo(
    () => (!todo.done && !todo.remindAt ? suggestReminder(todo, todos) : null),
    [todo, todos],
  );
  const shown = suggestion ?? autoSuggestion;
  const created = new Date(todo.createdAt).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div
      data-anim={anim}
      role="complementary"
      aria-label="Task"
      className={`note-card flex min-h-0 flex-col bg-[var(--bg)] ${
        expanded
          ? "fixed inset-0 z-[45] pt-[env(safe-area-inset-top)]"
          : "sticky top-4 max-h-[calc(100dvh-2rem)] w-[420px] shrink-0 rounded-2xl border border-[var(--line)] shadow-[var(--shadow)] lg:w-[480px] xl:w-[540px]"
      }`}
    >
      {/* Header: same controls as the note editor */}
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 md:px-4 md:pt-3">
        {mobile ? (
          <button className="tb-btn gap-1 pr-2" onClick={onClose} aria-label="Back to the board">
            <Icon name="chevronLeft" size={20} /> <span className="text-sm">To-Do</span>
          </button>
        ) : (
          <>
            <button className="tb-btn" onClick={onClose} aria-label="Close task" title="Close (Esc)"><Icon name="collapseRight" size={20} /></button>
            <button className="tb-btn" onClick={onToggleExpand} aria-label={expanded ? "Back to side panel" : "Open full screen"} title={expanded ? "Back to side panel" : "Open full screen"}>
              <Icon name={expanded ? "shrink" : "expand"} size={18} />
            </button>
          </>
        )}
        <span className="ml-1 hidden min-w-0 flex-1 truncate text-sm text-[var(--muted)] sm:block">
          To-Do <Icon name="chevron" size={13} className="inline" /> <span className="text-[var(--text)]">{todo.title || "New task"}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Dropdown label="More actions" button={<Icon name="more" size={20} />} width={240}>
            {(close) => (
              <>
                <MenuItem icon="calendar" label="Add to Google Calendar" onSelect={() => { close(); window.open(googleCalendarUrl(todo), "_blank", "noopener"); }} />
                <MenuItem icon="download" label="Apple / Outlook (.ics)" onSelect={() => { close(); downloadIcs(todo); }} />
                <MenuSep />
                <MenuItem icon="trash" label="Delete task" danger onSelect={() => { close(); remove("todos", todo.id); toast("Task deleted"); onClose(); }} />
              </>
            )}
          </Dropdown>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 md:px-10 md:pt-8">
        <div className={`fn-note-in mx-auto ${expanded ? "max-w-3xl" : ""}`}>
          <textarea
            value={todo.title}
            rows={1}
            autoFocus={isNew}
            onChange={(e) => updateTodo(todo.id, { title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); detailsRef.current?.focus(); } }}
            aria-label="Task title"
            placeholder="New task"
            className={`input-plain mb-5 w-full resize-none text-[2rem] font-bold leading-tight tracking-tight [field-sizing:content] placeholder:text-[var(--faint)] md:text-[2.4rem] ${todo.done ? "text-[var(--faint)] line-through" : ""}`}
          />

          <div className="grid grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)] gap-x-3 text-sm">
            <Prop icon="status" label="Status">
              <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1">
                {COLUMNS.map((c) => (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={status === c.id}
                    onClick={() => onMove(c.id)}
                    data-hue={c.hue}
                    className={`min-h-8 rounded-md px-2.5 text-sm ${status === c.id ? "board-label font-medium" : "text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </Prop>
            <Prop icon="calendar" label="Date">
              <input type="datetime-local" value={toLocalInput(todo.dueAt)} aria-label="Due date" data-empty={!todo.dueAt}
                onChange={(e) => {
                  const dueAt = e.target.value ? new Date(e.target.value).toISOString() : null;
                  // A repeat follows the new date's day of the month.
                  updateTodo(todo.id, { dueAt, ...(rule && dueAt ? { rrule: normaliseRrule(makeRrule(rule.freq, rule.interval), dueAt) } : {}) });
                }}
                className="prop-input" />
            </Prop>
            <Prop icon="bell" label="Alarm">
              <input type="datetime-local" value={toLocalInput(todo.remindAt)} aria-label="Remind me" data-empty={!todo.remindAt}
                onChange={(e) => { setSuggestion(null); updateTodo(todo.id, { remindAt: e.target.value ? new Date(e.target.value).toISOString() : null, reminded: false }); }}
                className="prop-input" />
              {shown ? (
                <span className="flex w-full items-center gap-2 rounded-md bg-[var(--sticky-blue)] px-2 py-1 text-xs">
                  <Icon name="sparkle" size={12} />
                  <span className="min-w-0 flex-1"><b>{fmtDateTime(shown.at)}</b> · {shown.reason}</span>
                  <button className="font-medium text-[var(--accent)]" onClick={() => { updateTodo(todo.id, { remindAt: shown.at, reminded: false }); setSuggestion(null); }}>Use</button>
                </span>
              ) : (
                !todo.done && !todo.remindAt && (
                  <button className="px-2 text-xs text-[var(--accent)]" onClick={() => {
                    const s = suggestReminder(todo, todos);
                    if (s) setSuggestion(s);
                    else toast("Complete a few tasks first so the app can learn when you usually get things done.");
                  }}>✨ Suggest a time</button>
                )
              )}
            </Prop>
            <Prop icon="repeat" label="Repeat">
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
                <label className="flex items-center gap-1 text-[var(--muted)]">every
                  <input type="number" min={1} max={99} value={rule.interval} aria-label="Repeat interval"
                    onChange={(e) => updateTodo(todo.id, { rrule: makeRrule(rule.freq, Math.max(1, Number(e.target.value) || 1), rule.monthDay) })}
                    className="prop-input w-16" />
                </label>
              )}
            </Prop>
            <Prop icon="flag" label="Priority">
              <select value={todo.priority} aria-label="Priority" onChange={(e) => updateTodo(todo.id, { priority: e.target.value as Todo["priority"] })} className="prop-input w-auto">
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </Prop>
            <Prop icon="bill" label="Bill">
              <input
                key={todo.bill?.amount ?? "none"}
                defaultValue={todo.bill?.amount ?? ""}
                placeholder="Empty"
                inputMode="decimal"
                aria-label="Bill amount (logs spending when done)"
                title="Logs the spending when the task is done"
                onBlur={(e) => {
                  const amount = e.target.value.trim() ? parseAmount(e.target.value) : null;
                  updateTodo(todo.id, { bill: amount ? { amount, category: todo.bill?.category ?? "Bills & Utilities", currency: todo.bill?.currency } : null });
                }}
                className="prop-input min-w-0 flex-1"
              />
              {todo.bill && (
                <select
                  aria-label="Bill category"
                  value={todo.bill.category}
                  onChange={(e) => todo.bill && updateTodo(todo.id, { bill: { ...todo.bill, category: e.target.value as ExpenseCategory } })}
                  className="prop-input w-auto"
                >
                  {categories.filter((c) => c !== "Income").map((c) => <option key={c}>{c}</option>)}
                </select>
              )}
            </Prop>
            <Prop icon="link" label="Note">
              <select value={todo.noteId ?? ""} aria-label="Linked note" data-empty={!todo.noteId} onChange={(e) => updateTodo(todo.id, { noteId: e.target.value || null })} className="prop-input min-w-0 flex-1">
                <option value="">Empty</option>
                {alive(notes).map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
              </select>
              {note && <button className="px-2 text-xs text-[var(--accent)]" onClick={() => openItem("note", note.id)}>Open</button>}
            </Prop>
            <Prop icon="clock" label="Created">
              <span className="px-2">{created}</span>
            </Prop>
          </div>

          <div className="my-6 h-px bg-[var(--line)]" />
          <textarea
            ref={detailsRef}
            value={todo.notes ?? ""}
            onChange={(e) => updateTodo(todo.id, { notes: e.target.value })}
            placeholder="Add details, links or steps…"
            aria-label="Task notes"
            className="input-plain min-h-32 w-full resize-none text-base leading-relaxed [field-sizing:content] placeholder:text-[var(--faint)]"
          />
          {todo.rrule && <p className="mt-4 text-xs text-[var(--muted)]">{rruleLabel(todo.rrule)} · completing it schedules the next one</p>}
        </div>
      </div>
    </div>
  );
}
