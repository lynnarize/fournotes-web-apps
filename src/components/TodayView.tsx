"use client";
// Today: the date and a greeting, the brief (one short paragraph written from your data,
// or the written brief point by point, see Settings → Today), and the assistant under it.
// Beside them, at a glance: what's due (tick it off right here), quick notes, and what
// you've spent today. Phones stack it all, with the assistant docked above the tab bar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { looksLikeThinking } from "@/lib/ai/text";
import { BRIEF_STYLES, composeBrief, useBriefStyle, type BriefItem, type BriefTarget } from "@/lib/briefParagraph";
import { api, localIso } from "@/lib/client";
import { fingerprint } from "@/lib/fingerprint";
import { useFiledFlash } from "@/lib/highlight";
import { greetingFor, useNow, useOnline } from "@/lib/hooks";
import { budgetStatus, detectSubscriptions, myShare, owedToMe } from "@/lib/insights";
import { openItem } from "@/lib/nav";
import { isQuick, quickNote } from "@/lib/quickNote";
import { alive, formatMoney, localDate, localMonth, useStore } from "@/lib/store";
import type { BriefInput, Note, Tab, Todo } from "@/lib/types";
import { useAssistant } from "./assistant";
import { Glyph } from "./assistant/icons";
import ChatDock from "./ChatDock";
import { Dropdown, MenuItem } from "./notes/Dropdown";
import { SampleDataButton } from "./SampleData";
import { useToast } from "./ui";

const LINK = "text-[var(--foreground)] underline decoration-[var(--border-strong)] decoration-1 underline-offset-4 transition-colors hover:decoration-[var(--foreground)]";
const QUIET = "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] disabled:opacity-40";
const HEAD_LINK = "flex min-h-8 items-center rounded-full px-1 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--foreground)]";

export default function TodayView({ setTab }: { setTab: (t: Tab) => void }) {
  const { todos, transactions, stickies, notes, settings, briefs, saveBrief, toggleTodo, addNote, remove } = useStore();
  const { todayChat } = useAssistant();
  const toast = useToast();
  const online = useOnline();
  const now = useNow();
  const [style, setStyle] = useBriefStyle();
  const [loading, setLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const cur = settings.currency;
  const today = localDate(now);
  const yesterday = (() => { const d = new Date(now); d.setDate(d.getDate() - 1); return localDate(d); })();

  const tasks = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return alive(todos)
      .filter((t) => !t.done && t.dueAt && new Date(t.dueAt) <= end)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  }, [todos]);
  /** The next week's tasks, after today. */
  const upcoming = useMemo(() => {
    const start = new Date();
    start.setHours(23, 59, 59, 999);
    const end = new Date(start.getTime() + 7 * 86_400_000);
    return alive(todos)
      .filter((t) => !t.done && t.dueAt && new Date(t.dueAt) > start && new Date(t.dueAt) <= end)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
      .slice(0, 2);
  }, [todos]);
  const focus = useMemo(
    () => (tasks.length ? [] : alive(todos).filter((t) => !t.done && !t.dueAt && t.priority === "high").slice(0, 3)),
    [todos, tasks.length],
  );
  const ySpend = useMemo(() => alive(transactions).filter((t) => t.date === yesterday && t.amount > 0), [transactions, yesterday]);
  const yTotal = ySpend.reduce((s, t) => s + myShare(t, cur), 0);
  // Quick notes (they replaced stickies): newest first; today's go into the brief.
  const quick = useMemo(() => alive(notes).filter(isQuick).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [notes]);
  const quickToday = quick.filter((n) => localDate(new Date(n.createdAt)) === today);

  const alerts = useMemo(() => {
    const out: string[] = [];
    const live = alive(transactions);
    for (const b of budgetStatus(live.filter((t) => t.date.startsWith(localMonth())), settings)) {
      if (b.ratio >= 0.8) out.push(`${b.category} budget ${Math.round(b.ratio * 100)}% used (${formatMoney(b.spent, cur, true)} of ${formatMoney(b.limit, cur, true)})`);
    }
    const weekAhead = Date.now() + 7 * 86_400_000;
    for (const s of detectSubscriptions(live)) {
      if (Date.parse(s.nextDate) <= weekAhead) {
        out.push(`${s.merchant} will likely charge ${formatMoney(s.amount, s.currency)} around ${new Date(`${s.nextDate}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`);
      }
    }
    for (const [name, amount] of owedToMe(live, cur).slice(0, 3)) out.push(`${name} still owes you ${formatMoney(amount, cur)}`);
    return out;
  }, [transactions, settings, cur]);

  // A brief written by a model thinking out loud is treated as missing, so it's rewritten.
  const brief = briefs.find((b) => b.date === today && !looksLikeThinking(b.text));
  const briefLines = (brief?.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const isEmptyApp = !alive(todos).length && !alive(transactions).length && !alive(notes).length;

  /** What the written brief is written from, as a short fingerprint. */
  const basis = fingerprint([
    today,
    tasks.slice(0, 15).map((t) => `${t.title}|${t.dueAt ?? ""}`).join(";"),
    `${ySpend.length}|${Math.round(ySpend.reduce((s, t) => s + t.amount, 0))}`,
    quickToday.slice(0, 5).map((n) => n.content).join(";"),
    alerts.join(";"),
  ].join("#"));

  /** `asked`: Refresh was pressed. The automatic rewrite fails quietly: a busy free model shouldn't put up an error each time. */
  const write = async (asked: boolean) => {
    if (loading) return;
    setLoading(true);
    try {
      const at = new Date();
      const input: BriefInput = {
        now: localIso(at),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currency: cur,
        name: settings.name,
        tasksToday: tasks.slice(0, 15).map((t) => ({ title: t.title, dueAt: t.dueAt, overdue: new Date(t.dueAt!) < at })),
        yesterdaySpend: ySpend.slice(0, 30).map((t) => ({ merchant: t.merchant, amount: myShare(t, cur), category: t.category })),
        stickies: quickToday.map((n) => n.content).slice(0, 5),
        alerts,
      };
      const { text } = await api.brief(input);
      saveBrief({ date: today, text, basis });
      setBriefError(null);
    } catch (e) {
      if (asked) setBriefError(`Couldn't write the brief: ${e instanceof Error ? e.message : "try again"}. The last one is still shown.`);
    } finally {
      setLoading(false);
    }
  };

  // Point by point, the written brief is rewritten whenever what it's written from changes:
  // a task done, a quick note, yesterday's spending. The paragraph needs no model at all.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (style !== "points" || !online || brief?.basis === basis || requested.current === basis) return;
    // Let a burst of edits settle; a newer change cancels this one.
    const t = setTimeout(() => { requested.current = basis; write(false); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, online, basis, brief?.basis]);

  // Stickies are gone: any left from before become quick notes, once.
  useEffect(() => {
    const left = alive(stickies);
    if (!left.length) return;
    for (const st of left) {
      // Keep the sample flag, so "Remove sample data" still removes it.
      if (st.text.trim()) addNote({ ...quickNote(st.text), sample: st.sample });
      remove("stickies", st.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stickies.length]);

  const follow = (t: BriefTarget) => {
    if (t.kind === "todos") setTab("todo");
    else if (t.kind === "finance") setTab("finance");
    else if (t.kind === "notes") setTab("notes");
    else openItem(t.kind, t.id);
  };

  const complete = (t: Todo) => {
    const extra = toggleTodo(t.id, true);
    toast([`Done: ${t.title}`, ...extra].join("\n"));
  };

  const firstName = settings.name?.trim().split(/\s+/)[0];
  const item = (t: Todo): BriefItem => ({ id: t.id, title: t.title, due: t.dueAt ? new Date(t.dueAt) : null });
  const pieces = composeBrief({
    now, due: tasks.map(item), focus: focus.map(item),
    yesterday: ySpend.map((t) => ({ category: t.category, amount: myShare(t, cur) })),
    currency: cur, alerts, notesToday: quickToday.map((n) => ({ id: n.id, title: n.title })),
  });
  // Only the heads-ups the written brief didn't already say.
  const said = briefLines.map((l) => l.toLowerCase());
  const freshAlerts = alerts.filter((a) => !said.some((l) => l.includes(a.toLowerCase().slice(0, 18))));
  const styleLabel = BRIEF_STYLES.find((s) => s.id === style)?.label ?? "One paragraph";

  // Once you send, the conversation takes the page: the composer moves to the bottom.
  if (todayChat) return <ChatDock conversation />;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-start gap-10 pb-[136px] pt-5 md:pb-12 md:pt-[72px]">
      <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-6">
        <div className="flex flex-col gap-2.5 md:gap-3">
          <p className="text-[14px] text-[var(--text-secondary)]">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          <h2 className="fn-display text-[40px] md:text-[52px]">{greetingFor(now)}{firstName ? `, ${firstName}` : ""}</h2>
        </div>

        {isEmptyApp ? (
          <div className="fn-rise flex max-w-[600px] flex-col items-start gap-4">
            <p className="text-[16px] leading-[1.6] text-[var(--text-secondary)] md:text-[18px]">
              Nothing here yet. Tell the assistant what you need: a note, a task, or something you spent. Or look around with some sample data first.
            </p>
            <SampleDataButton label="Explore with sample data" className="btn btn-secondary" />
          </div>
        ) : style === "paragraph" ? (
          <p className="fn-rise max-w-[600px] text-[16px] leading-[1.6] text-[var(--text-secondary)] md:text-[18px]">
            {pieces.map((p, i) =>
              p.target ? (
                <button key={i} type="button" onClick={() => follow(p.target!)} className={LINK}>{p.text}</button>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
        ) : (
          <div className="fn-rise flex max-w-[600px] flex-col gap-2.5 text-[16px] leading-[1.6] text-[var(--text-secondary)] md:text-[17px]">
            {briefLines.length ? (
              briefLines.slice(0, 3).map((l, i) => {
                const { glyph, text } = leadingEmoji(l);
                return <Row key={i} glyph={glyph}>{text}</Row>;
              })
            ) : (
              <>
                <Row glyph={<Glyph name="calendarCheck" size={16} />}>
                  {loading ? <span className="fn-shimmer">Reading your day</span> : online ? "Your daily brief will appear here." : "The brief will be written when you're back online."}
                </Row>
                {ySpend.length > 0 && <Row glyph={<Glyph name="wallet" size={16} />}>{formatMoney(yTotal, cur)} spent yesterday</Row>}
              </>
            )}
            {freshAlerts.slice(0, 2).map((a) => (
              <Row key={a} glyph={<Glyph name="warning" size={16} className="text-[var(--warning)]" />}>{a}</Row>
            ))}
          </div>
        )}

        {!isEmptyApp && (
          <div className="-mb-2 -ml-3 -mt-2 flex flex-wrap items-center gap-1">
            {style === "points" && (
              <button type="button" className={QUIET} onClick={() => write(true)} disabled={loading || !online}>
                <Glyph name="refresh" size={14} /> {loading ? "Writing…" : brief ? "Refresh brief" : "Write today's brief"}
              </button>
            )}
            <Dropdown
              label={`How the brief reads: ${styleLabel}`}
              title="How the brief reads"
              width={260}
              chevron={false}
              className={QUIET}
              button={<>{styleLabel}<Glyph name="chevronDown" size={14} /></>}
            >
              {(close) => BRIEF_STYLES.map((s) => (
                <MenuItem key={s.id} icon={s.icon} label={s.label} active={style === s.id} onSelect={() => { close(); setStyle(s.id); }} />
              ))}
            </Dropdown>
          </div>
        )}
        {briefError && style === "points" && <p className="fn-rise -mt-3 text-[13px] text-[var(--text-secondary)]">{briefError}</p>}

        <div className="flex flex-col gap-6 md:mt-4">
          <ChatDock hero />
        </div>
      </div>

      <aside aria-label="At a glance" className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
        <DueToday tasks={tasks} upcoming={upcoming} focus={focus} onDone={complete} onAll={() => setTab("todo")} />
        <SpentToday onOpen={() => setTab("finance")} yTotal={yTotal} />
        <QuickNotes quick={quick} onMore={() => setTab("notes")} />
      </aside>
    </div>
  );
}

function Row({ glyph, children }: { glyph: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="grid w-[22px] shrink-0 translate-y-[3px] place-items-center self-start text-[var(--foreground)]">{glyph}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

const CARD_HEAD = "flex items-center gap-2 px-3 pb-2 pt-3";
const CARD_TITLE = "min-w-0 flex-1 text-[15px] font-medium md:text-[16px]";

function DueToday({ tasks, upcoming, focus, onDone, onAll }: {
  tasks: Todo[]; upcoming: Todo[]; focus: Todo[]; onDone: (t: Todo) => void; onAll: () => void;
}) {
  const shown = tasks.slice(0, 5);
  return (
    <section aria-labelledby="today-due" className="card p-1.5 md:p-2">
      <div className={CARD_HEAD}>
        <h2 id="today-due" className={CARD_TITLE}>Due today</h2>
        <button type="button" className={HEAD_LINK} onClick={onAll}>All tasks</button>
      </div>
      {shown.length ? (
        shown.map((t, i) => (
          <div key={t.id}>
            {i > 0 && <div className="mx-3 h-px bg-[var(--border-subtle)] md:hidden" />}
            <TaskRow todo={t} onDone={() => onDone(t)} />
          </div>
        ))
      ) : (
        <p className="px-3 pb-3 pt-1 text-[14px] text-[var(--text-secondary)]">{focus.length ? "Nothing has a date today." : "Nothing due today."}</p>
      )}
      {tasks.length > shown.length && (
        <button type="button" className={`${HEAD_LINK} mx-2 mb-1`} onClick={onAll}>{tasks.length - shown.length} more due</button>
      )}
      {!tasks.length && focus.length > 0 && (
        <>
          <p className="group-label px-3 pb-1 pt-1">High priority, no date</p>
          {focus.map((t) => <TaskRow key={t.id} todo={t} onDone={() => onDone(t)} />)}
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <div className="mx-3 my-1 h-px bg-[var(--border-subtle)]" />
          <p className="group-label px-3 pb-1 pt-2">Coming up</p>
          {upcoming.map((t) => <TaskRow key={t.id} todo={t} onDone={() => onDone(t)} />)}
        </>
      )}
    </section>
  );
}

function TaskRow({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  const { notes, settings } = useStore();
  const flash = useFiledFlash(todo.id);
  const due = todo.dueAt ? new Date(todo.dueAt) : null;
  const overdue = !!due && due < new Date();
  const sameDay = due?.toDateString() === new Date().toDateString();
  const when = !due
    ? ""
    : sameDay
      ? due.getHours() || due.getMinutes() ? due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Today"
      : due.toLocaleDateString("en-US", overdue ? { month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const freq = todo.rrule?.match(/FREQ=(\w+)/i)?.[1]?.toUpperCase();
  const repeat = freq ? ({ DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" } as Record<string, string>)[freq] : undefined;
  return (
    <div className={`flex items-start gap-3 rounded-[18px] px-3 py-3 max-md:min-h-[52px] max-md:items-center max-md:py-2 ${flash ? "fn-flash" : ""}`}>
      <button
        type="button"
        className={`check relative mt-px before:absolute before:-inset-3 before:content-[''] max-md:h-6 max-md:w-6 ${overdue ? "border-[var(--danger)]" : ""}`}
        aria-label={`Complete ${todo.title}`}
        onClick={onDone}
      />
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-1 text-left" onClick={() => openItem("todo", todo.id)}>
        <span className="truncate text-[14px] md:text-[14px]">{todo.title}</span>
        {(when || note || repeat) && (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
            {when && <span className={`fn-num shrink-0 ${overdue && !sameDay ? "text-[var(--danger)]" : ""}`}>{overdue && !sameDay ? `Overdue, ${when}` : when}</span>}
            {when && (note || repeat) && <span aria-hidden>·</span>}
            {note ? (
              <span className="flex min-w-0 items-center gap-1"><Glyph name="link" size={12} /><span className="truncate">{note.title || "Untitled"}</span></span>
            ) : repeat ? (
              <span className="flex items-center gap-1"><Glyph name="repeat" size={12} />{repeat}</span>
            ) : null}
          </span>
        )}
      </button>
      {todo.bill && todo.bill.amount > 0 && (
        <span className="fn-num shrink-0 text-[13px] text-[var(--text-secondary)]">{formatMoney(todo.bill.amount, todo.bill.currency || settings.currency)}</span>
      )}
    </div>
  );
}

/**
 * Today's spending, and, with budgets set, how much of today's share of them is left:
 * what the budgets have left this month, spread over the days that are left.
 */
function SpentToday({ onOpen, yTotal }: { onOpen: () => void; yTotal: number }) {
  const { transactions, settings } = useStore();
  const cur = settings.currency;
  const now = new Date();
  const today = localDate(now);
  const month = today.slice(0, 7);
  const live = alive(transactions).filter((t) => t.amount > 0);
  const todays = live.filter((t) => t.date === today);
  const total = todays.reduce((s, t) => s + myShare(t, cur), 0);
  const merchants = [...new Set(todays.map((t) => t.merchant))].slice(0, 3).join(", ");

  const budgets = Object.entries(settings.budgets).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0);
  const budgeted = new Set(budgets.map(([c]) => c));
  const monthly = budgets.reduce((s, [, v]) => s + v, 0);
  const inBudget = (t: { category: string }) => budgeted.has(t.category);
  const before = live.filter((t) => inBudget(t) && t.date.startsWith(month) && t.date < today).reduce((s, t) => s + myShare(t, cur), 0);
  const todayInBudget = todays.filter(inBudget).reduce((s, t) => s + myShare(t, cur), 0);
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const allowance = monthly > 0 ? Math.max(0, (monthly - before) / daysLeft) : null;
  const left = allowance != null ? allowance - todayInBudget : null;
  const pct = allowance ? Math.min(100, Math.round((todayInBudget / allowance) * 100)) : allowance === 0 ? 100 : 0;
  const over = left != null && left < 0;
  const sub = left != null
    ? over ? `${formatMoney(-left, cur)} over today's share of your budgets` : `${formatMoney(left, cur)} left for today`
    : yTotal > 0 ? `${formatMoney(yTotal, cur)} yesterday` : todays.length ? `${todays.length} ${todays.length === 1 ? "purchase" : "purchases"} today` : "Nothing logged yet today";

  return (
    <section aria-labelledby="today-money" className="card flex items-center gap-4 px-[18px] py-4 md:block md:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 id="today-money" className="min-w-0 flex-1 text-[13px] text-[var(--text-secondary)] md:text-[16px] md:font-medium md:text-[var(--foreground)]">Spent today</h2>
          <button type="button" className={`${HEAD_LINK} max-md:hidden`} onClick={onOpen}>Finance</button>
        </div>
        <p className="fn-display fn-num mt-1 text-[24px] md:mb-1 md:mt-3 md:text-[28px]">{formatMoney(total, cur)}</p>
        <p
          className={`fn-num text-[12px] md:text-[13px] ${over ? "text-[var(--danger)]" : "text-[var(--text-muted)] md:text-[var(--text-secondary)]"}`}
          title={allowance != null ? "What your monthly budgets have left, spread over the days left this month" : undefined}
        >
          {sub}
        </p>
        {allowance != null && (
          <div className="mt-3.5 max-md:hidden">
            <div role="meter" aria-label="Today's share of your budgets used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="meter" data-tone={over ? "danger" : undefined}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex justify-between gap-3 text-[12px] text-[var(--text-muted)]">
              <span className="min-w-0 truncate">{merchants}</span>
              <span className="fn-num shrink-0">{pct}%</span>
            </div>
          </div>
        )}
        {allowance == null && merchants && <p className="mt-2 truncate text-[12px] text-[var(--text-muted)] max-md:hidden">{merchants}</p>}
      </div>
      {allowance != null && <Ring pct={pct} over={over} />}
      <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--hover)] md:hidden" onClick={onOpen} aria-label="Open Finance">
        <Glyph name="arrowRight" size={18} />
      </button>
    </section>
  );
}

/** Phones: the share of today's allowance used, as a ring. */
function Ring({ pct, over }: { pct: number; over: boolean }) {
  const c = 2 * Math.PI * 23;
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" role="img" aria-label={`${pct} percent of today's allowance used`} className="shrink-0 -rotate-90 md:hidden">
      <circle cx="28" cy="28" r="23" fill="none" stroke="var(--control-track)" strokeWidth="6" />
      <circle cx="28" cy="28" r="23" fill="none" stroke={over ? "var(--danger)" : "var(--accent)"} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
    </svg>
  );
}

/** Quick notes: a line to jot in, and the newest few. Today's go into the brief. */
function QuickNotes({ quick, onMore }: { quick: Note[]; onMore: () => void }) {
  const { addNote } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const save = () => {
    if (!draft.trim()) return;
    addNote(quickNote(draft));
    setDraft("");
    toast("Quick note saved");
  };
  const shown = quick.slice(0, 3);
  return (
    <section aria-labelledby="today-quick" className="card p-1.5 md:p-2">
      <div className={CARD_HEAD}>
        <h2 id="today-quick" className={CARD_TITLE}>Quick notes</h2>
        <span className="text-[12px] text-[var(--text-muted)]">Today&apos;s go into the brief</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label htmlFor="quick-note-input" className="sr-only">Add a quick note. Enter saves it, Shift+Enter starts a new line.</label>
        <textarea
          id="quick-note-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }}
          rows={1}
          placeholder="Jot something down"
          className="block max-h-32 min-h-10 w-full resize-none rounded-[18px] border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-2 text-[14px] leading-6 outline-none transition-colors [field-sizing:content] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] focus:border-[var(--border-strong)] max-md:min-h-11 max-md:text-[16px]"
        />
      </form>
      {shown.length > 0 && (
        <ul className="pt-1">
          {shown.map((n) => <QuickRow key={n.id} note={n} />)}
        </ul>
      )}
      {quick.length > shown.length && (
        <button type="button" className={`${HEAD_LINK} mx-2 mb-1`} onClick={onMore}>All notes</button>
      )}
    </section>
  );
}

function QuickRow({ note }: { note: Note }) {
  const { remove, updateNote } = useStore();
  const toast = useToast();
  const flash = useFiledFlash(note.id);
  const title = note.title || "Untitled";
  return (
    <li className={`group flex items-center gap-3 rounded-[14px] pl-3 pr-1 ${flash ? "fn-flash" : ""}`}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--note-yellow)]" aria-hidden />
      <button type="button" className="min-h-11 min-w-0 flex-1 truncate text-left text-[14px]" onClick={() => openItem("note", note.id)}>{title}</button>
      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{ago(note.createdAt)}</span>
      <button
        type="button"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--hover)] hover:text-[var(--foreground)] focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:opacity-100"
        onClick={() => {
          remove("notes", note.id);
          toast("Quick note deleted", "ok", { label: "Undo", run: () => updateNote(note.id, { deletedAt: null }) });
        }}
        aria-label={`Delete “${title}”`}
        title="Delete"
      >
        <Glyph name="x" size={14} />
      </button>
    </li>
  );
}

/** "☀️ Andi still owes you…" → ("☀️", "Andi still owes you…"), so the glyphs line up in a column; a dot when a line has none. */
function leadingEmoji(line: string) {
  const m = line.match(/^(\p{Extended_Pictographic}️?|\p{Emoji_Presentation})\s*(.*)$/u);
  return m ? { glyph: m[1], text: m[2] } : { glyph: "•", text: line };
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "Yesterday" : `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
