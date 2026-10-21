"use client";
// Category dropdown that can also create a new category on the spot.
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Modal, useToast } from "./ui";

const NEW = "__new__";

export default function CategorySelect({ value, onChange, className = "", ariaLabel = "Category", allowIncome = true }: {
  value: string;
  onChange: (category: string) => void;
  className?: string;
  ariaLabel?: string;
  allowIncome?: boolean;
}) {
  const { categories, addCategory } = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const options = categories.filter((c) => allowIncome || c !== "Income");
  if (value && !options.includes(value)) options.push(value); // keep a category that was removed

  const create = () => {
    const created = addCategory(name);
    if (!created) {
      toast("That category already exists, or the name is empty.", "error");
      return;
    }
    onChange(created);
    setName("");
    setAdding(false);
    toast(`🏷️ Category added: ${created}`);
  };

  return (
    <>
      <select
        value={value}
        aria-label={ariaLabel}
        className={className}
        onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}
      >
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value={NEW}>+ New category…</option>
      </select>

      <Modal open={adding} onClose={() => setAdding(false)} title="New category">
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => { e.preventDefault(); create(); }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] text-[var(--text-secondary)]">Category name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Pets, Travel, Kids"
              className="field text-sm text-[var(--foreground)] max-md:h-11"
            />
          </label>
          <p className="text-[13px] text-[var(--text-muted)]">It appears everywhere you pick a category, and you can give it a budget.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-plain" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!name.trim()}>Add</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
