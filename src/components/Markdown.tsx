"use client";
// The Markdown models reply in, drawn as React elements (never as HTML, so nothing a
// reply contains can run): **bold**, *italic*, `code`, [links](https://…), headings,
// bullet and numbered lists. Tables and anything else stay as the text they are.
// Replies are model output and a note or a web page can steer it: only http(s) links open.
//
// With `cite`, source markers ([2]) become small numbered pills, and the sentence each
// one ends lights up with it (see components/assistant/cite.ts).
import { Fragment, type ReactNode } from "react";
import { segment, type Citations } from "./assistant/cite";

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*(?!\s)[^*]+?(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)[^_]+?(?<!\s)_(?![\w_]))/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (i % 2 === 0) return <Fragment key={k}>{part}</Fragment>;
    if (part.startsWith("**") || part.startsWith("__")) return <strong key={k} className="font-medium">{inline(part.slice(2, -2), k)}</strong>;
    if (part.startsWith("`")) return <code key={k} className="rounded bg-[var(--surface-muted)] px-1 py-px text-[0.92em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("[")) {
      const m = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (m && /^https?:\/\//i.test(m[2])) {
        return (
          <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" className="underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-[var(--foreground)]">
            {m[1]}
          </a>
        );
      }
      return <Fragment key={k}>{m ? m[1] : part}</Fragment>;
    }
    return <em key={k}>{inline(part.slice(1, -1), k)}</em>;
  });
}

/** How citation pills behave: which one is lit, and what hovering and clicking one does. */
export type CiteRender = {
  c: Citations;
  active: number | null;
  setActive: (n: number | null) => void;
  pick: (n: number) => void;
  titleOf: (n: number) => string;
};

function CitePill({ n, cite }: { n: number; cite: CiteRender }) {
  const on = cite.active === n;
  return (
    <button
      type="button"
      onMouseEnter={() => cite.setActive(n)}
      onMouseLeave={() => cite.setActive(null)}
      onFocus={() => cite.setActive(n)}
      onBlur={() => cite.setActive(null)}
      onClick={() => cite.pick(n)}
      aria-label={`Source ${n}: ${cite.titleOf(n)}`}
      // The visible pill is 18px; the hit area reaches 44px tall for fingers.
      className={`fn-num relative mx-[2px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] align-[2px] text-[12px] leading-none transition-colors before:absolute before:-inset-x-1 before:-inset-y-[13px] before:content-[''] ${
        on ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-[var(--foreground)]"
      }`}
    >
      {n}
    </button>
  );
}

/** A line of text: its citations as pills after the sentences they end. */
function line(text: string, key: string, cite?: CiteRender): ReactNode[] {
  if (!cite) return inline(text, key);
  return segment(text, cite.c).map((s, i) => {
    const k = `${key}-s${i}`;
    if (!s.cites) return <Fragment key={k}>{inline(s.text, k)}</Fragment>;
    const lit = cite.active != null && s.cites.includes(cite.active);
    return (
      <Fragment key={k}>
        <span className={`-mx-[2px] rounded-[4px] px-[2px] box-decoration-clone transition-colors ${lit ? "bg-[var(--accent-subtle)]" : ""}`}>{inline(s.text, k)}</span>
        {s.cites.map((n) => <CitePill key={n} n={n} cite={cite} />)}
      </Fragment>
    );
  });
}

type Block = { kind: "p" | "h" | "ul" | "ol"; lines: string[] };

export default function Markdown({ text, cite, className = "space-y-2" }: { text: string; cite?: CiteRender; className?: string }) {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trimEnd();
    const bullet = l.match(/^\s*[-*+•]\s+(.*)$/);
    const numbered = l.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = l.match(/^#{1,6}\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) last?.kind === "ul" ? last.lines.push(bullet[1]) : blocks.push({ kind: "ul", lines: [bullet[1]] });
    else if (numbered) last?.kind === "ol" ? last.lines.push(numbered[1]) : blocks.push({ kind: "ol", lines: [numbered[1]] });
    else if (heading) blocks.push({ kind: "h", lines: [heading[1]] });
    else if (!l.trim()) blocks.push({ kind: "p", lines: [] });
    else if (last?.kind === "p" && last.lines.length) last.lines.push(l);
    else blocks.push({ kind: "p", lines: [l] });
  }
  return (
    <div className={className}>
      {blocks.filter((b) => b.lines.length).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h") return <p key={k} className="font-medium">{line(b.lines[0], k, cite)}</p>;
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind === "ul" ? "ul" : "ol";
          return (
            <List key={k} className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}>
              {b.lines.map((l, j) => <li key={j}>{line(l, `${k}-${j}`, cite)}</li>)}
            </List>
          );
        }
        return <p key={k} className="whitespace-pre-wrap">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{line(l, `${k}-${j}`, cite)}</Fragment>)}</p>;
      })}
    </div>
  );
}
