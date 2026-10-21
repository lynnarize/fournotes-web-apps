"use client";
// Monthly budget per category, with this month's spending for context.
// Used in Finance → "Set budgets" and in Settings.
import { useMemo } from "react";
import { spendByCategory } from "@/lib/insights";
import { alive, formatMoney, localMonth, parseAmount, useStore } from "@/lib/store";

export default function BudgetEditor() {
  const { settings, setBudget, transactions, categories } = useStore();
  const budgetable = categories.filter((c) => c !== "Income");
  const cur = settings.currency;
  const month = localMonth();
  const spent = useMemo(
    () => spendByCategory(alive(transactions).filter((t) => t.date.startsWith(month)), cur),
    [transactions, month, cur],
  );
  const total = budgetable.reduce((s, c) => s + (settings.budgets[c] ?? 0), 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Set a monthly limit for each category in {cur}. Type amounts like <span className="font-medium text-[var(--foreground)]">1.5M</span> or{" "}
        <span className="font-medium text-[var(--foreground)]">600k</span>. Leave a field empty for no budget.
      </p>
      <ul className="flex flex-col">
        {budgetable.map((c, i) => {
          const limit = settings.budgets[c] ?? 0;
          const used = spent[c] ?? 0;
          const ratio = limit ? used / limit : 0;
          const tone = ratio >= 1 ? "danger" : ratio >= 0.8 ? "warning" : undefined;
          return (
            <li key={c} className={`flex items-center gap-3 py-3 ${i ? "border-t border-[var(--border-subtle)]" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate">{c}</div>
                <div className={`fn-num text-xs ${tone === "danger" ? "text-[var(--danger)]" : tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-muted)]"}`}>
                  {formatMoney(used, cur, true)} spent this month{limit ? `, ${Math.round(ratio * 100)}% of the budget${tone === "danger" ? " (over)" : ""}` : ""}
                </div>
                {limit > 0 && (
                  <div
                    role="meter"
                    aria-label={`${c} budget used`}
                    aria-valuemin={0}
                    aria-valuemax={limit}
                    aria-valuenow={Math.min(used, limit)}
                    className="meter mt-2"
                    data-tone={tone}
                  >
                    <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                  </div>
                )}
              </div>
              <input
                key={`${c}-${limit}`}
                defaultValue={limit || ""}
                placeholder="No budget"
                inputMode="decimal"
                aria-label={`${c} monthly budget`}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  const amount = value ? parseAmount(value) : null;
                  if ((amount ?? 0) !== limit) setBudget(c, amount);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="field fn-num w-28 shrink-0 text-right sm:w-32 max-md:h-11"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
        <span className="text-[var(--text-secondary)]">Total monthly budget</span>
        <span className="fn-num font-medium">{formatMoney(total, cur)}</span>
      </div>
    </div>
  );
}
