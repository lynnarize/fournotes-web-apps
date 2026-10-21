"use client";
// An answer that cites the user's own items (Arc's ai-answer): "N sources" opens a grid of
// source cards, and each [n] in the text is a small pill. Pointing at a pill (or a card)
// lights the sentence it ends and its card together; clicking a pill shows its card, and
// clicking a card opens the item in the app.
import { useId, useMemo, useState } from "react";
import type { AnswerSource, SourceKind } from "@/lib/types";
import Markdown, { type CiteRender } from "../Markdown";
import { citations, sourceLabel, type Cited } from "./cite";
import { Glyph, type GlyphName } from "./icons";

const KIND_ICON: Record<Exclude<SourceKind, "quick">, GlyphName> = {
  note: "fileText",
  todo: "squareCheck",
  transaction: "wallet",
  budget: "target",
};

/** A source kind's small mark: a line icon, or a quick note's yellow dot. */
export function KindMark({ kind, size = 14 }: { kind: SourceKind; size?: number }) {
  if (kind === "quick") {
    return (
      <span aria-hidden className="grid shrink-0 place-items-center" style={{ width: size, height: size }}>
        <span className="h-2 w-2 rounded-full bg-[var(--note-yellow)]" />
      </span>
    );
  }
  return <Glyph name={KIND_ICON[kind]} size={size} className="text-[var(--foreground)]" />;
}

/** "3 sources", with one stacked mark per kind of item among them. */
function SourcesToggle({ list, open, onToggle, controls, ring }: { list: Cited[]; open: boolean; onToggle: () => void; controls: string; ring: string }) {
  const kinds = [...new Set(list.map((s) => s.kind))].slice(0, 3);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="-ml-2.5 flex h-[34px] items-center gap-2 self-start rounded-full pl-2.5 pr-2 text-[14px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
    >
      <span className="flex" aria-hidden>
        {kinds.map((k, i) => (
          <span
            key={k}
            className={`grid h-5 w-5 place-items-center rounded-full border-2 ${ring} ${i ? "-ml-1.5" : ""} ${k === "quick" ? "bg-[var(--note-yellow)]" : "bg-[var(--surface-muted)] text-[var(--foreground)]"}`}
          >
            {k !== "quick" && <Glyph name={KIND_ICON[k]} size={11} />}
          </span>
        ))}
      </span>
      {list.length === 1 ? "1 source" : `${list.length} sources`}
      <Glyph name="chevronDown" size={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function SourceCard({ s, id, lit, setActive, onOpen }: { s: Cited; id: string; lit: boolean; setActive: (n: number | null) => void; onOpen: () => void }) {
  return (
    <button
      id={id}
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setActive(s.shown)}
      onMouseLeave={() => setActive(null)}
      onFocus={() => setActive(s.shown)}
      onBlur={() => setActive(null)}
      aria-label={`Open source ${s.shown}: ${s.title}, ${sourceLabel(s)}`}
      className={`flex min-w-0 flex-col gap-1.5 rounded-[14px] border px-3 pb-3 pt-[11px] text-left transition-colors ${
        lit ? "border-[var(--border-strong)] bg-[var(--surface-muted)]" : "border-[var(--border-subtle)] bg-[var(--surface)] hover:border-[var(--border)]"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
        <KindMark kind={s.kind} />
        <span className="min-w-0 flex-1 truncate">{sourceLabel(s)}</span>
        <span className="fn-num">{s.shown}</span>
      </span>
      <span className="line-clamp-2 text-[14px] font-medium text-[var(--foreground)]">{s.title}</span>
    </button>
  );
}

/**
 * The reply's text with its citations. `compact` (the panel): text first, sources folded
 * under it. `full` (the full page): sources first and open, then the text, a little roomier.
 */
export default function Answer({ text, sources, variant, onOpenSource }: {
  text: string;
  sources?: AnswerSource[];
  variant: "compact" | "full";
  onOpenSource: (s: AnswerSource) => void;
}) {
  const c = useMemo(() => citations(text, sources), [text, sources]);
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);
  const [open, setOpen] = useState(variant === "full");
  const full = variant === "full";
  const gridId = `${uid}-sources`;
  const cardId = (n: number) => `${uid}-src-${n}`;

  const cite: CiteRender | undefined = c.checked
    ? {
        c,
        active,
        setActive,
        titleOf: (n) => c.list[n - 1]?.title ?? "",
        pick: (n) => {
          setOpen(true);
          // The card exists once the grid is open: bring it into view and onto it.
          requestAnimationFrame(() => {
            const card = document.getElementById(cardId(n));
            card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            card?.focus({ preventScroll: true });
          });
        },
      }
    : undefined;

  const body = (
    <Markdown
      text={text}
      cite={cite}
      className={full ? "space-y-4 text-[16px] leading-[25.6px]" : "space-y-2 text-[16px] leading-6"}
    />
  );
  if (!c.list.length) return body;

  const sourcesBlock = (
    <div className="flex flex-col gap-1">
      <SourcesToggle list={c.list} open={open} onToggle={() => setOpen((o) => !o)} controls={gridId} ring={full ? "border-[var(--background)]" : "border-[var(--surface)]"} />
      <div
        id={gridId}
        className={`${open ? "grid" : "hidden"} gap-2 ${full ? "grid-cols-[repeat(auto-fit,minmax(240px,1fr))]" : "grid-cols-1 min-[480px]:grid-cols-2"}`}
      >
        {c.list.map((s) => (
          <SourceCard key={s.n} s={s} id={cardId(s.shown)} lit={active === s.shown} setActive={setActive} onOpen={() => onOpenSource(s)} />
        ))}
      </div>
    </div>
  );

  return full ? (
    <div className="flex flex-col gap-4">
      {sourcesBlock}
      <div className="mt-3">{body}</div>
    </div>
  ) : (
    <div className="flex flex-col gap-2.5">
      {body}
      {sourcesBlock}
    </div>
  );
}

/** Follow-ups that fit the kinds of items an answer cited: fixed wording, nothing made up. */
const FOLLOW_UPS: Record<SourceKind, string[]> = {
  transaction: ["How does this compare with last month?", "Which category did I spend the most on this month?"],
  budget: ["How much of my budgets is left this month?"],
  todo: ["What else is due this week?", "Which tasks are overdue?"],
  note: ["What else have I written about this?"],
  quick: ["What else have I written about this?"],
};

export function relatedQuestions(text: string, sources?: AnswerSource[], max = 3) {
  const { list } = citations(text, sources);
  const out: string[] = [];
  for (const kind of [...new Set(list.map((s) => s.kind))]) {
    for (const q of FOLLOW_UPS[kind]) if (!out.includes(q)) out.push(q);
  }
  return out.slice(0, max);
}
