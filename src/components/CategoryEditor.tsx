"use client";
// Finance → settings (gear) → Categories: add your own spending categories, remove the ones you added.
import { useMemo, useState } from "react";
import { alive, useStore } from "@/lib/store";
import { EXPENSE_CATEGORIES } from "@/lib/types";
import { Icon, useToast } from "./ui";

export default function CategoryEditor() {
  const { categories, addCategory, removeCategory, transactions } = useStore();
  const toast = useToast();
  const [name, setName] = useState("");

  const used = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of alive(transactions)) counts[t.category] = (counts[t.category] ?? 0) + 1;
    return counts;
  }, [transactions]);

  const builtIn = new Set<string>(EXPENSE_CATEGORIES);

  const add = () => {
    const created = addCategory(name);
    if (!created) return toast("That category already exists, or the name is empty.", "error");
    setName("");
    toast(`🏷️ Category added: ${created}`);
  };

  const remove = (category: string) => {
    const count = used[category] ?? 0;
    const message = count
      ? `Remove “${category}”? ${count} transaction${count === 1 ? "" : "s"} already use it and will keep the name, but you won't be able to pick it again.`
      : `Remove “${category}”?`;
    if (!window.confirm(message)) return;
    removeCategory(category);
    toast(`Category removed: ${category}`);
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Categories are used for spending, budgets and reports. The built-in ones can&apos;t be removed; your own can.
      </p>

      <ul className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <li key={c} className={`inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--surface-muted)] text-[13px] text-[var(--text-secondary)] ${builtIn.has(c) ? "px-3" : "pl-3 pr-1"}`}>
            {c}
            {used[c] ? <span className="fn-num text-[var(--text-muted)]">{used[c]}</span> : null}
            {!builtIn.has(c) && (
              <button
                className="relative grid h-6 w-6 place-items-center rounded-full text-[var(--text-muted)] before:absolute before:-inset-2 hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
                onClick={() => remove(c)}
                aria-label={`Remove ${c}`}
                title="Remove"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="New category, like Pets"
          aria-label="New category name"
          className="field min-w-0 flex-1 max-md:h-11"
        />
        <button className="btn btn-secondary max-md:h-11" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
