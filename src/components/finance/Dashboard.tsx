"use client";
// Finance overview: the month in four numbers (one bordered strip), a line on what stands
// out, the spending trend against last month beside the split by category, then budgets,
// payments coming up and split bills. Everything but the review is computed on the device.
import { useEffect, useMemo, useRef, useState } from "react";
import { baseAmount, budgetStatus, detectSubscriptions, myShare, owedToMe, spendByCategory, type Subscription } from "@/lib/insights";
import { reviewLines } from "@/lib/monthlyReview";
import { normaliseRrule } from "@/lib/recurrence";
import { alive, formatMoney, localDate, localMonth, useStore } from "@/lib/store";
import type { MonthlySummary, Tab, Transaction } from "@/lib/types";
import { Icon, useToast } from "../ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CATEGORY_ICON: Record<string, string> = {
  "Food & Drink": "coffee", Groceries: "cart", Transport: "car", Shopping: "bag", "Bills & Utilities": "bill",
  Health: "heart", Entertainment: "film", Education: "book", Income: "download",
};
export const categoryIcon = (c: string) => CATEGORY_ICON[c] ?? "wallet";

/** Chart series, darkest first; the rest of the categories share the track colour. */
const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
const REST = "var(--fin-rest)";
/** The colour each category takes this month: by rank, the same in the donut and the table. */
export function categoryColors(byCat: [string, number][]): Record<string, string> {
  return Object.fromEntries(byCat.map(([c], i) => [c, SERIES[i] ?? REST]));
}

const spendOf = (txs: Transaction[], cur: string) => txs.filter((t) => t.amount > 0).reduce((s, t) => s + myShare(t, cur), 0);
const incomeOf = (txs: Transaction[], cur: string) => txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(baseAmount(t, cur)), 0);
const pct = (now: number, before: number) => (before > 0 ? (now - before) / before : null);
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const daysFromToday = (iso: string) => {
  const a = new Date(`${iso.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${localDate()}T00:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
};
/** Spending (your share) on each day of a month. */
function perDay(txs: Transaction[], n: number, cur: string) {
  const out = Array<number>(n).fill(0);
  for (const t of txs) if (t.amount > 0) out[Number(t.date.slice(8, 10)) - 1] += myShare(t, cur);
  return out;
}
const running = (v: number[]) => v.reduce<number[]>((a, x) => [...a, (a[a.length - 1] ?? 0) + x], []);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

type ChartView = "running" | "daily" | "year";
const VIEW_KEY = "four-notes:finance-view";
const DISMISSED_KEY = "four-notes:finance-dismissed";

export default function Dashboard({ month, summary, summarizing, onSummarize, onBudgets, onOpenTransactions, onOpenTransaction, onAddIncome }: {
  month: string;
  setTab?: (t: Tab) => void;
  summary?: MonthlySummary;
  summarizing: boolean;
  onSummarize: () => void;
  onBudgets: () => void;
  onOpenTransactions: () => void;
  onOpenTransaction: (id: string) => void;
  onAddIncome: () => void;
}) {
  const { transactions, todos, settings, addTodo, toggleTodo, updateTransaction } = useStore();
  const toast = useToast();
  const cur = settings.currency;
  const live = useMemo(() => alive(transactions), [transactions]);
  const today = localDate();
  const isCurrent = month === localMonth();
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const dayOfMonth = isCurrent ? new Date().getDate() : days;
  const lastMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const lastMonthDays = new Date(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 0).getDate();
  const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
  const lastMonthName = new Date(y, m - 2, 1).toLocaleDateString("en-US", { month: "long" });

  const monthTxs = useMemo(() => live.filter((t) => t.date.startsWith(month)), [live, month]);
  const lastMonthTxs = useMemo(() => live.filter((t) => t.date.startsWith(lastMonth)), [live, lastMonth]);
  // Compare like with like: this month so far against the same days of last month.
  const prevTxs = useMemo(() => lastMonthTxs.filter((t) => Number(t.date.slice(8, 10)) <= dayOfMonth), [lastMonthTxs, dayOfMonth]);
  const spent = spendOf(monthTxs, cur);
  const prevSpent = spendOf(prevTxs, cur);
  const income = incomeOf(monthTxs, cur);

  // ---- Today's pace: the budget left spread over the days left, or your usual day ----
  const budgetTotal = Object.values(settings.budgets).reduce<number>((s, v) => s + (v ?? 0), 0);
  const spentToday = spendOf(live.filter((t) => t.date === today), cur);
  const before = spendOf(monthTxs.filter((t) => t.date < today), cur);
  const daysLeft = days - dayOfMonth + 1;
  const allowance = budgetTotal > 0 ? Math.max(0, (budgetTotal - before) / daysLeft) : before / Math.max(1, dayOfMonth - 1);
  const left = allowance - spentToday;
  const hasPace = allowance > 0 || budgetTotal > 0;

  // ---- Chart data ----
  const [view, setViewState] = useState<ChartView>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === "daily" || v === "month" ? "daily" : v === "year" ? "year" : "running";
    } catch { return "running"; }
  });
  const setView = (v: ChartView) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
  };
  const daily = useMemo(() => perDay(monthTxs, days, cur).slice(0, dayOfMonth), [monthTxs, days, dayOfMonth, cur]);
  const prevDaily = useMemo(() => perDay(lastMonthTxs, lastMonthDays, cur).slice(0, days), [lastMonthTxs, lastMonthDays, days, cur]);
  const yearly = useMemo(() => {
    const out = Array<number>(12).fill(0);
    for (const t of live) if (t.amount > 0 && t.date.startsWith(String(y))) out[Number(t.date.slice(5, 7)) - 1] += myShare(t, cur);
    return out;
  }, [live, y, cur]);
  const lastYear = useMemo(
    () => spendOf(live.filter((t) => t.date.startsWith(String(y - 1)) && t.date.slice(5, 7) <= String(m).padStart(2, "0")), cur),
    [live, y, m, cur],
  );
  const yearToDate = yearly.slice(0, m).reduce((s, v) => s + v, 0);
  const byCat = Object.entries(spendByCategory(monthTxs, cur) as Record<string, number>).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  // ---- Budgets ----
  const budgets = budgetStatus(monthTxs, settings);

  // ---- Upcoming payments: bills on the to-do list, then likely subscription charges ----
  const upcoming = useMemo(() => {
    const soon = Date.now() + 35 * 86_400_000;
    const bills = alive(todos)
      .filter((t) => !t.done && t.bill && t.dueAt && Date.parse(t.dueAt) <= soon)
      .map((t) => ({ key: t.id, todoId: t.id as string | undefined, date: t.dueAt!.slice(0, 10), title: t.title || "Untitled bill", sub: t.rrule ? "Repeating bill" : "Bill", amount: t.bill!.amount, currency: t.bill!.currency || cur, sub_: undefined as Subscription | undefined }));
    const tracked = (name: string) => bills.some((b) => b.title.toLowerCase().includes(name.toLowerCase()));
    const subs = detectSubscriptions(live)
      .filter((s) => Date.parse(s.nextDate) <= soon && !tracked(s.merchant))
      .map((s) => ({ key: `sub:${s.merchant}`, todoId: undefined, date: s.nextDate, title: s.merchant, sub: "Looks like a subscription", amount: s.amount, currency: s.currency, sub_: s }));
    return [...bills, ...subs].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [todos, live, cur]);
  const upcomingTotal = upcoming.every((p) => p.currency === cur) ? upcoming.reduce((s, p) => s + p.amount, 0) : null;
  const trackSub = (s: Subscription) => {
    const due = new Date(`${s.nextDate}T09:00:00`).toISOString();
    // Anchored to its day, so a bill on the 31st comes back on the 31st (or the month's last day), not the 28th for ever after February.
    addTodo({ title: `Pay ${s.merchant}`, dueAt: due, remindAt: due, rrule: normaliseRrule("FREQ=MONTHLY;INTERVAL=1", due), bill: { amount: s.amount, currency: s.currency, category: s.category } });
    toast(`🔁 Monthly bill added: ${s.merchant}`);
  };

  // ---- Split bills still open ----
  const openSplits = useMemo(
    () => live.filter((t) => t.splits?.some((s) => !s.settled)).sort((a, b) => b.date.localeCompare(a.date)),
    [live],
  );
  const owed = owedToMe(live, cur).reduce((s, [, v]) => s + v, 0);
  const openThisMonth = monthTxs.filter((t) => t.splits?.some((s) => !s.settled)).length;
  const settle = (tx: Transaction, j: number, settled: boolean) => {
    const splits = (tx.splits ?? []).map((x, k) => (k === j ? { ...x, settled } : x));
    updateTransaction(tx.id, { splits });
    if (settled) toast(`${tx.splits?.[j]?.name ?? "They"} settled up`, "ok", { label: "Undo", run: () => updateTransaction(tx.id, { splits: tx.splits }) });
  };

  // ---- A spending spike today (dismissable for the month) ----
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); } catch { return []; }
  });
  const dismiss = (id: string) => {
    const next = [...dismissed, `${month}:${id}`].slice(-100);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  const usualDay = spendOf(monthTxs.filter((t) => t.date < today), cur) / Math.max(1, dayOfMonth - 1);
  const spike = isCurrent && usualDay > 0 && spentToday > usualDay * 2 && !dismissed.includes(`${month}:spike:${today}`);

  // ---- The review: one line here, the rest on request ----
  const lines = summary ? reviewLines(summary.text, cur).filter((l) => !/^total$/i.test(l.label ?? "")) : [];
  const lead = lines.find((l) => /unusual|watch|notable|alert|insight/i.test(l.label ?? "")) ?? lines[0];
  const [reviewOpen, setReviewOpen] = useState(false);
  const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

  const deltaText = (() => {
    const p = pct(spent, prevSpent);
    const than = isCurrent ? `this point in ${lastMonthName}` : lastMonthName;
    if (p === null) return spent > 0 ? `Nothing logged by ${than}` : "";
    if (Math.abs(p) < 0.005) return `The same as ${than}`;
    const n = Math.abs(p * 100);
    return `${n >= 10 ? Math.round(n) : n.toFixed(1)}% ${p > 0 ? "more" : "less"} than ${than}`;
  })();

  return (
    <div className="flex flex-col gap-6">
      {/* The month in four numbers: one strip, hairlines between. */}
      <section aria-label={`${monthName} in numbers`} className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] lg:grid-cols-4">
        <Kpi label={isCurrent ? "Spent so far" : "Spent"} value={formatMoney(spent, cur)} wide big>
          {deltaText && (
            <span className="inline-flex items-center gap-1">
              {prevSpent > 0 && <Icon name="arrowUpRight" size={14} className={`shrink-0 ${spent < prevSpent ? "rotate-90" : ""}`} />}
              {deltaText}
            </span>
          )}
        </Kpi>
        {isCurrent ? (
          hasPace ? (
            <Kpi label="Left for today" value={formatMoney(Math.max(0, left), cur)}>
              {left >= 0 ? `Of a ${formatMoney(allowance, cur)} daily pace` : <span className="text-[var(--danger)]">{formatMoney(-left, cur)} over today&apos;s pace</span>}
            </Kpi>
          ) : (
            <Kpi label="Spent today" value={formatMoney(spentToday, cur)}>
              <button className="text-left text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-[3px]" onClick={onBudgets}>Set a budget for a daily pace</button>
            </Kpi>
          )
        ) : (
          <Kpi label="Daily average" value={formatMoney(spent / Math.max(1, dayOfMonth), cur)}>Over {plural(dayOfMonth, "day")}</Kpi>
        )}
        <Kpi label="Income" value={formatMoney(income, cur)}>
          {income === 0 ? (
            <button className="text-left text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-[3px]" onClick={onAddIncome}>Add income to see what you save</button>
          ) : income >= spent ? `You kept ${formatMoney(income - spent, cur)}` : `${formatMoney(spent - income, cur)} more out than in`}
        </Kpi>
        <Kpi label="Transactions" value={String(monthTxs.length)} wide>
          {openThisMonth > 0 ? (
            <button className="text-left hover:text-[var(--foreground)]" onClick={onOpenTransactions}>{plural(openThisMonth, "split bill")} still open</button>
          ) : prevTxs.length > 0 ? `${prevTxs.length} by ${isCurrent ? "this point in " : ""}${lastMonthName}` : ""}
        </Kpi>
      </section>

      {/* What stands out, from the month's review; a spending spike gets its own line. */}
      <div className="-mt-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[var(--text-secondary)]">
          <Icon name="sparkle" size={16} className="shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 flex-[1_1_16rem]">
            {lead ? (lead.label ? `${lead.label}: ${clean(lead.body)}` : clean(lead.body))
              : summarizing ? "Reading this month's spending…"
              : monthTxs.length ? "A short review of the month, with a tip, is written here as you spend."
              : "Log some spending first; the review is written from it."}
          </span>
          {lines.length > 1 && (
            <button className="btn btn-plain btn-sm max-md:h-11" aria-expanded={reviewOpen} onClick={() => setReviewOpen((v) => !v)}>
              {reviewOpen ? "Hide the review" : "Read the review"}
            </button>
          )}
          {monthTxs.length > 0 && (
            <button className="btn btn-plain btn-sm text-[var(--foreground)] max-md:h-11" onClick={onSummarize} disabled={summarizing}>
              {summarizing ? "Writing…" : summary ? "Refresh the review" : `Write the ${monthName} review`}
            </button>
          )}
        </div>
        {reviewOpen && lines.length > 1 && (
          <ul className="fn-rise flex flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">
            {lines.map((l, i) => (
              <li key={i} className="flex gap-3">
                <Icon name={l.icon} size={16} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
                <span className="min-w-0">
                  {l.label && <span className="block text-xs text-[var(--text-muted)]">{l.label}</span>}
                  <span className="block leading-snug">{clean(l.body)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {spike && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[var(--text-secondary)]">
            <Icon name="warning" size={16} className="shrink-0 text-[var(--warning)]" />
            <span className="min-w-0 flex-[1_1_16rem]">
              Spending spike today: <span className="fn-num text-[var(--foreground)]">{formatMoney(spentToday, cur)}</span>, against a usual day of <span className="fn-num">{formatMoney(usualDay, cur)}</span>.
            </span>
            <button className="btn btn-plain btn-sm max-md:h-11" onClick={onOpenTransactions}>See transactions</button>
            <button className="btn btn-plain btn-sm btn-icon max-md:h-11 max-md:w-11" onClick={() => dismiss(`spike:${today}`)} aria-label="Dismiss for this month" title="Dismiss for this month">
              <Icon name="x" size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        <section aria-labelledby="fin-trend-h" className="flex min-w-0 flex-[999_1_520px] flex-col gap-4 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-6 max-sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="fin-trend-h" className="min-w-0 flex-1 text-base font-medium">
              {view === "year" ? `Spending in ${y}` : isCurrent ? "Spending this month" : `Spending in ${monthName}`}
            </h2>
            <div role="group" aria-label="Chart" className="seg rounded-[16px] [&>button]:h-[26px] [&>button]:rounded-[13px] [&>button]:text-xs max-md:[&>button]:h-[34px] max-md:[&>button]:rounded-[17px] max-md:rounded-[20px]">
              {([["running", "Running total"], ["daily", "Per day"], ["year", "Year"]] as const).map(([id, text]) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{text}</button>
              ))}
            </div>
          </div>
          <div key={view} className="fn-note-in flex flex-col gap-4">
            {view === "running" && (
              <>
                <Legend items={[{ label: monthName, kind: "line" }, { label: lastMonthName, kind: "dashed" }]} />
                <TrendChart
                  kind="line"
                  values={running(daily)}
                  previous={running(prevDaily)}
                  total={days}
                  currency={cur}
                  names={[monthName, lastMonthName]}
                  marker={isCurrent ? dayOfMonth - 1 : undefined}
                  label={(i) => `${isCurrent && i === dayOfMonth - 1 ? "Today, " : ""}${MONTHS[m - 1]} ${i + 1}`}
                  ticks={[1, 8, 15, 22, 29].filter((d) => d <= days).map((d) => ({ at: d - 1, text: `${MONTHS[m - 1]} ${d}` }))}
                  summary={`Running total for ${monthName} reaches ${formatMoney(spent, cur)}${prevSpent || spent ? `, against ${formatMoney(prevSpent, cur)} at the same point in ${lastMonthName}` : ""}.`}
                />
              </>
            )}
            {view === "daily" && (
              <>
                <Legend items={[{ label: "Spent that day", kind: "bar" }, { label: "Average day", kind: "dotted" }]} />
                <TrendChart
                  kind="bars"
                  values={daily}
                  total={days}
                  currency={cur}
                  names={[monthName]}
                  average
                  label={(i) => `${MONTHS[m - 1]} ${i + 1}`}
                  ticks={[1, 8, 15, 22, 29].filter((d) => d <= days).map((d) => ({ at: d - 1, text: `${MONTHS[m - 1]} ${d}` }))}
                  summary={`Spending per day in ${monthName}, ${formatMoney(daily.length ? spent / daily.length : 0, cur)} on an average day.`}
                />
              </>
            )}
            {view === "year" && (
              <>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  <span className="fn-num text-[var(--foreground)]">{formatMoney(yearToDate, cur)}</span> by the end of {monthName}
                  {lastYear > 0 && (() => {
                    const p = pct(yearToDate, lastYear)!;
                    return <>, {Math.round(Math.abs(p * 100))}% {p >= 0 ? "more" : "less"} than by then in {y - 1}</>;
                  })()}
                </p>
                <TrendChart
                  kind="bars"
                  values={yearly.slice(0, y === new Date().getFullYear() ? new Date().getMonth() + 1 : 12)}
                  total={12}
                  currency={cur}
                  names={[String(y)]}
                  highlight={m - 1}
                  label={(i) => `${MONTHS[i]} ${y}`}
                  ticks={MONTHS.map((t, i) => ({ at: i, text: t }))}
                  summary={`Spending per month in ${y}, ${formatMoney(yearToDate, cur)} by the end of ${monthName}.`}
                />
              </>
            )}
          </div>
        </section>

        <section aria-labelledby="fin-cat-h" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-6 max-sm:p-5">
          <h2 id="fin-cat-h" className="text-base font-medium">By category</h2>
          {byCat.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--text-muted)]">No spending this month.</p>
          ) : (
            <CategoryDonut byCat={byCat} total={spent} currency={cur} />
          )}
        </section>
      </div>

      <div className="grid items-stretch gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        <section aria-labelledby="fin-budget-h" className="flex flex-col gap-[18px] rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-6 max-sm:p-5">
          <div className="flex items-center">
            <h2 id="fin-budget-h" className="flex-1 text-base font-medium">Budgets</h2>
            {budgets.length > 0 && <button className="btn btn-plain btn-sm -mr-2 max-md:h-11" onClick={onBudgets}>Edit</button>}
          </div>
          {budgets.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]">No budgets yet. Give a category a monthly limit and see how it&apos;s going here.</p>
          )}
          {budgets.map((b) => {
            const tone = b.ratio >= 1 ? "danger" : b.ratio >= 0.8 ? "warning" : undefined;
            return (
              <div key={b.category} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{b.category}</span>
                  <span className="fn-num shrink-0 text-[13px] text-[var(--text-secondary)]">
                    {formatMoney(b.spent, cur)} <span className="text-[var(--text-muted)]">of {b.limit.toLocaleString("en-US")}</span>
                  </span>
                </div>
                <div
                  role="meter"
                  aria-label={`${b.category} budget used`}
                  aria-valuemin={0}
                  aria-valuemax={b.limit}
                  aria-valuenow={Math.min(b.spent, b.limit)}
                  aria-valuetext={`${formatMoney(b.spent, cur)} of ${formatMoney(b.limit, cur)}`}
                  className="meter"
                  data-tone={tone}
                >
                  <span style={{ width: `${Math.min(100, b.ratio * 100)}%` }} />
                </div>
                <span className={`fn-num text-xs ${tone === "danger" ? "text-[var(--danger)]" : tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-muted)]"}`}>
                  {b.ratio >= 1
                    ? `${formatMoney(b.spent - b.limit, cur)} over budget`
                    : `${tone ? "Almost used, " : ""}${formatMoney(b.limit - b.spent, cur)} left${isCurrent ? `, ${plural(daysLeft, "day")} to go` : ""}`}
                </span>
              </div>
            );
          })}
          <button className="btn btn-plain btn-sm -ml-2 mt-auto self-start pl-2 max-md:h-11" onClick={onBudgets}>
            <Icon name="plus" size={14} /> Add a budget
          </button>
        </section>

        <section aria-labelledby="fin-up-h" className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] px-4 pb-4 pt-6">
          <div className="flex items-center px-2 pb-2">
            <h2 id="fin-up-h" className="flex-1 text-base font-medium">Upcoming payments</h2>
            {upcomingTotal !== null && upcoming.length > 0 && <span className="fn-num text-[13px] text-[var(--text-muted)]">{formatMoney(upcomingTotal, cur)}</span>}
          </div>
          {upcoming.length === 0 ? (
            <p className="px-2 pb-2 text-sm text-[var(--text-secondary)]">No bills due soon. Repeating bills you add to To-Do show up here.</p>
          ) : (
            <ul className="flex flex-col">
              {upcoming.map((p, i) => {
                const n = daysFromToday(p.date);
                const d = new Date(`${p.date}T00:00:00`);
                return (
                  <li key={p.key} className={`flex items-center gap-3 px-2 py-2.5 ${i > 0 ? "border-t border-[var(--border-subtle)]" : ""}`}>
                    <div className="w-11 shrink-0 text-center" aria-hidden>
                      <span className="block text-[11px] text-[var(--text-muted)]">{MONTHS[d.getMonth()]}</span>
                      <span className="fn-num block text-lg font-medium leading-tight">{d.getDate()}</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{p.title}</span>
                      <span className="fn-num truncate text-xs text-[var(--text-muted)]">
                        <span className="sr-only">{shortDate(p.date)}, </span>{p.sub}, {formatMoney(p.amount, p.currency)}
                      </span>
                    </div>
                    {p.sub_ ? (
                      <button className="btn btn-secondary btn-sm max-md:h-11" onClick={() => trackSub(p.sub_!)}>Track</button>
                    ) : (
                      <>
                        {n < 0 ? (
                          <span className="badge badge-danger badge-dot">{n === -1 ? "1 day late" : `${-n} days late`}</span>
                        ) : n <= 3 ? (
                          <span className="badge badge-warning badge-dot">{n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`}</span>
                        ) : (
                          <span className="fn-num shrink-0 text-xs text-[var(--text-muted)]">In {n} days</span>
                        )}
                        <button
                          className="btn btn-plain btn-sm btn-icon -mr-1 max-md:h-11 max-md:w-11"
                          aria-label={`Mark ${p.title} as paid`}
                          title="Mark as paid"
                          onClick={() => { const extra = toggleTodo(p.todoId!, true); toast([`Paid: ${p.title}`, ...extra].join("\n")); }}
                        >
                          <Icon name="check" size={16} />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="fin-split-h" className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] px-4 pb-4 pt-6">
          <div className="flex items-center px-2 pb-2">
            <h2 id="fin-split-h" className="flex-1 text-base font-medium">Split bills</h2>
            {owed > 0 && <span className="fn-num text-[13px] text-[var(--text-muted)]">{formatMoney(owed, cur)} owed to you</span>}
          </div>
          {openSplits.length === 0 ? (
            <p className="px-2 pb-2 text-sm text-[var(--text-secondary)]">Nobody owes you. Open a transaction below to split it.</p>
          ) : (
            openSplits.slice(0, 3).map((tx) => (
              <div key={tx.id} className="flex flex-col">
                <button className="fn-num self-start rounded-full px-2 text-left text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]" onClick={() => onOpenTransaction(tx.id)}>
                  {tx.merchant}, {shortDate(tx.date)}, {formatMoney(tx.amount, tx.currency)} split with {plural(tx.splits!.length, "person").replace("persons", "people")}
                </button>
                <ul className="flex flex-col">
                  {tx.splits!.map((s, j) => (
                    <li key={`${s.name}-${j}`} className={`flex items-center gap-3 px-2 py-2.5 ${j > 0 ? "border-t border-[var(--border-subtle)]" : ""}`}>
                      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[13px] font-medium">
                        {s.name.trim()[0]?.toUpperCase() ?? "?"}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate">{s.name}</span>
                        <span className="fn-num text-xs text-[var(--text-muted)]">{s.settled ? "Paid" : "Owes you"} {formatMoney(s.amount, tx.currency)}</span>
                      </div>
                      {s.settled ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-[var(--success)]"><Icon name="check" size={14} />Settled</span>
                      ) : (
                        <button className="btn btn-secondary btn-sm max-md:h-11" onClick={() => settle(tx, j, true)}>Mark settled</button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {openSplits.length > 3 && <p className="px-2 text-xs text-[var(--text-muted)]">{openSplits.length - 3} more open below, in Transactions</p>}
        </section>
      </div>
    </div>
  );
}

/** One number in the strip. Hairlines come from the cells' own top and left borders, pulled under the strip's edge. */
function Kpi({ label, value, wide, big, children }: { label: string; value: string; wide?: boolean; big?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`-ml-px -mt-px flex min-w-0 flex-col gap-1.5 border-l border-t border-[var(--border-subtle)] px-6 py-5 max-sm:px-5 ${wide ? "max-sm:col-span-2" : ""}`}>
      <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
      <span className={`fn-display fn-num truncate py-px text-[28px] ${big ? "max-sm:text-[40px]" : wide ? "" : "max-sm:text-[22px]"}`}>{value}</span>
      {children && <span className="text-xs text-[var(--text-muted)]">{children}</span>}
    </div>
  );
}

function Legend({ items }: { items: { label: string; kind: "line" | "dashed" | "bar" | "dotted" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-secondary)]">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2">
          {it.kind === "line" && <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-[var(--accent)]" />}
          {it.kind === "dashed" && <span aria-hidden className="w-3.5 border-t-2 border-dashed border-[var(--border-strong)]" />}
          {it.kind === "bar" && <span aria-hidden className="h-2.5 w-2 rounded-[2px] bg-[var(--accent)]" />}
          {it.kind === "dotted" && <span aria-hidden className="w-3.5 border-t-2 border-dotted border-[var(--text-muted)]" />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Tracks an element's width, so the chart draws at real pixels and its labels keep their size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round step for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
}

/**
 * The spending chart. "line": a running total in the accent, with last month dashed and muted
 * and today marked. "bars": one bar per day or month, with the average day dotted.
 * Hover (or touch) shows the values in a floating card.
 */
function TrendChart({ kind, values, previous, total, currency, names, marker, highlight, average, label, ticks, summary }: {
  kind: "line" | "bars";
  values: number[];
  previous?: number[];
  total: number;
  currency: string;
  names: string[];
  marker?: number;
  highlight?: number;
  average?: boolean;
  label: (i: number) => string;
  ticks: { at: number; text: string }[];
  summary: string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = width || 720;
  const H = W < 480 ? 190 : 240;
  const padL = 2, padR = 46, padT = 14, padB = 26;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
  const top = Math.max(1, ...values, ...(previous ?? []));
  const step = niceStep((top * 1.08) / 4);
  const max = step * 4;
  const slot = (x1 - x0) / total;
  const X = kind === "bars" ? (i: number) => x0 + slot * (i + 0.5) : (i: number) => (total > 1 ? x0 + (i / (total - 1)) * (x1 - x0) : (x0 + x1) / 2);
  const Y = (v: number) => y1 - (v / max) * (y1 - y0);
  const path = (v: number[]) => v.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(" ");
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  // Today's values show without hovering where there's room; on a phone, on touch.
  const active = hover ?? (kind === "line" && W >= 480 ? marker ?? null : null);
  const markAt = hover ?? marker ?? null;
  const prevAt = (i: number) => previous && i < previous.length ? previous[i] : undefined;

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !values.length) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = kind === "bars" ? Math.floor((px - x0) / slot) : Math.round(((px - x0) / (x1 - x0)) * (total - 1));
    setHover(Math.max(0, Math.min(Math.max(values.length, previous?.length ?? 0) - 1, i)));
  };

  const tipLeft = active !== null ? X(active) : 0;
  const tipRight = tipLeft > W - 230;

  return (
    <div ref={box} className="relative" style={{ height: H }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="fin-chart block touch-pan-y overflow-visible">
          <g stroke="var(--border-subtle)" strokeWidth={1}>
            {[1, 2, 3, 4].map((k) => <line key={k} x1={x0} x2={x1} y1={Y(step * k)} y2={Y(step * k)} />)}
          </g>
          <line x1={x0} x2={x1} y1={y1} y2={y1} stroke="var(--border)" strokeWidth={1} />
          <g>
            {[0, 1, 2, 3, 4].map((k) => <text key={k} x={x1 + 10} y={Y(step * k) + 4}>{k ? compact.format(step * k) : "0"}</text>)}
            {/* Twelve months don't fit a phone's width: every other one there. */}
            {ticks.filter((_, i) => !(total === 12 && W < 480 && i % 2 === 1)).map((t) => (
              <text key={t.at} x={X(t.at)} y={H - 6} textAnchor={kind === "line" && t.at === 0 ? "start" : "middle"}>{t.text}</text>
            ))}
          </g>

          {kind === "line" && (
            <>
              {previous && previous.length > 1 && (
                <path d={path(previous)} fill="none" stroke="var(--border-strong)" strokeWidth={2} strokeDasharray="4 5" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {values.length > 1 && (
                <>
                  <path d={`${path(values)} L${X(values.length - 1).toFixed(1)},${y1} L${X(0).toFixed(1)},${y1} Z`} fill="var(--accent)" fillOpacity={0.07} />
                  <path d={path(values)} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
              {markAt !== null && (
                <>
                  <line x1={X(markAt)} x2={X(markAt)} y1={Y(Math.max(values[markAt] ?? 0, prevAt(markAt) ?? 0))} y2={y1} stroke="var(--border-strong)" strokeWidth={1} />
                  {prevAt(markAt) !== undefined && <circle cx={X(markAt)} cy={Y(prevAt(markAt)!)} r={3.5} fill="var(--border-strong)" />}
                  {values[markAt] !== undefined && <circle cx={X(markAt)} cy={Y(values[markAt])} r={5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2.25} />}
                </>
              )}
            </>
          )}

          {kind === "bars" && (
            <>
              {values.map((v, i) => {
                const h = Math.max(v > 0 ? 2 : 0, y1 - Y(v));
                const bw = Math.min(28, Math.max(3, slot * 0.62));
                const on = highlight === undefined ? true : highlight === i;
                return (
                  <rect
                    key={i}
                    className="fin-bar"
                    x={X(i) - bw / 2}
                    y={y1 - h}
                    width={bw}
                    height={h}
                    rx={Math.min(4, bw / 2)}
                    fill={on ? "var(--accent)" : REST}
                    opacity={hover !== null && hover !== i ? 0.45 : 1}
                  />
                );
              })}
              {average && values.length > 0 && (
                <line x1={x0} x2={x1} y1={Y(avg)} y2={Y(avg)} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" />
              )}
            </>
          )}
        </svg>
      )}

      {active !== null && (values[active] !== undefined || prevAt(active) !== undefined) && (
        <div
          className="pointer-events-none absolute z-10 flex w-[196px] flex-col gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs shadow-[var(--shadow-floating)]"
          style={{ top: 0, left: tipRight ? undefined : Math.min(tipLeft + 12, W - 196), right: tipRight ? W - tipLeft + 12 : undefined }}
          aria-hidden
        >
          <span className="text-[var(--text-muted)]">{label(active)}</span>
          {values[active] !== undefined && (
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
              <span className="min-w-0 flex-1 truncate">{names[0]}</span>
              <span className="fn-num font-medium">{formatMoney(values[active], currency)}</span>
            </span>
          )}
          {prevAt(active) !== undefined && (
            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--border-strong)]" />
              <span className="min-w-0 flex-1 truncate">{names[1]}</span>
              <span className="fn-num">{formatMoney(prevAt(active)!, currency)}</span>
            </span>
          )}
          {average && (
            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
              <span className="w-2 shrink-0 border-t-2 border-dotted border-[var(--text-muted)]" />
              <span className="min-w-0 flex-1">Average day</span>
              <span className="fn-num">{formatMoney(avg, currency)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The donut: the top five categories in the series colours, the rest together as "Other". */
function CategoryDonut({ byCat, total, currency }: { byCat: [string, number][]; total: number; currency: string }) {
  const sum = byCat.reduce((s, [, v]) => s + v, 0) || 1;
  const top = byCat.slice(0, 5);
  const rest = byCat.slice(5).reduce((s, [, v]) => s + v, 0);
  const parts = [...top.map(([c, v], i) => ({ name: c, value: v, color: SERIES[i] })), ...(rest > 0 ? [{ name: "Other", value: rest, color: REST }] : [])];
  const R = 60, C = 2 * Math.PI * R, gap = parts.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = parts.map((p) => {
    const len = (p.value / sum) * C;
    const arc = { ...p, dash: `${Math.max(0.5, len - gap)} ${C - Math.max(0.5, len - gap)}`, offset: -offset };
    offset += len;
    return arc;
  });
  const share = (v: number) => Math.round((v / sum) * 100);

  return (
    <>
      <div className="relative h-[168px] w-[168px] self-center">
        <svg viewBox="0 0 168 168" width={168} height={168} role="img" aria-label={parts.map((p) => `${p.name} ${share(p.value)} percent`).join(", ")} className="-rotate-90">
          {arcs.map((a) => (
            <circle key={a.name} cx={84} cy={84} r={R} fill="none" stroke={a.color} strokeWidth={18} strokeDasharray={a.dash} strokeDashoffset={a.offset} />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-xs text-[var(--text-muted)]">Spent</span>
          <span className="fn-num max-w-[110px] truncate text-base font-medium">{formatMoney(total, currency)}</span>
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 text-[13px]">
        {parts.map((p) => (
          <li key={p.name} className="flex min-h-[34px] items-center gap-2.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="fn-num shrink-0 text-[var(--text-muted)]">{formatMoney(p.value, currency)}</span>
            <span className="fn-num w-9 shrink-0 text-right font-medium">{share(p.value)}%</span>
          </li>
        ))}
      </ul>
    </>
  );
}
