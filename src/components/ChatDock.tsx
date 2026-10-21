"use client";
// Where the assistant lives on screen:
//   hero       Today's composer, under the greeting (docked above the tab bar on phones), with a
//              few suggestions. Sending turns it, in place, into a chat card, as Arc's AI composer
//              does: your message lifts into a bubble, the reply streams in under it, and the
//              composer glides to the card's foot. The sidebar and Today's other cards stay.
//   minimized  Every other tab: an "Ask Four Notes" pill in the corner that opens the same chat
//              as a panel (a sheet on phones). "Open on Today" moves it into Today's card.
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useBackDismiss } from "@/lib/backstack";
import { markFiled } from "@/lib/highlight";
import { useMedia } from "@/lib/hooks";
import { openItem, openTab, showChange, useOpenAssistant, type FocusKind } from "@/lib/nav";
import type { ChangeLink } from "@/lib/store";
import type { AnswerSource, SourceKind } from "@/lib/types";
import { useAssistant } from "./assistant";
import Composer, { BusyRing, type ComposerHandle } from "./assistant/Composer";
import { Glyph, type GlyphName } from "./assistant/icons";
import { Thread, type ThreadHandlers } from "./assistant/Thread";
import { ModelMark } from "./ModelMenu";
import SplitEditor from "./SplitEditor";
import { Modal } from "./ui";

/** The hints about / and @ only fit on one line from md up; phones get the short form. */
const PLACEHOLDER = { wide: "Ask anything, / for commands, @ to add a note", phone: "Ask anything" };
const FOLLOW_UP = { wide: "Ask a follow-up, / for commands, @ to add a note", phone: "Ask a follow-up" };
/**
 * Phones: just above the tab bar. The shell sets --tabbar-space on .app-root (the bar's
 * height, safe area included; 0 from md up), so nothing here adds the safe area again.
 */
const ABOVE_TABBAR = "bottom-[calc(var(--tabbar-space,0px)+10px)]";

/** Things to start with on Today: two fill in the start of a request, one asks right away. */
const STARTERS: { icon: GlyphName; title: string; text: string; send?: boolean }[] = [
  { icon: "pen", title: "Write a note", text: "Write a note about " },
  { icon: "receipt", title: "Log spending", text: "Spent " },
  { icon: "calendarCheck", title: "Plan my day", text: "What should I focus on today?", send: true },
];

const OPEN_AS: Record<SourceKind, FocusKind> = { note: "note", quick: "note", todo: "todo", transaction: "transaction", budget: "budget" };

function HeaderButton({ icon, label, onClick, disabled }: { icon: GlyphName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] disabled:opacity-40 md:h-9 md:w-9">
      <Glyph name={icon} size={18} />
    </button>
  );
}

/**
 * A change of layout that should glide (the composer moving from the middle of Today to the
 * foot of the chat card): a view transition where the browser has one, otherwise at once.
 */
function glide(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    doc.startViewTransition(() => flushSync(update));
  } else update();
}

export default function ChatDock({ minimized = false, hero = false }: { minimized?: boolean; hero?: boolean }) {
  const { messages, busy, recording, voice, queued, send, clear, todayChat, setTodayChat } = useAssistant();
  /** The panel (the thread and a composer) is showing. */
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [splitTx, setSplitTx] = useState<string | null>(null);
  /** Today's composer: in the middle of the page, or at the foot of the chat card. */
  const pageRef = useRef<ComposerHandle>(null);
  const cardEl = useRef<HTMLElement>(null);
  const panelRef = useRef<ComposerHandle>(null);
  const heroEl = useRef<HTMLDivElement>(null);
  const panelEl = useRef<HTMLElement>(null);
  const titleId = useId();
  const fit = useMedia("(max-width: 767px)") ? "phone" : "wide";

  const reveal = (focus = false) => {
    setOpen(true);
    setUnread(false);
    if (focus) setTimeout(() => panelRef.current?.focus(), 80);
  };

  // Back closes the panel; on Today it folds the chat card back into the composer.
  useBackDismiss(open, () => setOpen(false));
  useBackDismiss(hero && todayChat, () => setTodayChat(false));

  // The card just opened on Today: bring it into view, and the cursor into its composer.
  const chatting = hero && todayChat;
  useEffect(() => {
    if (!chatting) return;
    cardEl.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatting]);

  // New messages: on Today, the chat card opens (a scan or a recording started from the
  // sidebar lands there too). On other tabs, show the panel, or, for a reply that arrives
  // while it's folded away, only mark the pill.
  const seen = useRef(messages.length);
  useEffect(() => {
    if (messages.length > seen.current) {
      const last = messages[messages.length - 1];
      if (hero) setTodayChat(true);
      else if (minimized) {
        if (open || last?.role === "user") reveal();
        else setUnread(true);
      }
    }
    seen.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Recording and voice mode show their live status in a composer, so one has to be in view.
  useEffect(() => {
    if (minimized && (recording || voice !== "off")) reveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, voice]);

  // "Ask the assistant…" from elsewhere: the request is filled in, not sent. It's the user's to finish.
  useOpenAssistant((prefill) => {
    if (hero) {
      if (prefill !== undefined) pageRef.current?.fill(prefill);
      else pageRef.current?.focus();
      return;
    }
    reveal();
    setTimeout(() => (prefill !== undefined ? panelRef.current?.fill(prefill) : panelRef.current?.focus()), 80);
  });

  // "/" anywhere outside a text field puts the cursor in the assistant.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      e.preventDefault();
      if (hero) pageRef.current?.focus();
      else reveal(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero]);

  // A click elsewhere folds the panel away (the click still goes where it was aimed). Menus and
  // dialogs it opens live elsewhere in the page and aren't "elsewhere".
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (panelEl.current?.contains(t) || heroEl.current?.contains(t) || t.closest?.("[role=menu], [role=dialog]")) return;
      if (recording || voice !== "off") return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, recording, voice]);

  // Going to something in the app folds the panel away, so the item isn't hidden behind it.
  // On Today the conversation stays where it is, for when you come back.
  const handlers: ThreadHandlers = {
    jump: (link: ChangeLink, all: ChangeLink[]) => {
      if (!link) return;
      markFiled(all.filter((l): l is NonNullable<ChangeLink> => Boolean(l)).map((l) => l.id));
      setOpen(false);
      showChange(link);
    },
    openSource: (s: AnswerSource) => {
      setOpen(false);
      openItem(OPEN_AS[s.kind], s.id);
    },
    split: setSplitTx,
  };

  const submit = (text: string) => {
    // On Today the first message opens the chat card, the composer gliding to its foot.
    if (hero && !todayChat) glide(() => { setTodayChat(true); send(text); });
    else send(text);
  };
  const starter = (text: string, now: boolean) => {
    if (now) return submit(text);
    panelRef.current?.fill(text);
  };
  /** The panel's conversation, moved into Today's chat card. */
  const openOnToday = () => {
    setOpen(false);
    setTodayChat(true);
    openTab("today");
  };

  const splitModal = (
    <Modal open={!!splitTx} onClose={() => setSplitTx(null)} title="Split bill">
      <div className="p-4">{splitTx && <SplitEditor txId={splitTx} />}</div>
    </Modal>
  );

  if (hero) {
    const title = messages.find((m) => m.role === "user")?.content.split("\n")[0] ?? "New chat";
    if (todayChat) {
      return (
        <>
          <section
            ref={cardEl}
            aria-labelledby={titleId}
            style={{ viewTransitionName: "fn-chat-card" }}
            className="no-print fn-card-in flex h-[min(680px,calc(100dvh-210px))] min-h-[440px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] max-md:h-[calc(100dvh-var(--tabbar-space,0px)-170px)] max-md:min-h-[380px] max-md:scroll-mb-3"
          >
            <header className="flex h-14 shrink-0 items-center gap-0.5 border-b border-[var(--border-subtle)] pl-[18px] pr-2.5">
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-[14px] font-medium">{title}</h2>
              {queued > 0 && (
                <span className="badge mr-1">
                  <Glyph name="wifiOff" size={12} /> {queued} queued
                </span>
              )}
              <HeaderButton
                icon="newChat"
                label="New chat"
                disabled={!!busy}
                onClick={() => glide(() => { clear(); setTodayChat(false); })}
              />
              <HeaderButton icon="x" label="Close the chat" onClick={() => glide(() => setTodayChat(false))} />
            </header>
            <Thread handlers={handlers} onStarter={starter} />
            <div className="shrink-0 px-3 pb-3 pt-1" style={{ viewTransitionName: "fn-composer" }}>
              <Composer handle={pageRef} placeholder={FOLLOW_UP[fit]} onSend={submit} />
            </div>
          </section>
          {splitModal}
        </>
      );
    }
    const resume = messages.length > 0;
    const reopen = () => glide(() => setTodayChat(true));
    return (
      <>
        {/* Phones: docked above the tab bar. Larger screens: in the page, under the greeting. */}
        <div ref={heroEl} className={`no-print fixed inset-x-3 z-[36] md:static md:z-auto ${ABOVE_TABBAR}`}>
          {resume && (
            <button type="button" onClick={reopen} className="pill pill-sm mb-2 bg-[var(--surface)] shadow-[var(--shadow-floating)] md:hidden">
              <Glyph name="message" size={16} /> Back to the conversation
            </button>
          )}
          <div style={{ viewTransitionName: "fn-composer" }}>
            <Composer handle={pageRef} placeholder={PLACEHOLDER[fit]} onSend={submit} className="shadow-[var(--shadow-floating)] md:shadow-none" />
          </div>
        </div>
        <div role="group" aria-label="Suggestions" className="no-print hidden flex-wrap gap-2 md:flex">
          {STARTERS.map((s) => (
            <button
              key={s.title}
              type="button"
              className="pill disabled:opacity-50"
              disabled={!!busy && s.send}
              onClick={() => (s.send ? submit(s.text) : pageRef.current?.fill(s.text))}
            >
              <Glyph name={s.icon} size={16} /> {s.title}
            </button>
          ))}
          {resume && (
            <button type="button" className="pill" onClick={reopen}>
              <Glyph name="message" size={16} /> Back to the conversation
            </button>
          )}
        </div>
        {splitModal}
      </>
    );
  }

  const panel = open && (
    <>
      {/* Phones: the sheet dims the page behind it. */}
      <div className="fn-backdrop no-print fixed inset-x-0 top-0 bottom-[var(--tabbar-space,0px)] z-[46] bg-black/30 md:hidden" data-state="open" onClick={() => setOpen(false)} aria-hidden />
      <section
        ref={panelEl}
        role="dialog"
        aria-labelledby={titleId}
        data-state="open"
        onKeyDown={(e) => { if (e.key === "Escape" && !document.querySelector("[role=menu]")) setOpen(false); }}
        className={`no-print fn-sheet fn-corner fixed inset-x-2 z-[47] flex h-[min(880px,calc(100dvh-var(--tabbar-space,0px)-72px))] flex-col overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-floating)] md:inset-x-auto md:bottom-5 md:right-6 md:h-[min(880px,calc(100dvh-40px))] md:w-[440px] ${ABOVE_TABBAR}`}
      >
        <header className="flex h-14 shrink-0 items-center gap-0.5 border-b border-[var(--border-subtle)] pl-[18px] pr-2.5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[14px] font-medium">Assistant</h2>
          {queued > 0 && (
            <span className="badge mr-1">
              <Glyph name="wifiOff" size={12} /> {queued} queued
            </span>
          )}
          <HeaderButton icon="newChat" label="New chat" onClick={clear} disabled={!messages.length || !!busy} />
          <HeaderButton icon="expand" label="Open on Today" onClick={openOnToday} />
          <HeaderButton icon="x" label="Close the assistant" onClick={() => setOpen(false)} />
        </header>
        <Thread handlers={handlers} onStarter={starter} />
        <div className="shrink-0 px-3 pb-3 pt-1">
          <Composer handle={panelRef} placeholder={PLACEHOLDER[fit]} onSend={submit} />
        </div>
      </section>
    </>
  );

  return (
    <>
      {minimized && !open && <AskPill busy={busy} unread={unread} onClick={() => reveal(true)} />}
      {panel}
      {splitModal}
    </>
  );
}

/** The assistant folded into the corner (above the tab bar on phones). */
function AskPill({ busy, unread, onClick }: { busy: string | null; unread: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`no-print fn-pop fixed right-4 z-[46] flex h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-3.5 pr-4 text-[14px] text-[var(--text-secondary)] shadow-[var(--shadow-floating)] transition-colors hover:text-[var(--foreground)] md:bottom-6 md:right-6 ${ABOVE_TABBAR}`}
      aria-label={unread ? "Ask Four Notes, there's a new reply" : "Ask Four Notes"}
    >
      <span className="relative grid h-6 w-6 place-items-center text-[var(--foreground)]">
        <ModelMark size={14} />
        {busy && <BusyRing />}
      </span>
      <span className={`max-w-[40vw] truncate ${busy ? "fn-shimmer" : ""}`}>{busy ? busy.replace(/…$/, "") : "Ask Four Notes"}</span>
      {unread && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden />}
    </button>
  );
}
