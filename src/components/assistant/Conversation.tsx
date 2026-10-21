"use client";
// The conversation in place of Today's overview, as the AI composer works once you send:
// the composer moves to the bottom and the thread fills the page, with the sidebar still
// beside it. A question reads as an answer page (the question as a heading, its sources,
// the answer, related questions); anything else you ask for is a bubble with the reply under it.
import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { answerOnly } from "@/lib/intent";
import { useAssistant, type UIMessage } from "../assistant";
import { relatedQuestions } from "./Answer";
import { plainAnswer } from "./cite";
import Composer, { type ComposerHandle } from "./Composer";
import { Glyph, type GlyphName } from "./icons";
import { ReplyActions, ReplyBody, Thinking, UserBubble, type ThreadHandlers } from "./Thread";

type Exchange = { q?: UIMessage; replies: UIMessage[] };

function BarButton({ icon, label, onClick, disabled }: { icon: GlyphName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] disabled:opacity-40 sm:h-9 sm:w-9">
      <Glyph name={icon} size={18} />
    </button>
  );
}

export default function Conversation({ handlers, composer, onSend, onBack, onNewThread }: {
  handlers: ThreadHandlers;
  composer: Ref<ComposerHandle>;
  onSend: (text: string) => void;
  /** Back to Today's overview; the conversation stays for later. */
  onBack: () => void;
  onNewThread: () => void;
}) {
  const { messages, busy, send } = useAssistant();
  const titleId = useId();
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
  const title = messages.find((m) => m.role === "user")?.content.split("\n")[0] ?? "New chat";
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant" && !m.error && !m.stopped);

  // A new exchange scrolls up to the top of the page, so its answer reads from the start;
  // the reply landing under it keeps it in view.
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
    <section aria-labelledby={titleId} className="fn-rise -mx-4 flex min-h-0 flex-1 flex-col md:-mx-8">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 md:px-4">
        <BarButton icon="back" label="Back to Today" onClick={onBack} />
        <h2 id={titleId} className="min-w-0 flex-1 truncate px-1 text-[14px] font-medium">{title}</h2>
        {canShare && lastReply && (
          <button type="button" onClick={share} className="btn btn-secondary btn-sm mr-1 max-sm:hidden">
            <Glyph name="share" size={16} /> Share
          </button>
        )}
        <BarButton icon="newChat" label="New chat" onClick={onNewThread} disabled={!messages.length || !!busy} />
      </div>

      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div role="log" aria-label="Conversation" aria-live="polite" className="mx-auto flex w-full max-w-[752px] flex-col gap-12 px-4 pb-10 pt-8 sm:px-6 md:pt-10">
          {exchanges.map((g, i) => {
            const last = i === exchanges.length - 1;
            const q = g.q;
            const asked = q ? answerOnly(q.content) : false;
            const answer = [...g.replies].reverse().find((r) => r.dataSources?.length && !r.error && !r.stopped);
            const related = last && !busy && answer ? relatedQuestions(answer.content, answer.dataSources) : [];
            return (
              <section key={q?.id ?? g.replies[0]?.id ?? i} data-exchange className="flex scroll-mt-6 flex-col gap-4">
                {q && asked ? (
                  <>
                    {q.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={q.imageUrl} alt="The photo you sent" className="max-h-56 self-start rounded-[14px] border border-[var(--border)] object-cover" />
                    )}
                    <h3 className={`fn-display whitespace-pre-wrap break-words ${q.content.length > 120 ? "text-[20px] leading-snug" : "text-[28px]"} ${q.queued ? "opacity-60" : ""}`}>
                      {q.content}
                    </h3>
                    {q.queued && <p className="text-[14px] text-[var(--text-muted)]">Waiting for a connection. It will be sent when you're back online.</p>}
                  </>
                ) : q ? (
                  <UserBubble m={q} />
                ) : null}
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

      <div className="no-print mx-auto w-full max-w-[752px] shrink-0 px-4 pb-4 sm:px-6 md:pb-6">
        <Composer handle={composer} placeholder="Ask a follow-up, or add a note, task or expense" onSend={onSend} />
      </div>
    </section>
  );
}
