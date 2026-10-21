"use client";
// To-Do: tasks that keep slipping (pushed back 3 times, or a week overdue). For each, the
// assistant offers a first step small enough to start now, or a split into smaller
// tasks; or you drop it on purpose, or set it aside for a week. See lib/tasks.ts.
import { useState } from "react";
import { api, localIso } from "@/lib/client";
import { openItem } from "@/lib/nav";
import { stuckTasks } from "@/lib/tasks";
import { alive, useStore } from "@/lib/store";
import type { AgentOutput } from "@/lib/ai/agent";
import type { Todo } from "@/lib/types";
import { Icon, useToast } from "./ui";

const DAY = 86_400_000;
const later = (days: number) => new Date(Date.now() + days * DAY).toISOString();

export default function StuckTasks({ now }: { now: Date }) {
  const { todos } = useStore();
  const [open, setOpen] = useState(false);
  const stuck = stuckTasks(alive(todos), now.getTime());
  if (!stuck.length) return null;
  return (
    <section aria-label="Stuck tasks" className="mb-4 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-3 py-2 pl-4 pr-3 text-left text-sm"
      >
        <Icon name="repeat" size={16} className="shrink-0 text-[var(--warning)]" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{stuck.length === 1 ? "1 task keeps slipping" : `${stuck.length} tasks keep slipping`}</span>
          <span className="text-[var(--text-muted)]"> · get it moving, or let it go</span>
        </span>
        <Icon name="chevronDown" size={16} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="flex flex-col border-t border-[var(--border-subtle)]">
          {stuck.map(({ todo, why }) => <StuckRow key={todo.id} todo={todo} why={why} />)}
        </ul>
      )}
    </section>
  );
}

function StuckRow({ todo, why }: { todo: Todo; why: string }) {
  const { addTodo, updateTodo, remove } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<AgentOutput<"unstick"> | null>(null);
  const title = todo.title || "Untitled task";

  const ask = async () => {
    setBusy(true);
    try {
      const out = await api.agent("unstick", { title, notes: todo.notes, why, now: localIso() });
      setHelp({ hard: out.hard.trim(), firstStep: out.firstStep.trim().slice(0, 160), steps: out.steps.map((s) => s.trim().slice(0, 160)).filter(Boolean).slice(0, 5) });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The assistant couldn't help with this one right now.", "error");
    } finally {
      setBusy(false);
    }
  };

  const startSmall = () => {
    if (!help) return;
    const step = addTodo({ title: help.firstStep, doing: true, priority: todo.priority, noteId: todo.noteId ?? null, source: "chat" });
    // The big task rests for a few days while the first step gets done.
    updateTodo(todo.id, { stuckUntil: later(3), postponed: null });
    toast(`▶️ Doing: ${help.firstStep}`, "ok", {
      label: "Undo",
      run: () => { remove("todos", step.id); updateTodo(todo.id, { stuckUntil: todo.stuckUntil ?? null, postponed: todo.postponed ?? null }); },
    });
    openItem("todo", step.id);
  };

  const split = () => {
    if (!help?.steps.length) return;
    const made = help.steps.map((s) => addTodo({ title: s, priority: todo.priority, noteId: todo.noteId ?? null, source: "chat" }));
    remove("todos", todo.id);
    toast(`Split “${title}” into ${made.length} tasks`, "ok", {
      label: "Undo",
      run: () => { for (const m of made) remove("todos", m.id); updateTodo(todo.id, { deletedAt: null }); },
    });
  };

  const drop = () => {
    remove("todos", todo.id);
    toast(`Dropped “${title}”. One less thing.`, "ok", { label: "Undo", run: () => updateTodo(todo.id, { deletedAt: null }) });
  };

  const notNow = () => {
    updateTodo(todo.id, { stuckUntil: later(7) });
    toast("Set aside for a week.");
  };

  return (
    <li className="flex flex-col gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button className="min-w-0 flex-1 basis-48 text-left" onClick={() => openItem("todo", todo.id)}>
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="text-xs text-[var(--text-muted)]">{why}</span>
        </button>
        <div className="flex flex-wrap gap-1.5">
          {!help && (
            <button className="btn btn-secondary btn-sm max-md:h-11" onClick={ask} disabled={busy}>
              {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" /> : <Icon name="sparkle" size={14} className="text-[var(--accent)]" />}
              Help me start
            </button>
          )}
          <button className="btn btn-plain btn-sm max-md:h-11" onClick={notNow}>Not now</button>
          <button className="btn btn-plain btn-sm max-md:h-11 hover:!text-[var(--danger)]" onClick={drop}>Drop it</button>
        </div>
      </div>
      {help && (
        <div className="fn-rise flex flex-col gap-3 rounded-[14px] bg-[var(--surface-muted)] p-3 text-sm">
          {help.hard && <p className="text-[13px] text-[var(--text-secondary)]">{help.hard}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 basis-48"><span className="text-[var(--text-muted)]">First step: </span>{help.firstStep}</span>
            <button className="btn btn-primary btn-sm max-md:h-11" onClick={startSmall}>Start with this</button>
          </div>
          {help.steps.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[var(--text-muted)]">Or split it:</span>
              <ul className="list-disc pl-5 text-[13px]">
                {help.steps.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <button className="btn btn-secondary btn-sm self-start max-md:h-11" onClick={split}>Split into {help.steps.length} tasks</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
