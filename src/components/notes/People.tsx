"use client";
// Notes → People: everyone your notes mention, each with a page of what you know about
// them: facts from your notes, tasks that name them, chores you share, bills they owe.
// The notes are read for people only when you ask (see lib/people.ts).
import { useState } from "react";
import { fmtDateTime } from "@/lib/client";
import { openAssistant, openItem } from "@/lib/nav";
import { readPeople, unread, type Person } from "@/lib/people";
import { formatMoney, useStore } from "@/lib/store";
import { turnLabel } from "@/lib/tasks";
import { Icon, useToast } from "../ui";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function summary(p: Person, currency: string) {
  const open = p.tasks.filter((t) => !t.done).length;
  const owed = p.owes.reduce((s, o) => s + o.amount, 0);
  return [
    p.mentions.length ? plural(p.mentions.length, "note") : "",
    open ? plural(open, "task") : "",
    p.chores.length ? plural(p.chores.length, "chore") : "",
    owed ? `owes ${formatMoney(owed, p.owes[0]?.tx.currency ?? currency)}` : "",
  ].filter(Boolean).join(" · ");
}

/** The list pane: reading status, then everyone, most recently mentioned first. */
export function PeopleList({ people, selected, onOpen }: { people: Person[]; selected?: string; onOpen: (key: string) => void }) {
  const { notes, settings } = useStore();
  const toast = useToast();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const waiting = unread(notes).length;

  const read = async () => {
    setProgress({ done: 0, total: Math.min(waiting, 30) });
    try {
      await readPeople(notes, 30, (done, total) => setProgress({ done, total }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't read the notes right now.", "error");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {(waiting > 0 || progress) && (
        <div className="mx-1 mb-2 flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px]">
          <p className="text-[var(--text-secondary)]">
            {progress
              ? `Reading notes for people… ${progress.done} of ${progress.total}`
              : people.length
                ? `${plural(waiting, "note")} changed or not read yet.`
                : "The assistant reads your notes and lists who's in them and what you wrote about each person."}
          </p>
          {!progress && (
            <button className="btn btn-secondary btn-sm self-start max-md:h-11" onClick={read}>
              <Icon name="sparkle" size={14} className="text-[var(--accent)]" /> {people.length ? "Read them" : `Read ${plural(Math.min(waiting, 30), "note")}`}
            </button>
          )}
        </div>
      )}
      {people.length === 0 && !waiting && !progress && (
        <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">Nobody yet. People show up here once your notes mention them.</p>
      )}
      <ul className="flex flex-col gap-1">
        {people.map((p) => (
          <li key={p.key}>
            <button
              onClick={() => onOpen(p.key)}
              aria-current={selected === p.key ? "true" : undefined}
              className={`fn-press flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3.5 py-3 text-left transition-colors ${
                selected === p.key ? "bg-[var(--accent-subtle)]" : "hover:bg-[var(--hover)]"
              }`}
            >
              <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-sm font-medium">
                {p.name[0]?.toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{p.name}</span>
                <span className="truncate text-xs text-[var(--text-muted)]">{summary(p, settings.currency) || "Named in a bill or chore"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="group-label">{title}</h2>
      {children}
    </section>
  );
}

const ROW = "flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--hover)]";

/** One person's page, in place of the editor. */
export function PersonPage({ person, onBack }: { person: Person; onBack?: () => void }) {
  const { settings } = useStore();
  const facts = person.mentions.flatMap((m) => m.facts);
  return (
    <div className="note-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--background)]">
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 md:pl-5 md:pr-4">
        {onBack && (
          <button className="btn btn-plain h-11 gap-1 pl-2 pr-3 text-[var(--foreground)]" onClick={onBack} aria-label="Back to people">
            <Icon name="chevronLeft" size={20} /> People
          </button>
        )}
        <span className="flex-1" />
        <button className="btn btn-secondary max-md:h-11" onClick={() => openAssistant(`What do I know about ${person.name}?`)}>
          <Icon name="sparkle" size={15} /> Ask about {person.name.split(" ")[0]}
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[clamp(16px,4vw,40px)] pb-12 pt-8 md:pt-10 max-md:pb-[calc(var(--tabbar-space)+64px)]">
        <article className="fn-note-in mx-auto flex w-full max-w-[680px] flex-col gap-8">
          <header className="flex items-center gap-4">
            <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-2xl font-medium">{person.name[0]?.toUpperCase()}</span>
            <div className="min-w-0">
              <h1 className="fn-display truncate text-[30px] md:text-[36px]">{person.name}</h1>
              <p className="text-[13px] text-[var(--text-muted)]">{summary(person, settings.currency) || "Named in a bill or chore"}</p>
            </div>
          </header>

          {facts.length > 0 && (
            <Section title="What you know">
              <ul className="list-disc space-y-1 pl-5 text-[15px]">{[...new Set(facts)].slice(0, 12).map((f) => <li key={f}>{f}</li>)}</ul>
            </Section>
          )}

          {person.owes.length > 0 && (
            <Section title="Owes you">
              <ul className="flex flex-col">
                {person.owes.map(({ tx, amount }) => (
                  <li key={tx.id}>
                    <button className={ROW} onClick={() => openItem("transaction", tx.id)}>
                      <Icon name="finance" size={15} className="shrink-0 text-[var(--text-secondary)]" />
                      <span className="min-w-0 flex-1 truncate">{tx.merchant}</span>
                      <span className="fn-num text-[var(--text-secondary)]">{formatMoney(amount, tx.currency)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {person.tasks.length > 0 && (
            <Section title="Tasks">
              <ul className="flex flex-col">
                {person.tasks.slice(0, 12).map((t) => (
                  <li key={t.id}>
                    <button className={ROW} onClick={() => openItem("todo", t.id)}>
                      <Icon name={t.done ? "check" : "todo"} size={15} className="shrink-0 text-[var(--text-secondary)]" />
                      <span className={`min-w-0 flex-1 truncate ${t.done ? "text-[var(--text-muted)] line-through" : ""}`}>{t.title}</span>
                      {t.dueAt && !t.done && <span className="fn-num shrink-0 text-xs text-[var(--text-muted)]">{fmtDateTime(t.dueAt)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {person.chores.length > 0 && (
            <Section title="Takes turns with you">
              <ul className="flex flex-col">
                {person.chores.map((t) => (
                  <li key={t.id}>
                    <button className={ROW} onClick={() => openItem("todo", t.id)}>
                      <Icon name="users" size={15} className="shrink-0 text-[var(--text-secondary)]" />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.assignee && <span className="shrink-0 text-xs text-[var(--text-muted)]">{turnLabel(t.assignee, settings.name)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {person.mentions.length > 0 && (
            <Section title="In your notes">
              <ul className="flex flex-col gap-1">
                {person.mentions.map(({ note, facts: f }) => (
                  <li key={note.id}>
                    <button className={`${ROW} flex-col items-start gap-1`} onClick={() => openItem("note", note.id)}>
                      <span className="flex w-full items-center gap-2.5">
                        <Icon name="note" size={15} className="shrink-0 text-[var(--text-secondary)]" />
                        <span className="min-w-0 flex-1 truncate font-medium">{note.title || "Untitled"}</span>
                      </span>
                      {f.length > 0 && <span className="pl-[25px] text-[13px] text-[var(--text-secondary)]">{f.join(" · ")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </article>
      </div>
    </div>
  );
}
