"use client";
// The assistant, laid out as the macOS app has it (Views/ChatDock.swift):
//   hero       Today's composer, in the middle of the page, like a chat app's home.
//              The conversation grows up out of the input, over the page.
//   minimized  Every other tab: an "Ask Four Notes" pill in the corner. One click
//              opens the same composer, narrower, in that corner; a click anywhere
//              else folds it away again. Phones get it as a sheet along the bottom.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAiRoute } from "@/lib/aiRoute";
import { useBackDismiss } from "@/lib/backstack";
import { markFiled } from "@/lib/highlight";
import { showChange, useOpenAssistant } from "@/lib/nav";
import type { ChangeLink } from "@/lib/store";
import { canSaveAsNote, useAssistant, type UIMessage } from "./assistant";
import Markdown from "./Markdown";
import ModelMenu from "./ModelMenu";
import { Dropdown, MenuItem, MenuSep } from "./notes/Dropdown";
import ScanPicker from "./ScanPicker";
import SplitEditor from "./SplitEditor";
import { Icon, Modal, useToast } from "./ui";

const SUGGESTIONS = [
  "Remind me to pay rent of 2.5M every month on the 5th at 9am",
  "Spent 45k on lunch at Warteg, split with Andi",
  "Set my food budget to 1.5M a month",
  "Where did I write about the Bali trip?",
  "What did I spend most on this month?",
];

/** Things to start with on Today, each filling in the start of a request. */
const STARTERS = [
  { icon: "noteAdd", title: "Write", text: "Write a note about " },
  { icon: "bell", title: "Remind", text: "Remind me to " },
  { icon: "wallet", title: "Spent", text: "Spent " },
  { icon: "search", title: "Find", text: "Where did I write about " },
  { icon: "sparkle", title: "Plan my day", text: "What should I focus on today?" },
];

const VOICE_LABEL = { off: "", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" } as const;
const MAX_INPUT_HEIGHT = 200;
const ROUND = "fn-press grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40";

export default function ChatDock({ minimized = false, hero = false }: { minimized?: boolean; hero?: boolean }) {
  const { messages, busy, recording, liveTranscript, voice, queued, send, scan, startRecording, stopRecording, toggleVoice, clear } = useAssistant();
  const toast = useToast();
  const [text, setText] = useState("");
  /** The conversation is showing over the page. */
  const [open, setOpen] = useState(false);
  /** Minimized mode only: the composer is showing instead of the pill. */
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(false);
  const [splitTx, setSplitTx] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const collapse = () => {
    inputRef.current?.blur();
    setExpanded(false);
    setOpen(false);
  };
  const reveal = (focus = false) => {
    setExpanded(true);
    setOpen(true);
    setUnread(false);
    if (focus) setTimeout(() => inputRef.current?.focus(), 80);
  };
  // Back closes the conversation (Today) or folds the composer back into the pill.
  useBackDismiss(minimized ? expanded : open, () => (minimized ? collapse() : setOpen(false)));

  // New messages: show the conversation. While folded away, a reply only marks the pill.
  const seen = useRef(messages.length);
  useEffect(() => {
    if (messages.length > seen.current) {
      const last = messages[messages.length - 1];
      if (!minimized || expanded || last?.role === "user") reveal();
      else setUnread(true);
    }
    seen.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Recording or voice mode shows their live status, so the composer has to be open.
  useEffect(() => {
    if (minimized && (recording || voice !== "off")) reveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, voice]);

  // "Ask the assistant…" from elsewhere: the request is filled in, not sent — it's the user's to finish.
  useOpenAssistant((prefill) => {
    reveal();
    if (prefill !== undefined) setText(prefill);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 80);
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  // Opened in the corner, a click anywhere else folds it away (the click still goes where it was aimed).
  // Menus and dialogs the composer opens live elsewhere in the page, and aren't "outside".
  useEffect(() => {
    if (!minimized || !expanded) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (panelRef.current?.contains(t) || t.closest?.("[role=menu], [role=dialog]")) return;
      if (recording || voice !== "off") return;
      collapse();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized, expanded, recording, voice]);

  // Grow the text box with its content, up to a limit, then scroll inside it.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [text, expanded]);

  // "/" anywhere outside a text field opens the assistant with the cursor in it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        reveal(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jump to what the assistant changed, folding the conversation so the item isn't hidden behind it.
  const jump = (link: ChangeLink, all: ChangeLink[] = []) => {
    if (!link) return;
    markFiled(all.filter((l): l is NonNullable<ChangeLink> => Boolean(l)).map((l) => l.id));
    if (minimized) collapse();
    else setOpen(false);
    inputRef.current?.blur();
    showChange(link);
  };

  const submit = (value = text) => {
    const t = value.trim();
    if (!t || busy) return;
    setText("");
    setOpen(true);
    send(t);
  };

  const pasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText(clip.slice(0, 2000));
      inputRef.current?.focus();
    } catch {
      toast("The browser didn't allow reading the clipboard. Paste with ⌘V / Ctrl+V instead.", "error");
    }
  };

  const splitModal = (
    <Modal open={!!splitTx} onClose={() => setSplitTx(null)} title="Split bill">
      <div className="p-4">{splitTx && <SplitEditor txId={splitTx} />}</div>
    </Modal>
  );

  if (minimized && !expanded) {
    return (
      <>
        <AskPill busy={busy} unread={unread} onClick={() => reveal(true)} />
        {splitModal}
      </>
    );
  }

  const showsConversation = open && (messages.length > 0 || !!busy);
  const sendDisabled = !text.trim() || !!busy;

  const conversation = (
    <div className="fn-rise overflow-hidden rounded-t-[20px] border border-b-0 border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-2 py-1.5 pl-4 pr-2 text-sm text-[var(--muted)]">
        <span className="flex items-center gap-1.5 font-medium">
          <Icon name="sparkle" size={15} className="text-[var(--accent)]" /> Assistant
          {queued > 0 && <span className="chip ml-1"><Icon name="wifiOff" size={11} />{queued} queued</span>}
        </span>
        <span className="flex items-center gap-1">
          {messages.length > 0 && <button className="h-8 rounded-lg px-2.5 text-sm hover:bg-[var(--hover)]" onClick={clear}>Clear</button>}
          <button className="fn-press grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--hover)]" onClick={() => (minimized ? collapse() : setOpen(false))} aria-label="Collapse chat">
            <Icon name="x" size={15} />
          </button>
        </span>
      </div>
      <div
        ref={listRef}
        className={`scroll-thin space-y-3 overflow-y-auto px-3 pb-3 ${minimized ? "max-h-[min(60dvh,540px)]" : "max-h-[min(50dvh,420px)]"}`}
        aria-live="polite"
      >
        {messages.map((m) => <MessageRow key={m.id} message={m} onJump={jump} onSplit={setSplitTx} />)}
        {busy && <Thinking label={busy} />}
      </div>
    </div>
  );

  const composer = (
    <div
      ref={panelRef}
      className={`pointer-events-auto relative w-full ${minimized ? "sm:w-[460px]" : "max-w-[720px]"}`}
      onKeyDown={(e) => { if (e.key === "Escape" && minimized) collapse(); }}
    >
      {/* The conversation sits on top of the input, sharing its edge, over the page. */}
      {showsConversation && <div className="absolute inset-x-0 bottom-full">{conversation}</div>}

      <div
        className={`overflow-hidden border border-[var(--line)] bg-[var(--panel)] shadow-[0_6px_28px_rgba(15,15,15,0.10)] transition-[border-radius] ${
          showsConversation ? "rounded-b-[20px]" : "rounded-[20px]"
        }`}
      >
        {(recording || voice !== "off") && (
          <div className="fn-rise flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5 text-sm text-[var(--muted)]">
            <span className={`shrink-0 font-medium ${recording ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
              {recording ? "● Recording" : `🎧 ${VOICE_LABEL[voice]}`}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {liveTranscript || (recording ? "Listening… press stop when you're done." : voice === "listening" ? "Say something, or “stop” to end." : "")}
            </span>
            {voice !== "off" && <button className="h-8 shrink-0 rounded-lg px-2.5 hover:bg-[var(--hover)]" onClick={toggleVoice}>End</button>}
          </div>
        )}

        <textarea
          ref={inputRef}
          rows={minimized ? 1 : 2}
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (img) { e.preventDefault(); scan(img); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={minimized ? "Ask or add anything…" : "How can I help you today?"}
          aria-label="Message the assistant"
          className={`input-plain block w-full resize-none px-[18px] pt-4 text-base leading-6 ${minimized ? "min-h-[40px]" : "min-h-[64px]"}`}
        />

        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-2">
          <ScanPicker onFile={scan}>
            {(pick) => (
              <Dropdown
                label="Add"
                width={250}
                chevron={false}
                className={`${ROUND} text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]`}
                button={<Icon name="plus" size={19} />}
              >
                {(close) => (
                  <>
                    <MenuItem icon="scan" label="Scan a receipt or note…" onSelect={() => { close(); pick(); }} />
                    <MenuItem icon={recording ? "stop" : "mic"} label={recording ? "Stop recording" : "Record a voice note"} onSelect={() => { close(); recording ? stopRecording() : startRecording(); }} />
                    <MenuItem icon="clipboard" label="Paste from the clipboard" onSelect={() => { close(); pasteClipboard(); }} />
                    <MenuSep />
                    <MenuItem icon="wave" label={voice !== "off" ? "End voice mode" : "Voice mode (hands-free)"} onSelect={() => { close(); toggleVoice(); }} />
                  </>
                )}
              </Dropdown>
            )}
          </ScanPicker>
          {minimized && (
            <button className={`${ROUND} hidden text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] sm:grid`} onClick={collapse} aria-label="Hide the assistant" title="Hide the assistant">
              <Icon name="chevronDown" size={17} />
            </button>
          )}
          <span className="min-w-0 flex-1" />
          <span className="min-w-0"><ModelMenu /></span>
          <button
            className={`${ROUND} ${recording ? "recording bg-[var(--danger)] text-white" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}
            title={recording ? "Stop and summarize" : "Record a voice note"}
            aria-label={recording ? "Stop recording" : "Record a voice note"}
            onClick={recording ? stopRecording : startRecording}
            disabled={(!!busy && !recording) || voice !== "off"}
          >
            <Icon name={recording ? "stop" : "mic"} size={18} />
          </button>
          <button
            className={`${ROUND} ${sendDisabled ? "bg-[var(--hover)] text-[var(--faint)]" : "bg-[var(--text)] text-[var(--bg)]"}`}
            onClick={() => submit()}
            disabled={sendDisabled}
            aria-label="Send"
          >
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {STARTERS.map((s) => (
            <button
              key={s.title}
              disabled={!!busy}
              onClick={() => {
                if (s.text.endsWith("?")) return submit(s.text);
                setText(s.text);
                setTimeout(() => { const el = inputRef.current; el?.focus(); el?.setSelectionRange(s.text.length, s.text.length); }, 0);
              }}
              className="fn-press flex h-9 items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_75%,transparent)] px-3.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50"
            >
              <Icon name={s.icon} size={15} /> {s.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {minimized ? (
        // The corner on larger screens; a sheet along the bottom on phones.
        <div className="no-print fn-sheet fn-corner pointer-events-none fixed inset-x-0 bottom-0 z-[47] flex justify-end px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] sm:inset-x-auto sm:right-6 sm:bottom-5 sm:px-0 sm:pb-0" data-state="open">
          {composer}
        </div>
      ) : hero ? (
        <div className="no-print relative z-20 flex w-full justify-center">{composer}</div>
      ) : (
        <div className="no-print sticky bottom-0 z-20 flex justify-center px-3 pb-3">{composer}</div>
      )}
      {splitModal}
    </>
  );
}

/** One message: yours on the right, the assistant's across the panel, with what it filed and what it offers next. */
function MessageRow({ message: m, onJump, onSplit }: { message: UIMessage; onJump: (l: ChangeLink, all: ChangeLink[]) => void; onSplit: (id: string) => void }) {
  const { busy, saveAsNote, searchWeb, openWebSearch } = useAssistant();
  const route = useAiRoute();
  const user = m.role === "user";
  const links = m.links ?? [];
  const targets = links.filter(Boolean);
  const offerSave = canSaveAsNote(m);
  return (
    <div className={`fn-rise flex ${user ? "justify-end pl-12" : ""}`}>
      <div className={`min-w-0 break-words text-[15px] leading-relaxed ${user ? "max-w-[520px] rounded-xl bg-[var(--hover)] px-3 py-2" : "w-full px-0.5"} ${m.queued ? "opacity-60" : ""}`}>
        {m.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.imageUrl} alt="" className="mb-2 max-h-44 rounded-md" />
        )}
        <div className={m.error ? "text-[var(--danger)]" : ""}>
          {user ? <span className="whitespace-pre-wrap">{m.content}</span> : <Markdown text={m.content} />}
        </div>
        {m.queued && <div className="mt-1 text-xs text-[var(--muted)]">Waiting for connection…</div>}

        {m.filed && m.filed.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {m.filed.map((f, i) =>
              links[i] ? (
                <button key={i} className="chip fn-pop fn-press min-h-8 cursor-pointer hover:bg-[var(--line)] hover:text-[var(--text)]" style={{ animationDelay: `${i * 70}ms` }} onClick={() => onJump(links[i], links)} title="Show this">
                  {f}
                </button>
              ) : (
                <span key={i} className="chip fn-pop min-h-8" style={{ animationDelay: `${i * 70}ms` }}>{f}</span>
              ),
            )}
            {targets.length > 0 && (
              <button
                className="fn-pop fn-nudge fn-press flex min-h-8 items-center gap-1 rounded-full bg-[var(--accent)] px-3 text-xs font-medium text-white"
                style={{ animationDelay: `${m.filed.length * 70 + 80}ms` }}
                onClick={() => onJump(targets[0], targets)}
              >
                {targets.length === 1 ? "Show" : `Show changes (${targets.length})`}
                <Icon name="arrowRight" size={13} />
              </button>
            )}
          </div>
        )}

        {m.sources && m.sources.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">Sources</div>
            {m.sources.map((s) => {
              let host = "";
              try { host = new URL(s.url).host; } catch { /* keep empty */ }
              return (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.url} className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">
                  <Icon name="link" size={12} className="shrink-0" />
                  <span className="truncate">{s.title}</span>
                  <span className="shrink-0 text-[var(--faint)]">{host}</span>
                </a>
              );
            })}
          </div>
        )}

        {(offerSave || m.webTopic) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {offerSave && <Offer icon="noteAdd" title="Save as note" help="Save this reply to Notes exactly as it is" onClick={() => saveAsNote(m.id)} />}
            {m.webTopic && route.canSearchWeb && (
              <Offer icon="sparkle" title="Ideas from the web" help="Search the web and suggest ideas here. Sends this note to Claude." disabled={!!busy} onClick={() => searchWeb(m.webTopic!)} />
            )}
            {m.webTopic && <Offer icon="search" title="Search the web" help={`Open a search for “${m.webTopic.noteTitle}” in a new tab`} onClick={() => openWebSearch(m.webTopic!)} />}
          </div>
        )}

        {m.splitTxId && (
          <button className="fn-pop fn-press mt-2 flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm hover:bg-[var(--hover)]" onClick={() => onSplit(m.splitTxId!)}>
            <Icon name="users" size={14} /> Split this bill with someone?
          </button>
        )}
      </div>
    </div>
  );
}

/** A next step offered under a reply: "Save as note", "Search the web". */
function Offer({ icon, title, help, disabled, onClick }: { icon: string; title: string; help: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      className="fn-pop fn-press flex h-8 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-[13px] font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50"
      title={help}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={14} /> {title}
    </button>
  );
}

/** "The assistant is working": a sparkle that breathes, three dots rising in a wave, and the status with a light sweeping across it. */
function Thinking({ label }: { label: string }) {
  return (
    <div className="fn-rise inline-flex items-center gap-2.5 rounded-full bg-[color-mix(in_srgb,var(--hover)_60%,transparent)] px-3 py-1.5 text-[15px]" role="status">
      <span className="fn-breathe grid h-[26px] w-[26px] place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent)]" aria-hidden>
        <Icon name="sparkle" size={15} />
      </span>
      <span className="fn-shimmer text-[var(--muted)]">{label}</span>
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className="fn-dot h-[5px] w-[5px] rounded-full bg-[var(--accent)]" style={{ animationDelay: `${i * 140}ms` }} />)}
      </span>
    </div>
  );
}

/**
 * The assistant folded into the corner. Alive without being busy: the sparkle breathes,
 * a soft light passes over the words now and then, and it lifts under the pointer.
 * All of it stops under "reduce motion".
 */
function AskPill({ busy, unread, onClick }: { busy: string | null; unread: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="no-print fn-pop group fixed bottom-[calc(env(safe-area-inset-bottom)+16px)] right-4 z-[46] flex h-[42px] items-center gap-2 rounded-[20px] border border-[var(--line)] bg-[var(--panel)] pl-2.5 pr-4 shadow-[0_5px_18px_rgba(15,15,15,0.12)] transition-[transform,box-shadow,border-color] duration-200 hover:scale-[1.04] hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:shadow-[0_8px_26px_rgba(15,15,15,0.16)] sm:right-6 sm:bottom-5"
      style={{ transformOrigin: "bottom right" }}
      aria-label={unread ? "Assistant (new reply)" : "Assistant"}
      title="Assistant"
    >
      <span className="relative grid h-6 w-6 place-items-center text-[var(--accent)]">
        <Icon name="sparkle" size={15} className="fn-sway" />
        {busy && <span className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-transparent border-t-[var(--accent)] border-r-[var(--accent)]" aria-hidden />}
      </span>
      <span className="fn-shimmer max-w-[40vw] truncate text-[13.5px] text-[var(--muted)] group-hover:text-[var(--text)]">{busy ?? "Ask Four Notes"}</span>
      {unread && <span className="fn-pop h-2 w-2 rounded-full bg-[var(--danger)]" aria-hidden />}
    </button>
  );
}
