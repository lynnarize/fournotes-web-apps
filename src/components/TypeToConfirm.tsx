"use client";
// Confirmation for actions that permanently delete data: the button stays disabled
// until the user types the confirmation word, so it can't be done by a stray tap.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Modal } from "./ui";

export default function TypeToConfirm({ open, onClose, title, children, word = "delete", confirmLabel, onConfirm }: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What will be deleted and what is kept. */
  children: ReactNode;
  word?: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = typed.trim().toLowerCase() === word.toLowerCase();

  useEffect(() => {
    if (!open) return;
    setTyped("");
    setWorking(false);
    const t = setTimeout(() => inputRef.current?.focus(), 250); // after the open animation
    return () => clearTimeout(t);
  }, [open]);

  const confirm = async () => {
    if (!ready || working) return;
    setWorking(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !working && onClose()} title={title}>
      <form
        className="flex flex-col gap-4 p-5 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <div className="flex gap-3 rounded-[18px] bg-[var(--danger-subtle)] p-4">
          <Icon name="trash" size={18} className="mt-0.5 shrink-0 text-[var(--danger)]" />
          <div className="space-y-1.5 leading-relaxed">{children}</div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)]">
            Type <strong className="font-medium text-[var(--foreground)]">{word}</strong> to confirm
          </span>
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`Type ${word} to confirm`}
            className="field field-lg"
          />
        </label>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-plain max-md:h-11" onClick={onClose} disabled={working}>
            Cancel
          </button>
          <button type="submit" disabled={!ready || working} className="btn btn-danger-solid max-md:h-11">
            {working ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
