"use client";
// Notes → Find notes that disagree: pairs of notes that state the same fact differently,
// each quote shown as it's written, with a way to open either note (see lib/conflicts.ts).
import { useEffect, useState } from "react";
import { dismissConflict, findConflicts, type Conflict } from "@/lib/conflicts";
import { openItem } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { Icon, Modal } from "../ui";

export default function Conflicts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notes } = useStore();
  const [state, setState] = useState<{ busy: boolean; pairs: number; conflicts: Conflict[]; error?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ busy: true, pairs: 0, conflicts: [] });
    findConflicts(notes)
      .then((r) => live && setState({ busy: false, ...r }))
      .catch((e) => live && setState({ busy: false, pairs: 0, conflicts: [], error: e instanceof Error ? e.message : "Couldn't check right now." }));
    return () => { live = false; };
    // Checked once each time it opens, not again on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const show = (id: string) => { onClose(); openItem("note", id); };
  const dismiss = (key: string) => {
    dismissConflict(key);
    setState((s) => s && { ...s, conflicts: s.conflicts.filter((c) => c.key !== key) });
  };

  return (
    <Modal open={open} onClose={onClose} title="Notes that disagree">
      <div className="flex flex-col gap-3 p-5">
        {!state || state.busy ? (
          <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
            <Icon name="sparkle" size={15} className="fn-dot text-[var(--accent)]" /> Comparing notes that cover the same things…
          </p>
        ) : state.error ? (
          <p className="text-sm text-[var(--danger)]">{state.error}</p>
        ) : state.conflicts.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">
            {state.pairs ? `Compared ${state.pairs} pairs of similar notes. Nothing contradicts.` : "No notes are alike enough to compare yet."}
          </p>
        ) : (
          <>
            <p className="text-[13px] text-[var(--text-muted)]">Which one is right? Open a note to fix it.</p>
            <ul className="flex flex-col gap-3">
              {state.conflicts.map((c) => (
                <li key={c.key} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--border)] p-3">
                  <p className="font-medium">{c.topic}</p>
                  {[c.a, c.b].map((side) => (
                    <div key={side.note.id} className="flex items-start gap-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-[var(--text-muted)]">{side.note.title || "Untitled"}</p>
                        <p className="break-words">“{side.quote}”</p>
                      </div>
                      <button className="btn btn-secondary btn-sm shrink-0 max-md:h-11" onClick={() => show(side.note.id)}>Open</button>
                    </div>
                  ))}
                  <button className="btn btn-plain btn-sm self-start max-md:h-11" onClick={() => dismiss(c.key)}>Not a conflict</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
