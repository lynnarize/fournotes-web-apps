"use client";
import { useState } from "react";
import { equalSplit, myShare } from "@/lib/insights";
import { formatMoney, parseAmount, useStore } from "@/lib/store";
import type { Split } from "@/lib/types";
import { Icon } from "./ui";

/** Split a bill: equal split in one step, then fine-tune amounts and mark people as paid. */
export default function SplitEditor({ txId }: { txId: string }) {
  const { transactions, updateTransaction, settings } = useStore();
  const [names, setNames] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return <p className="text-sm text-[var(--muted)]">Transaction not found.</p>;

  const splits = tx.splits ?? [];
  const setSplits = (next: Split[]) => updateTransaction(tx.id, { splits: next });
  const others = splits.reduce((s, x) => s + x.amount, 0);

  const addPeople = () => {
    const people = names.split(/\s*(?:,|\band\b|\bdan\b|&)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (!people.length) return;
    const everyone = [...splits.map((s) => s.name), ...people.filter((p) => !splits.some((s) => s.name.toLowerCase() === p.toLowerCase()))];
    const settled = new Map(splits.map((s) => [s.name, s.settled]));
    setSplits(equalSplit(tx.amount, everyone, includeMe).map((s) => ({ ...s, settled: settled.get(s.name) ?? false })));
    setNames("");
  };

  const owed = splits.filter((s) => !s.settled).reduce((a, s) => a + s.amount, 0);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{tx.merchant}</span>
        <span className="fn-num shrink-0">{formatMoney(tx.amount, tx.currency)}</span>
      </div>

      {splits.length > 0 && (
        <ul className="flex flex-col">
          {splits.map((s, i) => (
            <li key={i} className={`flex min-h-11 items-center gap-2.5 ${i ? "border-t border-[var(--border-subtle)]" : ""}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={s.settled}
                aria-label={`${s.name || "This person"} paid`}
                title={s.settled ? "Paid" : "Mark as paid"}
                onClick={() => setSplits(splits.map((x, j) => (j === i ? { ...x, settled: !x.settled } : x)))}
                className="check relative before:absolute before:-inset-3"
              >
                {s.settled && <Icon name="check" size={12} />}
              </button>
              <input
                value={s.name}
                aria-label="Name"
                onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className={`input-plain h-9 min-w-0 flex-1 ${s.settled ? "text-[var(--text-muted)] line-through" : ""}`}
              />
              <input
                key={s.amount}
                defaultValue={s.amount}
                inputMode="decimal"
                aria-label={`${s.name} amount`}
                onBlur={(e) => { const n = parseAmount(e.target.value); if (n != null) setSplits(splits.map((x, j) => (j === i ? { ...x, amount: n } : x))); }}
                className="input-plain fn-num h-9 w-28 text-right"
              />
              <button
                type="button"
                className="btn btn-plain btn-sm btn-icon text-[var(--text-muted)] max-md:h-11 max-md:w-11"
                onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                aria-label={`Remove ${s.name}`}
                title="Remove"
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); addPeople(); }}>
        <input
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder="Split with Andi, Budi"
          aria-label="Names to split with"
          className="field min-w-0 flex-[1_1_10rem] max-md:h-11"
        />
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-[var(--text-secondary)]">
          <button type="button" role="switch" aria-checked={includeMe} onClick={() => setIncludeMe((v) => !v)} className="switch" aria-label="Include me in the split" />
          Include me
        </label>
        <button className="btn btn-secondary max-md:h-11">Split equally</button>
      </form>

      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] pt-2.5 text-xs text-[var(--text-muted)]">
        <span className="fn-num">Others owe {formatMoney(owed, tx.currency)}</span>
        <span className="fn-num">
          Your share {formatMoney(myShare(tx, settings.currency), settings.currency)}
          {others > tx.amount && <span className="text-[var(--warning)]">, more than the total</span>}
        </span>
      </div>
    </div>
  );
}
