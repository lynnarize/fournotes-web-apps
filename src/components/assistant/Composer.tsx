"use client";
// The assistant's composer (Arc's ai-composer): one surface with the text box, and a row
// of round controls under it: add (scan, record, paste, voice mode), the model, the mic
// and send. Send is muted until there is something to send; while a reply is being
// written it becomes Stop, with a thin ring going round. "/" opens commands and "@" puts a
// note in as one token (see Suggest.tsx).
import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { useStore } from "@/lib/store";
import { useAssistant } from "../assistant";
import ModelMenu from "../ModelMenu";
import { Dropdown, MenuItem, MenuSep } from "../notes/Dropdown";
import ScanPicker from "../ScanPicker";
import { useToast } from "../ui";
import { Glyph } from "./icons";
import { findTrigger, liveTokens, Mirror, optionsFor, SuggestList, type Option } from "./Suggest";
import { useDictation } from "./useDictation";

export type ComposerHandle = {
  /** Puts text in the box (not sent) and the cursor at its end. */
  fill(text: string): void;
  focus(): void;
};

const LINE = 24;
const MAX_LINES = 8;
const PAD = 16;

/** 44px round targets on phones, 36px from the small breakpoint up. */
export const ROUND =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40 sm:h-9 sm:w-9";
const GHOST = `${ROUND} text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]`;

const VOICE_LABEL = { off: "", listening: "Listening", thinking: "Thinking", speaking: "Speaking" } as const;

export default function Composer({ placeholder, onSend, handle, label = "Message the assistant", className = "" }: {
  placeholder: string;
  onSend: (text: string) => void;
  handle?: Ref<ComposerHandle>;
  label?: string;
  className?: string;
}) {
  const { busy, canStop, stop, recording, liveTranscript, voice, scan, startRecording, stopRecording, toggleVoice } = useAssistant();
  const toast = useToast();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(setText, (msg) => toast(msg, "error"));
  const { notes } = useStore();
  const listId = useId();
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  /** The notes put in with "@", each drawn as one token while its text is whole. */
  const [tokens, setTokens] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  /** Escape closed the list; it stays closed until the text changes. */
  const [dismissed, setDismissed] = useState(false);
  const trigger = dismissed ? null : findTrigger(text, caret);
  const options = optionsFor(trigger, notes);
  const listOpen = !!trigger && options.length > 0;
  const sel = Math.min(active, Math.max(0, options.length - 1));
  const shownTokens = liveTokens(text, tokens);

  const focusEnd = () =>
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  // focusEnd only reads the ref, so the handle never needs replacing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(handle, () => ({ fill: (t: string) => { setText(t); focusEnd(); }, focus: () => focusEnd() }), []);

  // Grow with the text up to eight lines, then scroll inside.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const max = LINE * MAX_LINES + PAD;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  const empty = !text.trim();
  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    dictation.stop();
    setText("");
    setTokens([]);
    onSend(t);
  };

  /** Replaces what's being typed ("/rem", "@wee") with the choice, the cursor after it. */
  const pick = (o: Option) => {
    if (!trigger) return;
    const pos = trigger.start + o.apply.length;
    setText(text.slice(0, trigger.start) + o.apply + text.slice(trigger.end));
    if (o.token) setTokens((ts) => (ts.includes(o.token!) ? ts : [...ts, o.token!]));
    setActive(0);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    }, 0);
  };

  const pasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText(clip.slice(0, 2000));
      focusEnd();
    } catch {
      toast("The browser didn't allow reading the clipboard. Paste with ⌘V or Ctrl+V instead.", "error");
    }
  };

  // The mic dictates into the box where the browser can; elsewhere it records a voice note.
  const dictates = dictation.supported;
  const live = recording || voice !== "off";

  return (
    <div
      className={`relative rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-2 transition-colors focus-within:border-[var(--border-strong)] sm:p-[10px] ${className}`}
    >
      {listOpen && trigger && <SuggestList id={listId} trigger={trigger} options={options} active={sel} onPick={pick} onHover={setActive} />}
      {live && (
        <div role="status" className="flex min-h-9 items-center gap-2 px-2 text-[14px] text-[var(--text-secondary)]">
          {recording ? (
            <span className="recording h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]" aria-hidden />
          ) : (
            <Glyph name="wave" size={16} className="text-[var(--foreground)]" />
          )}
          <span className="shrink-0 font-medium text-[var(--foreground)]">{recording ? "Recording" : VOICE_LABEL[voice]}</span>
          <span className="min-w-0 flex-1 truncate">
            {liveTranscript || (recording ? "Press stop when you're done." : voice === "listening" ? "Say something, or “stop” to end." : "")}
          </span>
          <button type="button" className="btn btn-plain btn-sm" onClick={recording ? stopRecording : toggleVoice}>
            {recording ? "Stop" : "End"}
          </button>
        </div>
      )}

      <div className="relative">
      {shownTokens.length > 0 && <Mirror text={text} tokens={shownTokens} mirrorRef={mirrorRef} className="p-2 text-[16px] leading-6 tracking-[-0.01em]" />}
      <textarea
        ref={inputRef}
        rows={1}
        value={text}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen ? `${listId}-${sel}` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissed(false);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onScroll={(e) => { if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop; }}
        onPaste={(e) => {
          const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
          if (img) { e.preventDefault(); scan(img); }
        }}
        onKeyDown={(e) => {
          if (listOpen) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((sel + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
              return;
            }
            if ((e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === "Tab") {
              e.preventDefault();
              pick(options[sel]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDismissed(true);
              return;
            }
          }
          // Next to a mention, Backspace takes the whole token.
          if (e.key === "Backspace" && shownTokens.length) {
            const el = e.currentTarget;
            const pos = el.selectionStart;
            const hit = pos === el.selectionEnd ? shownTokens.find((t) => text.slice(0, pos).endsWith(`@${t}`)) : undefined;
            if (hit) {
              e.preventDefault();
              const start = pos - hit.length - 1;
              setText(text.slice(0, start) + text.slice(pos));
              setTokens((ts) => ts.filter((x) => x !== hit));
              setTimeout(() => { el.setSelectionRange(start, start); setCaret(start); }, 0);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={dictation.active ? "Listening…" : placeholder}
        aria-label={label}
        className={`input-plain relative block min-h-10 w-full resize-none p-2 text-[16px] leading-6 tracking-[-0.01em] placeholder:text-[var(--text-muted)] ${shownTokens.length ? "text-transparent caret-[var(--foreground)]" : ""}`}
      />
      </div>

      <div className="flex items-center gap-0.5">
        <ScanPicker onFile={scan}>
          {(pick) => (
            <Dropdown label="Add a photo, recording or text" width={260} chevron={false} className={GHOST} button={<Glyph name="plus" size={18} />}>
              {(close) => (
                <>
                  <MenuItem icon="scan" label="Scan a receipt or note…" onSelect={() => { close(); pick(); }} />
                  <MenuItem icon={recording ? "stop" : "mic"} label={recording ? "Stop recording" : "Record a voice note"} onSelect={() => { close(); recording ? stopRecording() : startRecording(); }} />
                  <MenuItem icon="clipboard" label="Paste from the clipboard" onSelect={() => { close(); pasteClipboard(); }} />
                  <MenuSep />
                  <MenuItem icon="wave" label={voice !== "off" ? "End voice mode" : "Voice mode, hands-free"} onSelect={() => { close(); toggleVoice(); }} />
                </>
              )}
            </Dropdown>
          )}
        </ScanPicker>
        <span className="min-w-0 flex-1" />
        <ModelMenu />
        {dictates ? (
          <button
            type="button"
            className={`${GHOST} ${dictation.active ? "bg-[var(--accent-subtle)] text-[var(--foreground)]" : ""}`}
            aria-label={dictation.active ? "Stop dictating" : "Dictate"}
            aria-pressed={dictation.active}
            title={dictation.active ? "Stop dictating" : "Dictate"}
            disabled={live}
            onClick={() => (dictation.active ? dictation.stop() : dictation.start(text))}
          >
            <Glyph name="mic" size={18} />
          </button>
        ) : (
          <button
            type="button"
            className={recording ? `${ROUND} recording bg-[var(--danger)] text-white` : GHOST}
            aria-label={recording ? "Stop recording" : "Record a voice note"}
            title={recording ? "Stop and summarize" : "Record a voice note"}
            disabled={(!!busy && !recording) || voice !== "off"}
            onClick={recording ? stopRecording : startRecording}
          >
            <Glyph name={recording ? "stop" : "mic"} size={18} />
          </button>
        )}
        <SendButton empty={empty} busy={busy} canStop={canStop} onSend={submit} onStop={stop} />
      </div>
    </div>
  );
}

/** A thin accent ring going round: a reply is on its way. */
export function BusyRing() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden className="absolute inset-0 h-full w-full animate-spin motion-reduce:animate-none">
      <circle cx="18" cy="18" r="16.5" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray="42 104" />
    </svg>
  );
}

/**
 * Send, muted until there is text. While a reply is running: Stop (a small square in a
 * turning ring) when it can be stopped, or just the ring when it can't.
 */
export function SendButton({ empty, busy, canStop, onSend, onStop, size = "toolbar" }: {
  empty: boolean;
  busy: string | null;
  canStop: boolean;
  onSend: () => void;
  onStop: () => void;
  /** "toolbar": 44px on phones, 36px above. "fixed": always 36px (the follow-up box). */
  size?: "toolbar" | "fixed";
}) {
  const box = size === "fixed" ? "grid h-9 w-9 shrink-0 place-items-center rounded-full" : ROUND;
  if (busy) {
    return canStop ? (
      <button type="button" onClick={onStop} aria-label="Stop" title="Stop" className={`${box} relative bg-[var(--surface-muted)] text-[var(--foreground)]`}>
        <BusyRing />
        <span className="h-2.5 w-2.5 rounded-[2.5px] bg-current" aria-hidden />
      </button>
    ) : (
      <span role="status" aria-label={busy} title={busy} className={`${box} relative bg-[var(--surface-muted)]`}>
        <BusyRing />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSend}
      aria-label="Send message"
      aria-disabled={empty}
      className={`${box} transition-colors ${empty ? "cursor-default bg-[var(--surface-muted)] text-[var(--text-muted)]" : "bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-strong)]"}`}
    >
      <Glyph name="arrowUp" size={18} />
    </button>
  );
}
