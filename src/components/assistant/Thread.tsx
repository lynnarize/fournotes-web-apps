"use client";
// The conversation, drawn the same way in the panel and on the full page: your message
// in a bubble on the right; the reply unboxed, under a line naming the model, with what it
// filed as small cards and a row of quiet actions (copy, retry, save, undo…).
import { useEffect, useRef, useState } from "react";
import { useAiRoute } from "@/lib/aiRoute";
import { formatMoney, useStore, type AppData, type ChangeLink } from "@/lib/store";
import type { AnswerSource } from "@/lib/types";
import { canRetry, canSaveAsNote, useAssistant, type UIMessage } from "../assistant";
import { ModelMark } from "../ModelMenu";
import { useToast } from "../ui";
import Answer, { KindMark } from "./Answer";
import { plainAnswer } from "./cite";
import { Glyph, type GlyphName } from "./icons";

/** What clicking things in a reply does; the dock closes itself before going anywhere. */
export type ThreadHandlers = {
  jump: (link: ChangeLink, all: ChangeLink[]) => void;
  openSource: (s: AnswerSource) => void;
  split: (txId: string) => void;
};

const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === -1) return "yesterday";
  if (diff === 1) return "tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const dueLabel = (iso: string) => {
  const d = new Date(iso);
  const day = dayLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  const time = d.getHours() || d.getMinutes() ? `, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
  return `Due ${day}${time}`;
};

const listNames = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const FREQ: Record<string, string> = { DAILY: "Repeats daily", WEEKLY: "Repeats weekly", MONTHLY: "Repeats monthly", YEARLY: "Repeats yearly" };

type CardInfo = { icon: GlyphName | "quick"; head: string; title: string; detail?: string; gone: boolean };

/** What a filed item looks like as a card, read from the item itself where it still exists. */
function describe(label: string, link: ChangeLink, all: AppData): CardInfo {
  const text = label.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
  const m = text.match(/^([^:]{1,24}):\s*(.*)$/);
  const verb = m?.[1] ?? "";
  const rest = m?.[2] ?? text;
  const cur = all.settings.currency;
  if (!link) {
    const bill = /bill/i.test(verb);
    return { icon: bill ? "receipt" : "repeat", head: bill ? "Bill logged" : /next/i.test(verb) ? "Next one scheduled" : verb || "Done", title: rest, gone: false };
  }
  if (link.kind === "transactions") {
    const t = all.transactions.find((x) => x.id === link.id);
    const gone = !t || !!t.deletedAt;
    if (/^split/i.test(verb)) {
      const splits = t?.splits ?? [];
      const unpaid = splits.filter((s) => !s.settled).map((s) => s.name);
      return {
        icon: "users",
        head: "Split bill",
        title: splits[0] && t ? `${formatMoney(splits[0].amount, t.currency)} each` : rest,
        detail: splits.length ? (unpaid.length ? `${listNames(unpaid)} ${unpaid.length === 1 ? "hasn't" : "haven't"} paid` : "Everyone has paid back") : undefined,
        gone,
      };
    }
    if (!t) return { icon: "wallet", head: "Added to Finance", title: rest, gone: true };
    const ways = t.splits?.length ? `, split ${t.splits.length + 1} ways` : "";
    return {
      icon: "wallet",
      head: t.amount < 0 ? "Income added to Finance" : "Added to Finance",
      title: `${t.merchant}, ${formatMoney(Math.abs(t.amount), t.currency)}`,
      detail: `${t.category}, ${dayLabel(t.date)}${ways}`,
      gone,
    };
  }
  if (link.kind === "todos") {
    const t = all.todos.find((x) => x.id === link.id);
    const head = /^done/i.test(verb) ? "Marked done" : /^doing/i.test(verb) ? "In progress" : "Added to To-Do";
    if (!t) return { icon: "squareCheck", head, title: rest, gone: true };
    const freq = t.rrule?.match(/FREQ=(\w+)/i)?.[1]?.toUpperCase();
    return {
      icon: "squareCheck",
      head,
      title: t.title,
      detail: [t.dueAt ? dueLabel(t.dueAt) : "", freq ? FREQ[freq] ?? "" : "", t.bill ? formatMoney(t.bill.amount, t.bill.currency || cur) : ""].filter(Boolean).join(", ") || "No date",
      gone: !!t.deletedAt,
    };
  }
  if (link.kind === "notes") {
    const n = all.notes.find((x) => x.id === link.id);
    const quick = /quick/i.test(verb) || !!n?.tags.includes("quick");
    return { icon: quick ? "quick" : "fileText", head: quick ? "Quick note" : "Saved to Notes", title: n?.title || rest, gone: !n || !!n.deletedAt };
  }
  if (link.kind === "budget") {
    const limit = all.settings.budgets[link.id];
    return { icon: "target", head: "Budget set", title: limit ? `${link.id}, ${formatMoney(limit, cur)} a month` : link.id, gone: !limit };
  }
  return { icon: "check", head: verb || "Done", title: rest, gone: false };
}

function FiledCards({ m, onJump }: { m: UIMessage; onJump: ThreadHandlers["jump"] }) {
  const { all } = useStore();
  const links = m.links ?? [];
  return (
    <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
      {(m.filed ?? []).map((label, i) => {
        const link = links[i] ?? null;
        const c = describe(label, link, all);
        const can = !!link && !c.gone;
        const inner = (
          <>
            <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
              {c.icon === "quick" ? <KindMark kind="quick" /> : <Glyph name={c.icon} size={14} className="text-[var(--foreground)]" />}
              <span className="min-w-0 flex-1 truncate">{c.head}</span>
              {!c.gone && <Glyph name="check" size={14} className="text-[var(--success)]" />}
            </span>
            <span className={`fn-num line-clamp-2 text-[14px] font-medium ${c.gone ? "text-[var(--text-muted)] line-through" : "text-[var(--foreground)]"}`}>{c.title}</span>
            {(c.detail || c.gone) && <span className="text-[12px] text-[var(--text-muted)]">{c.gone ? "Removed" : c.detail}</span>}
          </>
        );
        const cls = "fn-pop flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-[var(--border-subtle)] px-3 pb-3 pt-[11px] text-left";
        return can ? (
          <button key={i} type="button" className={`${cls} transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-muted)]`} style={{ animationDelay: `${i * 60}ms` }} onClick={() => onJump(link, links)} title="Show it">
            {inner}
          </button>
        ) : (
          <div key={i} className={cls} style={{ animationDelay: `${i * 60}ms` }}>{inner}</div>
        );
      })}
    </div>
  );
}

function WebSources({ sources }: { sources: { title: string; url: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] text-[var(--text-muted)]">From the web</p>
      {sources.map((s) => {
        let host = "";
        try { host = new URL(s.url).host.replace(/^www\./, ""); } catch { /* keep empty */ }
        return (
          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.url} className="flex min-h-8 min-w-0 items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--foreground)]">
            <Glyph name="link" size={13} />
            <span className="truncate underline decoration-[var(--border-strong)] underline-offset-4">{s.title}</span>
            {host && <span className="shrink-0 text-[var(--text-muted)]">{host}</span>}
          </a>
        );
      })}
    </div>
  );
}

/** The reply's content: the answer (with its citations), what it filed, and any web pages. */
export function ReplyBody({ m, variant, handlers }: { m: UIMessage; variant: "compact" | "full"; handlers: ThreadHandlers }) {
  if (m.error) {
    return (
      <p className="flex gap-2 text-[16px] leading-6 text-[var(--danger)]">
        <Glyph name="warning" size={18} className="mt-[3px]" />
        <span className="min-w-0 break-words">{m.content}</span>
      </p>
    );
  }
  if (m.stopped) return <p className="text-[16px] leading-6 text-[var(--text-secondary)]">{m.content}</p>;
  return (
    <>
      <div className="min-w-0 break-words">
        <Answer text={m.content} sources={m.dataSources} variant={variant} onOpenSource={handlers.openSource} />
      </div>
      {!!m.filed?.length && <FiledCards m={m} onJump={handlers.jump} />}
      {!!m.sources?.length && <WebSources sources={m.sources} />}
    </>
  );
}

const ACTION = "flex h-8 shrink-0 items-center rounded-full text-[14px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] disabled:opacity-40";

/** The quiet row under a reply. The full page adds the model and how long it took, on the right. */
export function ReplyActions({ m, variant, handlers }: { m: UIMessage; variant: "compact" | "full"; handlers: ThreadHandlers }) {
  const { messages, busy, saveAsNote, retry, undo, searchWeb, openWebSearch } = useAssistant();
  const route = useAiRoute();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const full = variant === "full";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainAnswer(m.content, m.dataSources));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("The browser didn't allow copying. Select the text and copy it instead.", "error");
    }
  };

  const icon = (name: GlyphName, label: string, onClick: () => void, disabled?: boolean) => (
    <button key={label} type="button" className={`${ACTION} w-8 justify-center`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Glyph name={name} size={16} />
    </button>
  );
  const text = (name: GlyphName, label: string, onClick: () => void, opts: { title?: string; disabled?: boolean } = {}) => (
    <button key={label} type="button" className={`${ACTION} gap-1.5 px-2.5`} title={opts.title} onClick={onClick} disabled={opts.disabled}>
      <Glyph name={name} size={16} /> {label}
    </button>
  );

  const items = [];
  if (!m.error && !m.stopped && m.content.trim()) items.push(icon(copied ? "check" : "copy", copied ? "Copied" : "Copy reply", copy));
  if (canRetry(messages, m)) items.push(full ? icon("retry", "Retry", () => retry(m.id), !!busy) : text("retry", "Retry", () => retry(m.id), { disabled: !!busy }));
  if (canSaveAsNote(m)) items.push(full ? icon("filePlus", "Save as a note", () => saveAsNote(m.id)) : text("filePlus", "Save as note", () => saveAsNote(m.id), { title: "Save this reply to Notes exactly as it is" }));
  if (m.newItems?.length && !m.undone) {
    const n = m.newItems.length;
    items.push(text("undo", n === 1 ? "Undo" : n === 2 ? "Undo both" : "Undo all", () => undo(m.id), { title: "Remove what this reply added" }));
  }
  if (m.splitTxId) items.push(text("users", "Split this bill", () => handlers.split(m.splitTxId!)));
  if (m.webTopic && route.canSearchWeb) {
    items.push(text("lightbulb", "Ideas from the web", () => searchWeb(m.webTopic!), { title: "Search the web and suggest ideas here. Sends this note to Claude.", disabled: !!busy }));
  }
  if (m.webTopic) items.push(text("globe", "Search the web", () => openWebSearch(m.webTopic!), { title: `Open a search for “${m.webTopic.noteTitle}” in a new tab` }));

  const meta = full && m.model && (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[12px] text-[var(--text-muted)]">
      <ModelMark size={14} className="text-[var(--foreground)]" />
      {m.model}
      {m.ms != null && (
        <>
          <span aria-hidden>·</span>
          <span className="fn-num">{(m.ms / 1000).toFixed(1)}s</span>
        </>
      )}
    </span>
  );
  if (!items.length && !meta) return null;
  return <div className="-ml-1.5 flex flex-wrap items-center gap-0.5">{items}{meta}</div>;
}

/** The line above a reply: which model wrote it. */
export function ModelLine({ name }: { name: string }) {
  return (
    <p className="flex items-center gap-2 text-[14px] text-[var(--text-secondary)]">
      <ModelMark size={14} className="text-[var(--foreground)]" />
      {name}
    </p>
  );
}

export function UserBubble({ m }: { m: UIMessage }) {
  return (
    <div className="fn-rise flex flex-col items-end gap-2">
      {m.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.imageUrl} alt="The photo you sent" className="max-h-44 max-w-[85%] rounded-[14px] border border-[var(--border)] object-cover" />
      )}
      <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] bg-[var(--surface-muted)] px-4 py-2.5 text-[16px] leading-6 ${m.queued ? "opacity-60" : ""}`}>
        {m.content}
      </p>
      {m.queued && (
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <Glyph name="wifiOff" size={12} /> Waiting for a connection
        </span>
      )}
    </div>
  );
}

export function Reply({ m, handlers }: { m: UIMessage; handlers: ThreadHandlers }) {
  return (
    <article aria-label="Reply" className="fn-rise flex min-w-0 flex-col gap-2.5">
      {m.model && !m.error && !m.stopped && <ModelLine name={m.model} />}
      <ReplyBody m={m} variant="compact" handlers={handlers} />
      <ReplyActions m={m} variant="compact" handlers={handlers} />
    </article>
  );
}

/** A reply on its way: the status, with a calm light passing over it. */
export function Thinking({ label }: { label: string }) {
  return (
    <article aria-label="Reply in progress" aria-busy="true" className="fn-rise flex flex-col gap-2.5">
      <p className="flex items-center gap-2 text-[16px] leading-6 text-[var(--text-secondary)]" role="status">
        <ModelMark size={14} className="text-[var(--foreground)]" />
        <span className="fn-shimmer">{label.replace(/…$/, "")}</span>
      </p>
    </article>
  );
}

const STARTERS: { text: string; send: boolean }[] = [
  { text: "What did I spend the most on this month?", send: true },
  { text: "What's due this week?", send: true },
  { text: "Remind me to ", send: false },
];

/** The panel's conversation, scrolled to the newest message. */
export function Thread({ handlers, onStarter }: { handlers: ThreadHandlers; onStarter: (text: string, send: boolean) => void }) {
  const { messages, busy } = useAssistant();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);
  return (
    <div ref={listRef} role="log" aria-label="Conversation" aria-live="polite" className="scroll-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-3 pt-6">
      {!messages.length && !busy && (
        <div className="m-auto flex max-w-[320px] flex-col items-center gap-4 text-center">
          <p className="text-[14px] text-[var(--text-secondary)]">Ask about your notes, tasks and spending, or tell me what to add.</p>
          <div className="flex flex-col items-center gap-2">
            {STARTERS.map((s) => (
              <button key={s.text} type="button" className="pill" onClick={() => onStarter(s.text, s.send)}>
                {s.send ? s.text : "Remind me to…"}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} m={m} /> : <Reply key={m.id} m={m} handlers={handlers} />))}
      {busy && <Thinking label={busy} />}
    </div>
  );
}
