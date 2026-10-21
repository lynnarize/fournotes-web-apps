"use client";
// The assistant over the whole window (the redesign's answer page): a slim bar with the
// thread's title, then a reading column where each question is a heading and its answer
// sits under it with its sources, and a follow-up box docked at the bottom.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAssistant, type UIMessage } from "../assistant";
import { relatedQuestions } from "./Answer";
import { plainAnswer } from "./cite";
import { SendButton } from "./Composer";
import { Glyph, type GlyphName } from "./icons";
import { ReplyActions, ReplyBody, Thinking, type ThreadHandlers } from "./Thread";

type Exchange = { q?: UIMessage; replies: UIMessage[] };

function BarButton({ icon, label, onClick, disabled }: { icon: GlyphName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] disabled:opacity-40 sm:h-9 sm:w-9">
      <Glyph name={icon} size={18} />
    </button>
  );
}

/** The follow-up box: one line that grows, and send (or stop). */
function FollowUp() {
  const { busy, canStop, send, stop } = useAssistant();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const max = 24 * 8 + 12;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);
  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    send(t);
  };
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex items-end gap-2 rounded-[26px] border border-[var(--border)] bg-[var(--surface)] py-[7px] pl-[18px] pr-[7px] transition-colors focus-within:border-[var(--border-strong)]"
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask a follow-up"
        aria-label="Ask a follow-up"
        className="input-plain min-h-9 min-w-0 flex-1 resize-none py-1.5 text-[16px] leading-6 placeholder:text-[var(--text-muted)] max-sm:py-2.5"
      />
      <SendButton empty={!text.trim()} busy={busy} canStop={canStop} onSend={submit} onStop={stop} />
    </form>
  );
}

export default function FullPage({ handlers, onShrink, onClose, onNewThread }: {
  handlers: ThreadHandlers;
  /** Back to the panel. */
  onShrink: () => void;
  /** Close the assistant altogether. */
  onClose: () => void;
  onNewThread: () => void;
}) {
  const { messages, busy, send } = useAssistant();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(typeof navigator.share === "function"); }, []);

  const exchanges = useMemo(() => {
    const out: Exchange[] = [];
    for (const m of messages) {
      if (m.role === "user") out.push({ q: m, replies: [] });
      else if (out.length) out[out.length - 1].replies.push(m);
      else out.push({ replies: [m] });
    }
    return out;
  }, [messages]);
  const title = messages.find((m) => m.role === "user")?.content.split("\n")[0] ?? "New thread";
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant" && !m.error && !m.stopped);

  // The page takes focus once, as it opens, so keys reach it; Escape goes back to the panel.
  const shrinkRef = useRef(onShrink);
  shrinkRef.current = onShrink;
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=menu], [role=dialog][aria-label='Split bill']")) return;
      shrinkRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A new question scrolls up to the top of the page, so its answer reads from the start.
  const count = exchanges.length;
  useEffect(() => {
    const sections = scrollRef.current?.querySelectorAll("[data-exchange]");
    const last = sections?.[sections.length - 1] as HTMLElement | undefined;
    last?.scrollIntoView({ block: "start", behavior: count > 1 ? "smooth" : "auto" });
  }, [count]);

  const share = async () => {
    if (!lastReply) return;
    try {
      await navigator.share({ title, text: `${title}\n\n${plainAnswer(lastReply.content, lastReply.dataSources)}` });
    } catch { /* cancelled */ }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="no-print fn-rise fixed inset-0 z-[49] flex flex-col bg-[var(--background)] outline-none"
    >
      <div className="shrink-0 border-b border-[var(--border-subtle)] pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center gap-1 pl-2 pr-2 sm:pl-3 sm:pr-4">
          <BarButton icon="newChat" label="New thread" onClick={onNewThread} disabled={!messages.length} />
          <h2 id={titleId} className="min-w-0 flex-1 truncate px-1 text-[14px] font-medium">{title}</h2>
          {canShare && lastReply && (
            <button type="button" onClick={share} className="btn btn-secondary btn-sm mr-1 max-sm:hidden">
              <Glyph name="share" size={16} /> Share
            </button>
          )}
          <BarButton icon="shrink" label="Back to the panel" onClick={onShrink} />
          <BarButton icon="x" label="Close the assistant" onClick={onClose} />
        </div>
      </div>

      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div role="log" aria-label="Conversation" aria-live="polite" className="mx-auto flex w-full max-w-[752px] flex-col gap-14 px-4 pb-10 pt-10 sm:px-6">
          {!messages.length && !busy && (
            <p className="text-[16px] text-[var(--text-secondary)]">Ask about your notes, tasks and spending, or tell me what to add.</p>
          )}
          {exchanges.map((g, i) => {
            const last = i === exchanges.length - 1;
            const answer = [...g.replies].reverse().find((r) => r.dataSources?.length && !r.error && !r.stopped);
            const related = last && !busy && answer ? relatedQuestions(answer.content, answer.dataSources) : [];
            const q = g.q;
            return (
              <section key={q?.id ?? g.replies[0]?.id ?? i} data-exchange className="flex scroll-mt-6 flex-col gap-4">
                {q?.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={q.imageUrl} alt="The photo you sent" className="max-h-56 self-start rounded-[14px] border border-[var(--border)] object-cover" />
                )}
                {q && (
                  <h3 className={`fn-display whitespace-pre-wrap break-words ${q.content.length > 120 ? "text-[20px] leading-snug" : "text-[28px]"} ${q.queued ? "opacity-60" : ""}`}>
                    {q.content}
                  </h3>
                )}
                {q?.queued && <p className="text-[14px] text-[var(--text-muted)]">Waiting for a connection. It will be sent when you're back online.</p>}
                {g.replies.map((r) => (
                  <article key={r.id} aria-label="Reply" className="fn-rise flex min-w-0 flex-col gap-4">
                    <ReplyBody m={r} variant="full" handlers={handlers} />
                    <ReplyActions m={r} variant="full" handlers={handlers} />
                  </article>
                ))}
                {last && busy && <Thinking label={busy} />}
                {related.length > 0 && (
                  <nav aria-label="Related questions" className="mt-6 flex flex-col">
                    <h4 className="mb-3 text-[14px] font-medium">Related</h4>
                    <ul>
                      {related.map((text) => (
                        <li key={text} className="border-t border-[var(--border-subtle)] last:border-b">
                          <button type="button" onClick={() => send(text)} className="flex min-h-[49px] w-full items-center gap-3 text-left text-[16px] transition-colors hover:text-[var(--text-secondary)]">
                            <span className="flex-1">{text}</span>
                            <Glyph name="arrowRight" size={16} className="text-[var(--text-muted)]" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
              </section>
            );
          })}
          {!exchanges.length && busy && <Thinking label={busy} />}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[752px] shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] sm:px-6 sm:pb-6">
        <FollowUp />
      </div>
    </div>
  );
}
