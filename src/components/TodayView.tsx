"use client";
// Today, laid out as the macOS app has it (Views/TodayView.swift): the greeting, then
// your day in one place — the brief, what's due (tick it off right here) and anything
// that needs a look — with quick notes beside it and the assistant in the middle of the
// page. The brief reads as one short paragraph (written from your data, no model) or
// point by point (Settings → Today).
import { useEffect, useMemo, useRef, useState } from "react";
import { looksLikeThinking } from "@/lib/ai/text";
import { composeBrief, useBriefStyle, type BriefItem, type BriefTarget } from "@/lib/briefParagraph";
import { api, localIso } from "@/lib/client";
import { fingerprint } from "@/lib/fingerprint";
import { useFiledFlash } from "@/lib/highlight";
import { greetingFor, useNow, useOnline } from "@/lib/hooks";
import { budgetStatus, detectSubscriptions, myShare, owedToMe } from "@/lib/insights";
import { openItem } from "@/lib/nav";
import { isQuick, quickNote } from "@/lib/quickNote";
import { alive, formatMoney, localDate, localMonth, useStore } from "@/lib/store";
import type { BriefInput, Note, Tab, Todo } from "@/lib/types";
import ChatDock from "./ChatDock";
import { SampleDataButton } from "./SampleData";
import { Icon, useToast } from "./ui";

export default function TodayView({ setTab }: { setTab: (t: Tab) => void }) {
  const { todos, transactions, stickies, notes, settings, briefs, saveBrief, toggleTodo, addNote, remove } = useStore();
  const toast = useToast();
  const online = useOnline();
  const now = useNow();
  const [style] = useBriefStyle();
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

  /** `asked`: Refresh was pressed. The automatic rewrite fails quietly — a busy free model shouldn't put up an error each time. */
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

  // Point by point, the written brief is rewritten whenever what it's written from changes —
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
    toast([`☑️ ${t.title}`, ...extra].join("\n"));
  };

  const firstName = settings.name?.trim().split(/\s+/)[0];
  const rows = [...tasks, ...focus];
  const item = (t: Todo): BriefItem => ({ id: t.id, title: t.title, due: t.dueAt ? new Date(t.dueAt) : null });
  const pieces = composeBrief({
    now, due: tasks.map(item), focus: focus.map(item),
    yesterday: ySpend.map((t) => ({ category: t.category, amount: myShare(t, cur) })),
    currency: cur, alerts, notesToday: quickToday.map((n) => ({ id: n.id, title: n.title })),
  });
  // Only the heads-ups the written brief didn't already say.
  const said = briefLines.map((l) => l.toLowerCase());
  const freshAlerts = alerts.filter((a) => !said.some((l) => l.includes(a.toLowerCase().slice(0, 18))));

  const serif = "fn-serif text-[2.4rem] leading-[1.12] tracking-[-0.02em] md:text-[2.9rem]";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex flex-1 items-center py-6 md:py-8">
        <div className="mx-auto grid w-full max-w-[1060px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-14">
          {/* The greeting, then one list: the brief, what's due, and anything that needs a look. */}
          <div className="min-w-0">
            <p className={serif}>Hello{firstName ? ` ${firstName}` : ""}!</p>
            <h2 className={serif}>{greetingFor(now)}.</h2>

            {style === "paragraph" ? (
              <p className="fn-rise mt-6 max-w-[580px] text-[17px] leading-[1.7] text-[var(--muted)]">
                {pieces.map((p, i) =>
                  p.target ? (
                    <button
                      key={i}
                      onClick={() => follow(p.target!)}
                      className="text-[var(--text)] underline decoration-[color-mix(in_srgb,var(--faint)_80%,transparent)] decoration-1 underline-offset-[5px] hover:decoration-[var(--text)]"
                    >
                      {p.text}
                    </button>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </p>
            ) : (
              <div className="fn-rise mt-6 max-w-[580px] space-y-2.5 text-base leading-relaxed">
                {briefLines.length ? (
                  briefLines.slice(0, 3).map((l, i) => {
                    const { glyph, text } = leadingEmoji(l);
                    return <Row key={i} glyph={glyph}>{text}</Row>;
                  })
                ) : (
                  <>
                    <Row glyph="✳︎">
                      {loading ? "Reading your day…" : isEmptyApp ? "Nothing here yet. Tell the assistant below what you need."
                        : online ? "Your daily brief will appear here." : "The brief will be written when you're back online."}
                    </Row>
                    {!brief && ySpend.length > 0 && <Row glyph="💸">{formatMoney(yTotal, cur)} spent yesterday</Row>}
                  </>
                )}
                {rows.slice(0, 3).map((t) => <TaskRow key={t.id} todo={t} onDone={() => complete(t)} />)}
                {rows.length > 3 && (
                  <button className="pl-[34px] text-[13px] text-[var(--faint)] hover:text-[var(--text)]" onClick={() => setTab("todo")}>{rows.length - 3} more due →</button>
                )}
                {freshAlerts.slice(0, 2).map((a) => (
                  <div key={a} className="flex items-baseline gap-3">
                    <Icon name="warning" size={15} className="w-[22px] shrink-0 translate-y-0.5 text-[var(--board-amber)]" />
                    <span className="text-[var(--muted)]">{a}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--faint)]">
              {style === "points" && (
                <button className="flex items-center gap-1.5 hover:text-[var(--text)] disabled:opacity-40" onClick={() => write(true)} disabled={loading || !online}>
                  <Icon name="sparkle" size={14} /> {loading ? "Writing…" : brief ? "Refresh brief" : "Write today's brief"}
                </button>
              )}
              <button className="flex items-center gap-1.5 hover:text-[var(--text)]" onClick={() => setTab("finance")}>
                <Icon name="wallet" size={14} /> {yTotal > 0 ? `${formatMoney(yTotal, cur, true)} yesterday` : "Finance"}
              </button>
              {isEmptyApp && <SampleDataButton label="Explore with sample data" className="flex items-center gap-1.5 hover:text-[var(--text)]" />}
            </div>
            {briefError && style === "points" && <p className="fn-rise mt-1.5 text-xs text-[var(--muted)]">{briefError}</p>}
          </div>

          <QuickNotes quick={quick} onMore={() => setTab("notes")} />
        </div>
      </div>

      {/* The assistant, in the middle of the page; the conversation opens over everything above it. */}
      <div className="sticky bottom-0 z-20 -mx-4 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-2 md:static md:mx-0 md:px-0 md:pb-7">
        <ChatDock hero />
      </div>
    </div>
  );
}

function Row({ glyph, children }: { glyph: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-[22px] shrink-0 text-center">{glyph}</span>
      <span className="text-[var(--muted)]">{children}</span>
    </div>
  );
}

function TaskRow({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  const flash = useFiledFlash(todo.id);
  const due = todo.dueAt ? new Date(todo.dueAt) : null;
  const overdue = !!due && due < new Date();
  return (
    <div className={`fn-rise flex items-center gap-3 ${flash ? "fn-flash" : ""}`}>
      <span className="grid w-[22px] shrink-0 place-items-center">
        <button
          className={`relative h-[15px] w-[15px] rounded-full border-[1.5px] before:absolute before:-inset-3 hover:border-[var(--accent)] ${overdue ? "border-[color-mix(in_srgb,var(--danger)_80%,transparent)]" : "border-[var(--faint)]"}`}
          aria-label={`Complete ${todo.title}`}
          onClick={onDone}
        />
      </span>
      <button className="flex min-w-0 items-baseline gap-2 text-left" onClick={() => openItem("todo", todo.id)}>
        <span className="truncate text-[var(--text)]">{todo.title}</span>
        {due && (
          <span className={`shrink-0 tabular-nums ${overdue ? "text-[var(--danger)]" : "text-[var(--faint)]"}`}>
            {due.toDateString() === new Date().toDateString()
              ? due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
              : due.toLocaleDateString("en-US", { day: "numeric", month: "short" })}
          </span>
        )}
      </button>
    </div>
  );
}

/** Quick notes as a loose stack of paper cards beside the greeting, the newest on top, with a blank one to write on. */
function QuickNotes({ quick, onMore }: { quick: Note[]; onMore: () => void }) {
  const { addNote } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const save = () => {
    if (!draft.trim()) return;
    addNote(quickNote(draft));
    setDraft("");
    toast("📝 Quick note saved");
  };
  const shown = quick.slice(0, 3);
  return (
    <div className="w-full max-w-[340px] space-y-3">
      <form
        onSubmit={(e) => { e.preventDefault(); save(); }}
        className={`flex items-start gap-2.5 rounded-[14px] border bg-[var(--card-paper)] px-4 py-3.5 transition-colors focus-within:border-[color-mix(in_srgb,var(--accent)_55%,transparent)] ${
          draft ? "border-solid border-[var(--line)]" : "border-dashed border-[var(--line)]"
        }`}
      >
        <Icon name="noteAdd" size={16} className="mt-[3px] shrink-0 text-[var(--faint)]" />
        <textarea
          id="quick-note-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }}
          rows={1}
          placeholder="Quick notes"
          aria-label="Quick note (Enter to save, Shift+Enter for a new line)"
          title="Enter to save · Shift+Enter for a new line. Today's notes go into the brief."
          className="input-plain max-h-32 min-w-0 flex-1 resize-none text-[15px] [field-sizing:content]"
        />
        {draft.trim() && <span className="fn-pop mt-[3px] text-xs text-[var(--faint)]" aria-hidden>↵</span>}
      </form>

      {shown.map((n, i) => <QuickCard key={n.id} note={n} offset={[22, 4, 30][i]} hideOnPhone={i > 0} />)}

      {quick.length > shown.length && (
        <button className="pl-2 text-[13px] text-[var(--faint)] hover:text-[var(--text)]" onClick={onMore}>All notes →</button>
      )}
    </div>
  );
}

function QuickCard({ note, offset, hideOnPhone }: { note: Note; offset: number; hideOnPhone: boolean }) {
  const { remove } = useStore();
  const flash = useFiledFlash(note.id);
  return (
    <div
      className={`fn-rise group w-full max-w-[310px] items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--card-paper)] px-3 py-2.5 shadow-[0_5px_18px_rgba(15,15,15,0.06)] md:ml-[var(--quick-offset)] ${
        hideOnPhone ? "hidden lg:flex" : "flex"
      } ${flash ? "fn-flash" : ""}`}
      style={{ "--quick-offset": `${offset}px` } as React.CSSProperties}
    >
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => openItem("note", note.id)}>
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[var(--fin-a)] text-white"><Icon name="note" size={14} /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{note.title || "Untitled"}</span>
          <span className="block text-xs text-[var(--faint)]">{ago(note.createdAt)}</span>
        </span>
      </button>
      <button
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--faint)] opacity-0 hover:bg-[var(--hover)] hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
        onClick={() => remove("notes", note.id)}
        aria-label={`Delete “${note.title}”`}
        title={`Delete “${note.title}”`}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/** "☀️ Andi still owes you…" → ("☀️", "Andi still owes you…"), so the glyphs line up in a column; "•" when a line has none. */
function leadingEmoji(line: string) {
  const m = line.match(/^(\p{Extended_Pictographic}️?|\p{Emoji_Presentation})\s*(.*)$/u);
  return m ? { glyph: m[1], text: m[2] } : { glyph: "•", text: line };
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
