"use client";
// Annual / tax report: month × category table, CSV for Excel, and a print view for PDF.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { downloadFile, toCsv } from "@/lib/client";
import { baseAmount, myShare } from "@/lib/insights";
import { alive, formatMoney, useStore } from "@/lib/store";
import { Icon, Modal } from "./ui";

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const monthName = (m: string) => new Date(2000, Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short" });

export default function ReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { transactions, settings, spaces, currentSpaceId, categories } = useStore();
  const cur = settings.currency;
  const live = useMemo(() => alive(transactions), [transactions]);
  const years = useMemo(() => {
    const ys = new Set(live.map((t) => t.date.slice(0, 4)));
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort().reverse();
  }, [live]);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));

  const data = useMemo(() => {
    const txs = live.filter((t) => t.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date));
    const cats = categories.filter((c) => c !== "Income");
    const grid: Record<string, Record<string, number>> = {};
    const income: Record<string, number> = {};
    for (const m of MONTHS) { grid[m] = {}; income[m] = 0; }
    for (const t of txs) {
      const m = t.date.slice(5, 7);
      if (t.amount < 0) income[m] += Math.abs(baseAmount(t, cur));
      else grid[m][t.category] = (grid[m][t.category] ?? 0) + myShare(t, cur);
    }
    const usedCats = cats.filter((c) => MONTHS.some((m) => grid[m][c]));
    const catTotal = Object.fromEntries(usedCats.map((c) => [c, MONTHS.reduce((s, m) => s + (grid[m][c] ?? 0), 0)]));
    const monthSpend = Object.fromEntries(MONTHS.map((m) => [m, Object.values(grid[m]).reduce((s, v) => s + v, 0)]));
    const spent = Object.values(monthSpend).reduce((s, v) => s + v, 0);
    const earned = Object.values(income).reduce((s, v) => s + v, 0);
    return { txs, grid, income, usedCats, catTotal, monthSpend, spent, earned };
  }, [live, year, cur, categories]);

  const spaceName = spaces.find((s) => s.id === currentSpaceId)?.name ?? "Personal";

  const exportTransactions = () =>
    downloadFile(
      `four-notes-transactions-${year}.csv`,
      toCsv([
        ["Date", "Merchant", "Category", "Amount", "Currency", "FX rate", `Amount (${cur})`, `Your share (${cur})`, "Split with", "Items", "Source"],
        ...data.txs.map((t) => [
          t.date, t.merchant, t.category, t.amount, t.currency, t.currency === cur ? "" : t.fxRate ?? "",
          Math.round(baseAmount(t, cur) * 100) / 100, Math.round(myShare(t, cur) * 100) / 100,
          (t.splits ?? []).map((s) => `${s.name} ${s.amount}${s.settled ? " (paid)" : ""}`).join("; "),
          t.items.map((i) => i.name).join("; "), t.source,
        ]),
      ]),
      "text/csv;charset=utf-8",
    );

  const exportSummary = () =>
    downloadFile(
      `four-notes-summary-${year}.csv`,
      toCsv([
        ["Category", ...MONTHS.map(monthName), "Total"],
        ...data.usedCats.map((c) => [c, ...MONTHS.map((m) => Math.round(data.grid[m][c] ?? 0)), Math.round(data.catTotal[c])]),
        ["Total spent", ...MONTHS.map((m) => Math.round(data.monthSpend[m])), Math.round(data.spent)],
        ["Income", ...MONTHS.map((m) => Math.round(data.income[m])), Math.round(data.earned)],
        ["Net", ...MONTHS.map((m) => Math.round(data.income[m] - data.monthSpend[m])), Math.round(data.earned - data.spent)],
      ]),
      "text/csv;charset=utf-8",
    );

  // The short colour names (--muted, --faint, --line) are the ones the print stylesheet resets to paper colours.
  const report = (
    <div className="report text-sm">
      <h1 className="text-2xl font-medium tracking-[-0.02em]">Four Notes, {year} financial report</h1>
      <p className="mb-5 mt-1 text-[var(--muted)]">{spaceName}, amounts in {cur}, made {new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
      <div className="mb-5 grid grid-cols-3 overflow-hidden rounded-[var(--radius-control)] border border-[var(--line)]">
        {[["Spent (your share)", data.spent], ["Income", data.earned], ["Net", data.earned - data.spent]].map(([label, value], i) => (
          <div key={label} className={`flex min-w-0 flex-col gap-1 px-4 py-3 ${i ? "border-l border-[var(--line)]" : ""}`}>
            <span className="text-xs text-[var(--faint)]">{label}</span>
            <span className="fn-num truncate text-lg font-medium">{formatMoney(value as number, cur)}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="fn-num w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-[var(--faint)]">
              <th scope="col" className="py-2 pr-2 font-normal">Category</th>
              {MONTHS.map((m) => <th key={m} scope="col" className="px-1 py-2 text-right font-normal">{monthName(m)}</th>)}
              <th scope="col" className="py-2 pl-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.usedCats.map((c) => (
              <tr key={c} className="border-b border-[var(--line)]">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">{c}</th>
                {MONTHS.map((m) => <td key={m} className="px-1 py-1.5 text-right">{data.grid[m][c] ? formatMoney(data.grid[m][c], cur, true) : ""}</td>)}
                <td className="py-1.5 pl-2 text-right font-medium">{formatMoney(data.catTotal[c], cur, true)}</td>
              </tr>
            ))}
            <tr className="border-b border-[var(--line)] font-medium">
              <th scope="row" className="py-1.5 pr-2 text-left font-medium">Total spent</th>
              {MONTHS.map((m) => <td key={m} className="px-1 py-1.5 text-right">{data.monthSpend[m] ? formatMoney(data.monthSpend[m], cur, true) : ""}</td>)}
              <td className="py-1.5 pl-2 text-right">{formatMoney(data.spent, cur, true)}</td>
            </tr>
            <tr>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">Income</th>
              {MONTHS.map((m) => <td key={m} className="px-1 py-1.5 text-right">{data.income[m] ? formatMoney(data.income[m], cur, true) : ""}</td>)}
              <td className="py-1.5 pl-2 text-right">{formatMoney(data.earned, cur, true)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-[var(--faint)]">{data.txs.length} transactions. Shares of split bills paid by others are left out of spending.</p>
    </div>
  );

  return (
    <>
      <Modal open={open} onClose={onClose} title="Annual report" wide>
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" className="field fn-num w-auto max-md:h-11">
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn btn-secondary btn-sm max-md:h-11" onClick={exportTransactions} disabled={!data.txs.length}>
                <Icon name="download" size={14} /> Transactions (Excel CSV)
              </button>
              <button className="btn btn-secondary btn-sm max-md:h-11" onClick={exportSummary} disabled={!data.txs.length}>
                <Icon name="download" size={14} /> Summary (Excel CSV)
              </button>
              <button className="btn btn-primary btn-sm max-md:h-11" onClick={() => window.print()} disabled={!data.txs.length}>
                <Icon name="print" size={14} /> Print or save as PDF
              </button>
            </div>
          </div>
          {report}
        </div>
      </Modal>
      {open && typeof document !== "undefined" && createPortal(<div className="print-only p-8">{report}</div>, document.body)}
    </>
  );
}
