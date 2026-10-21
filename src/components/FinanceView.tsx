"use client";
// Finance: a header row (month, scan, more), the dashboard, a one-line add bar, and the
// month's transactions in a sortable table whose rows open to edit and split.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { baseAmount, myShare, spendByCategory } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { scrollToId, useOpenItem } from "@/lib/nav";
import { fingerprint } from "@/lib/fingerprint";
import { useOnline } from "@/lib/hooks";
import { composeReview, isComposedReview } from "@/lib/monthlyReview";
import { alive, formatMoney, localDate, localMonth, parseAmount, useStore } from "@/lib/store";
import { CURRENCIES, type Tab, type Transaction } from "@/lib/types";
import { parseWalletNotification } from "@/lib/wallet";
import { useAssistant } from "./assistant";
import BudgetEditor from "./BudgetEditor";
import CategoryEditor from "./CategoryEditor";
import CategorySelect from "./CategorySelect";
import ReportModal from "./ReportModal";
import ScanPicker from "./ScanPicker";
import SplitEditor from "./SplitEditor";
import EmptyStart from "./EmptyStart";
import Dashboard, { categoryColors } from "./finance/Dashboard";
import { Dropdown, MenuItem, MenuSep } from "./notes/Dropdown";
import { Icon, Modal, useToast } from "./ui";

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const shiftMonth = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00`);
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

type SortCol = "date" | "merchant" | "category" | "amount";
type SortState = { col: SortCol; dir: "asc" | "desc" };

export default function FinanceView({ setTab }: { setTab: (t: Tab) => void }) {
  const { transactions, notes, summaries, settings, categories, addTransaction, updateTransaction, remove, saveSummary } = useStore();
  const { send, scan } = useAssistant();
  const toast = useToast();
  const cur = settings.currency;
  const [month, setMonth] = useState(() => localMonth());
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ merchant: "", amount: "", currency: cur, category: "Food & Drink" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  /** Narrows the transaction table. */
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ col: "date", dir: "desc" });
  const merchantRef = useRef<HTMLInputElement>(null);
  const online = useOnline();

  useOpenItem("transaction", (f) => {
    const t = transactions.find((x) => x.id === f.id);
    if (!t) return;
    setMonth(t.date.slice(0, 7));
    setQuery("");
    setCatFilter("");
    setOpenId(t.id);
    scrollToId(`tx-${t.id}`);
  });
  // Budgets are edited in Finance settings.
  useOpenItem("budget", () => setSettingsOpen(true));

  const live = useMemo(() => alive(transactions), [transactions]);
  const txs = useMemo(
    () => live.filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [live, month],
  );
  const total = txs.filter((t) => t.amount > 0).reduce((s, t) => s + myShare(t, cur), 0);
  const byCat = spendByCategory(txs, cur);
  const colors = categoryColors(Object.entries(byCat as Record<string, number>).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]));
  const summary = summaries.find((s) => s.month === month);

  /** `asked`: the button was pressed. Written on its own, a failure stays quiet. */
  const summarize = async (asked = true) => {
    setLoading(true);
    try {
      const { text } = await api.monthlySummary(month, cur, txs.map((t) => ({ merchant: t.merchant, amount: myShare(t, cur), category: t.category, date: t.date })));
      // The figures are the app's own; the model keeps what needs judgement.
      saveSummary({ month, total, currency: cur, byCategory: byCat as Record<string, number>, text: composeReview(text, total, byCat as Record<string, number>, cur), createdAt: new Date().toISOString() });
    } catch (e) {
      if (asked) toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // The review is rewritten each time Finance opens after the month's spending changed, or on a new day.
  const reviewBasis = fingerprint(`${month}#${localDate()}#${txs.map((t) => `${t.id}|${t.amount}|${t.category}`).join(";")}`);
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (month !== localMonth() || !txs.length || !online || requested.current === reviewBasis) return;
    // Up to date: written today, over the same total, by the app (not an older one straight from a model).
    if (summary && localDate(new Date(summary.createdAt)) === localDate() && Math.abs(summary.total - total) < 1 && isComposedReview(summary.text, summary.total, cur)) return;
    // Let a burst of edits settle; a newer change cancels this one.
    const t = setTimeout(() => { requested.current = reviewBasis; summarize(false); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewBasis, online]);

  /** The table, narrowed by the search box and the category filter, then sorted. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = txs.filter((t) =>
      (!catFilter || t.category === catFilter) &&
      (!q || t.merchant.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.items.some((i) => i.name.toLowerCase().includes(q))),
    );
    const by: Record<SortCol, (a: Transaction, b: Transaction) => number> = {
      date: (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
      merchant: (a, b) => a.merchant.localeCompare(b.merchant),
      category: (a, b) => a.category.localeCompare(b.category),
      amount: (a, b) => baseAmount(a, cur) - baseAmount(b, cur),
    };
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => sign * by[sort.col](a, b));
  }, [txs, query, catFilter, sort, cur]);
  const filtered = !!query.trim() || !!catFilter;
  const shownTotal = shown.filter((t) => t.amount > 0).reduce((s, t) => s + myShare(t, cur), 0);
  const toggleSort = (col: SortCol) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "date" || col === "amount" ? "desc" : "asc" }));

  const submitPaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    const parsed = parseWalletNotification(text);
    if (parsed) {
      addTransaction({ merchant: parsed.merchant, amount: parsed.amount, category: parsed.category, date: localDate() });
      toast(`💸 ${parsed.wallet ?? "Payment"}: ${parsed.merchant} ${formatMoney(Math.abs(parsed.amount), cur)}`);
    } else if (navigator.onLine) {
      send(text);
      toast("Sent to the assistant to read.");
    } else {
      return toast("Couldn't read that offline. Try again when you're connected.", "error");
    }
    setPasteText("");
    setPasteOpen(false);
  };

  const deleteTx = (t: Transaction) => {
    remove("transactions", t.id);
    if (openId === t.id) setOpenId(null);
    toast(`Deleted ${t.merchant}`, "ok", { label: "Undo", run: () => updateTransaction(t.id, { deletedAt: null }) });
  };

  /** Income: the add bar switches to the Income category and waits for the amount. */
  const addIncome = () => {
    setForm((f) => ({ ...f, category: "Income" }));
    scrollToId("finance-add", "center");
    setTimeout(() => merchantRef.current?.focus({ preventScroll: true }), 250);
  };

  const sortTh = (col: SortCol, text: string, className = "") => {
    const on = sort.col === col;
    return (
      <th scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} className={`pb-2.5 pt-3.5 font-normal ${className}`}>
        <button
          type="button"
          onClick={() => toggleSort(col)}
          className={`inline-flex items-center gap-1 rounded-full transition-colors hover:text-[var(--foreground)] ${on ? "font-medium text-[var(--foreground)]" : ""}`}
        >
          {text}
          <Icon name="chevronDown" size={12} className={`transition-transform ${on ? "" : "opacity-0"} ${on && sort.dir === "asc" ? "rotate-180" : ""}`} />
        </button>
      </th>
    );
  };

  return (
    <div>
      {/* Under the page title (which carries the Beta badge): the month, scanning, and the rest of Finance's actions. */}
      <div className="-mt-2 mb-6 flex flex-wrap items-center justify-end gap-2.5">
        <div className="flex h-9 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] max-md:h-11">
          <button className="grid h-full w-9 place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] max-md:w-11" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
            <Icon name="chevronLeft" size={16} />
          </button>
          <span key={month} className="fn-note-in min-w-[8.5rem] text-center text-sm font-medium" aria-live="polite">{monthLabel(month)}</span>
          <button className="grid h-full w-9 place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] max-md:w-11" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
            <Icon name="chevron" size={16} />
          </button>
        </div>
        <ScanPicker onFile={(f) => void scan(f)}>
          {(pick) => (
            <button className="btn btn-secondary max-md:h-11 max-sm:w-11 max-sm:px-0" onClick={pick} aria-label="Scan receipt">
              <Icon name="scan" size={16} /> <span className="max-sm:hidden">Scan receipt</span>
            </button>
          )}
        </ScanPicker>
        <Dropdown label="More finance actions" button={<Icon name="more" size={18} />} width={270} align="right" chevron={false} className="btn btn-secondary btn-icon text-[var(--text-secondary)] max-md:h-11 max-md:w-11">
          {(close) => (
            <>
              <MenuItem icon="download" label="Monthly report…" onSelect={() => { close(); setReportOpen(true); }} />
              <MenuItem icon="clipboard" label="Paste a payment notification…" onSelect={() => { close(); setPasteOpen(true); }} />
              <MenuSep />
              <MenuItem icon="target" label="Budgets and categories…" onSelect={() => { close(); setSettingsOpen(true); }} />
            </>
          )}
        </Dropdown>
      </div>

      <Dashboard
        month={month}
        setTab={setTab}
        summary={summary}
        summarizing={loading}
        onSummarize={() => summarize(true)}
        onBudgets={() => setSettingsOpen(true)}
        onOpenTransactions={() => scrollToId("finance-transactions", "start")}
        onOpenTransaction={(id) => { setOpenId(id); scrollToId(`tx-${id}`); }}
        onAddIncome={addIncome}
      />

      {/* One line to add a transaction. Income goes in as money received. */}
      <form
        id="finance-add"
        aria-label="Add a transaction"
        className="mt-6 flex scroll-mt-24 flex-wrap items-center gap-1.5 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = parseAmount(form.amount);
          if (!form.merchant.trim() || !amount) return;
          addTransaction({
            merchant: form.merchant, amount: form.category === "Income" ? -Math.abs(amount) : amount, currency: form.currency, fxRate: null, category: form.category,
            date: month === localMonth() ? localDate() : `${month}-01`,
          });
          setForm({ ...form, merchant: "", amount: "" });
        }}
      >
        <input
          ref={merchantRef}
          value={form.merchant}
          onChange={(e) => setForm({ ...form, merchant: e.target.value })}
          placeholder={form.category === "Income" ? "Add income, like Salary" : "Add a transaction, like Lunch at Sederhana"}
          aria-label="Merchant or note"
          className="input-plain h-11 min-w-0 flex-[999_1_240px] rounded-[20px] px-4 text-[15px]"
        />
        <div className="flex h-11 min-w-0 flex-[1_1_170px] items-center rounded-[20px] bg-[var(--surface-muted)] pr-4">
          <select
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            aria-label="Currency"
            className="h-full shrink-0 cursor-pointer rounded-[20px] bg-transparent pl-4 pr-1 text-[var(--text-muted)] outline-none hover:text-[var(--foreground)]"
          >
            {[...new Set([cur, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="0"
            aria-label="Amount"
            inputMode="decimal"
            className="input-plain fn-num h-full min-w-0 flex-1 pl-1.5"
          />
        </div>
        <CategorySelect
          value={form.category}
          onChange={(category) => setForm({ ...form, category })}
          className="h-11 min-w-0 max-w-full flex-none cursor-pointer rounded-[20px] bg-[var(--surface-muted)] px-4 text-[var(--text-secondary)] outline-none hover:text-[var(--foreground)]"
        />
        <button type="submit" className="btn btn-primary h-11 rounded-[20px] px-[22px] max-sm:flex-1">Add</button>
      </form>

      <section id="finance-transactions" aria-labelledby="tx-h" className="mt-6 flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="tx-h" className="min-w-0 flex-1 text-xl font-medium">Transactions</h2>
          <div className="relative w-[260px] max-w-full max-sm:order-last max-sm:w-full">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
              placeholder="Search merchants or items"
              aria-label="Search transactions"
              className="field pl-9 max-md:h-11"
            />
          </div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filter by category" className="field w-auto cursor-pointer text-[var(--text-secondary)] max-md:h-11">
            <option value="">All categories</option>
            {[...new Set([...categories, ...txs.map((t) => t.category)])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {txs.length === 0 ? (
          <EmptyStart
            title="No spending logged yet"
            hint="Add one above, scan a receipt, paste a payment notification, or just say what you spent."
            prompts={["Spent 25k on coffee at Starbucks", "Set my food budget to 1.5M a month"]}
            extra={<button className="btn btn-secondary btn-sm" onClick={() => setPasteOpen(true)}>Paste a notification</button>}
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm sm:min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)]">
                    {sortTh("date", "Date", "w-[104px] pl-6 pr-3 max-sm:w-[76px] max-sm:pl-4")}
                    {sortTh("merchant", "Merchant", "pr-3")}
                    {sortTh("category", "Category", "hidden w-[200px] pr-3 sm:table-cell")}
                    {sortTh("amount", "Amount", "w-[150px] pr-6 text-right max-sm:w-auto max-sm:pr-4")}
                    <th className="hidden w-12 sm:table-cell"><span className="sr-only">Delete</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr className="border-t border-[var(--border-subtle)]">
                      <td colSpan={5} className="px-6 py-8 text-center text-[var(--text-muted)]">
                        Nothing matches{query.trim() ? ` “${query.trim()}”` : ""}{catFilter ? ` in ${catFilter}` : ""}.
                      </td>
                    </tr>
                  )}
                  {shown.map((t) => {
                    const foreign = t.currency !== cur;
                    const isOpen = openId === t.id;
                    const splits = t.splits ?? [];
                    const unsettled = splits.filter((s) => !s.settled).length;
                    const income = t.amount < 0;
                    const dot = <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[t.category] ?? "var(--fin-rest)" }} />;
                    return (
                      <Fragment key={t.id}>
                        <TransactionRow id={t.id} open={isOpen}>
                          <td className="fn-num whitespace-nowrap py-3.5 pl-6 pr-3 align-top text-[var(--text-secondary)] max-sm:pl-4 sm:align-middle">
                            {new Date(`${t.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </td>
                          <td className="py-2.5 pr-3">
                            <button className="flex min-h-9 w-full items-center gap-2.5 text-left" onClick={() => setOpenId(isOpen ? null : t.id)} aria-expanded={isOpen}>
                              {t.imageDataUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={t.imageDataUrl} alt="" className="h-8 w-8 shrink-0 rounded-[10px] object-cover" />
                              )}
                              <span className="min-w-0">
                                <span className="block truncate">{t.merchant}</span>
                                <span className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-muted)]">
                                  <span className="inline-flex items-center gap-1.5 sm:hidden">{dot}{t.category}</span>
                                  {t.items.length > 0 && <span className="truncate">{t.items.map((i) => i.name).join(", ").slice(0, 60)}</span>}
                                  {splits.length > 0 && (
                                    <span className="inline-flex items-center gap-1">
                                      <Icon name="users" size={12} />Split with {splits.length}{unsettled ? `, ${unsettled} unpaid` : ", all settled"}
                                    </span>
                                  )}
                                  {t.noteId && <span className="inline-flex items-center gap-1"><Icon name="link" size={12} />Linked note</span>}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="hidden py-2.5 pr-3 sm:table-cell">
                            <span className="inline-flex max-w-full items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
                              {dot}
                              <CategorySelect
                                value={t.category}
                                onChange={(category) => updateTransaction(t.id, { category })}
                                ariaLabel={`Category of ${t.merchant}`}
                                className="min-w-0 max-w-full cursor-pointer truncate rounded-full bg-transparent py-1 pr-1 outline-none hover:text-[var(--foreground)]"
                              />
                            </span>
                          </td>
                          <td className="fn-num whitespace-nowrap py-3.5 pr-6 text-right align-top max-sm:pr-4 sm:align-middle">
                            {splits.length > 0 && !income ? (
                              <>
                                <span className="block">{formatMoney(myShare(t, cur), cur)}</span>
                                <span className="block text-xs text-[var(--text-muted)]">of {formatMoney(t.amount, t.currency)}</span>
                              </>
                            ) : (
                              <>
                                <span className="block">{income ? "+" : ""}{formatMoney(Math.abs(t.amount), t.currency)}</span>
                                {foreign && <span className="block text-xs text-[var(--text-muted)]">{t.fxRate ? `≈ ${formatMoney(Math.abs(baseAmount(t, cur)), cur)}` : "Fetching the rate…"}</span>}
                                {income && <span className="block text-xs text-[var(--text-muted)]">Income</span>}
                              </>
                            )}
                          </td>
                          <td className="hidden w-12 pr-3 text-right sm:table-cell">
                            <button
                              className="btn btn-plain btn-sm btn-icon opacity-0 hover:!text-[var(--danger)] focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                              onClick={() => deleteTx(t)}
                              aria-label={`Delete ${t.merchant}`}
                              title="Delete"
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </td>
                        </TransactionRow>
                        {isOpen && (
                          <tr>
                            <td colSpan={5} className="bg-[var(--hover)] px-6 pb-5 pt-1 max-sm:px-4">
                              <div className="grid gap-6 md:grid-cols-2">
                                <div className="grid grid-cols-2 content-start gap-3 text-xs text-[var(--text-muted)]">
                                  <label className="col-span-2 flex flex-col gap-1.5 sm:hidden">Category
                                    <CategorySelect value={t.category} onChange={(category) => updateTransaction(t.id, { category })} className="field h-11 text-sm" />
                                  </label>
                                  <label className="flex flex-col gap-1.5">Merchant
                                    <input value={t.merchant} onChange={(e) => updateTransaction(t.id, { merchant: e.target.value })} className="field text-sm max-md:h-11" />
                                  </label>
                                  <label className="flex flex-col gap-1.5">Date
                                    <input type="date" value={t.date} onChange={(e) => e.target.value && updateTransaction(t.id, { date: e.target.value })} className="field fn-num text-sm max-md:h-11" />
                                  </label>
                                  <label className="flex flex-col gap-1.5">Amount
                                    <input key={t.amount} defaultValue={t.amount} inputMode="decimal"
                                      onBlur={(e) => { const n = parseAmount(e.target.value.replace(/^-/, "")); if (n != null) updateTransaction(t.id, { amount: e.target.value.trim().startsWith("-") ? -n : n }); }}
                                      className="field fn-num text-sm max-md:h-11" />
                                  </label>
                                  <label className="flex flex-col gap-1.5">Currency
                                    <select value={t.currency} onChange={(e) => updateTransaction(t.id, { currency: e.target.value, fxRate: null })} className="field text-sm max-md:h-11">
                                      {[...new Set([cur, t.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                  </label>
                                  {foreign && (
                                    <label className="col-span-2 flex flex-col gap-1.5">Rate: 1 {t.currency} = ? {cur}
                                      <input key={t.fxRate ?? "none"} defaultValue={t.fxRate ?? ""} inputMode="decimal" placeholder="Fetched automatically when online"
                                        onBlur={(e) => { const n = Number(e.target.value.replace(/,/g, "")); if (n > 0) updateTransaction(t.id, { fxRate: n }); }}
                                        className="field fn-num text-sm max-md:h-11" />
                                    </label>
                                  )}
                                  <label className="col-span-2 flex flex-col gap-1.5">Linked note
                                    <select value={t.noteId ?? ""} onChange={(e) => updateTransaction(t.id, { noteId: e.target.value || null })} className="field text-sm max-md:h-11">
                                      <option value="">None</option>
                                      {alive(notes).map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
                                    </select>
                                  </label>
                                  <p className="col-span-2 text-xs">Amounts below zero are money received.</p>
                                  <button className="btn btn-danger btn-sm col-span-2 -ml-3 justify-self-start max-md:h-11" onClick={() => deleteTx(t)}>
                                    Delete transaction
                                  </button>
                                </div>
                                <div>
                                  <p className="group-label mb-2">Split bill</p>
                                  <SplitEditor txId={t.id} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--border)] bg-[var(--surface-muted)]">
                    <td colSpan={2} className="py-3.5 pl-6 pr-3 text-[var(--text-secondary)] max-sm:pl-4">
                      {filtered ? `Your share of the ${shown.length === 1 ? "one" : shown.length} shown` : `Your share in ${monthLabel(month).split(" ")[0]}`}
                    </td>
                    <td className="hidden sm:table-cell" />
                    <td className="fn-num whitespace-nowrap py-3.5 pr-6 text-right font-medium max-sm:pr-4">{formatMoney(filtered ? shownTotal : total, cur)}</td>
                    <td className="hidden sm:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="Paste a payment notification">
        <div className="space-y-4 p-5">
          <p className="text-sm text-[var(--text-secondary)]">
            Paste a payment notification from any app (GoPay, OVO, DANA, ShopeePay, QRIS, a bank app) or the text of a receipt. For screenshots
            and photos, use Scan receipt instead.
          </p>
          <textarea
            autoFocus
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Payment to Kopi Kenangan of Rp28,000 was successful"
            aria-label="Notification text"
            className="field w-full"
          />
          <div className="flex justify-end gap-2">
            <button className="btn btn-plain" onClick={() => setPasteOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!pasteText.trim()} onClick={submitPaste}>Add</button>
          </div>
        </div>
      </Modal>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Budgets and categories">
        <div className="space-y-6 p-5 text-sm">
          <section aria-labelledby="finance-budgets" className="space-y-3">
            <h3 id="finance-budgets" className="text-[15px] font-medium">Monthly budgets</h3>
            <BudgetEditor />
          </section>
          <section aria-labelledby="finance-categories" className="space-y-3 border-t border-[var(--border-subtle)] pt-5">
            <h3 id="finance-categories" className="text-[15px] font-medium">Categories</h3>
            <CategoryEditor />
          </section>
          <button className="btn btn-primary btn-lg w-full" onClick={() => setSettingsOpen(false)}>Done</button>
        </div>
      </Modal>
    </div>
  );
}

/** Table row that flashes when the assistant has just filed this transaction. */
function TransactionRow({ id, open, children }: { id: string; open: boolean; children: React.ReactNode }) {
  const justFiled = useFiledFlash(id);
  return (
    <tr id={`tx-${id}`} data-open={open} className={`tx-row group scroll-mt-24 border-t border-[var(--border-subtle)] ${justFiled ? "fn-flash" : ""}`}>
      {children}
    </tr>
  );
}
