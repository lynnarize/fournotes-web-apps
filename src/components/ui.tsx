"use client";
import { createContext, useCallback, useContext, useEffect, useState, type LiHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFiledFlash } from "@/lib/highlight";
import { useBackDismiss } from "@/lib/backstack";
import { usePresence } from "@/lib/hooks";

// ---- Toasts ---------------------------------------------------------------
type Toast = { id: number; text: string; tone?: "ok" | "error"; action?: { label: string; run: () => void } };
type PushToast = (text: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
const ToastCtx = createContext<PushToast>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback<PushToast>((text, tone = "ok", action) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed right-4 top-4 z-[60] flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="fn-toast pointer-events-auto flex items-start gap-3 whitespace-pre-line rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm shadow-[var(--shadow)]"
            style={{ borderLeft: `3px solid ${t.tone === "error" ? "var(--danger)" : "var(--ok)"}` }}
          >
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button
                className="shrink-0 font-medium text-[var(--accent)]"
                onClick={() => { t.action!.run(); setToasts((xs) => xs.filter((x) => x.id !== t.id)); }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---- Modal ------------------------------------------------------------------
// Rendered into <body> through a portal: a modal is often opened from inside a
// <form> or a <table>, and nesting one there produces invalid HTML (a nested
// <form> is dropped by the browser, so its submit button would submit the outer
// form instead).
export function Modal({ open, onClose, title, children, wide = false, actions }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean;
  /** Extra buttons in the title bar, which stays on top while the content scrolls. */
  actions?: ReactNode;
}) {
  const { mounted, state } = usePresence(open);
  useBackDismiss(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    // Phones: a sheet that slides up from the bottom. Larger screens: a centred dialog that scales in.
    <div className={`no-print fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:px-4 sm:pt-[10vh] ${open ? "" : "pointer-events-none"}`}>
      <div className="fn-backdrop absolute inset-0 bg-black/30" data-state={state} onMouseDown={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        data-state={state}
        className={`fn-sheet sm-dialog scroll-thin relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--line)] bg-[var(--bg)] pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow)] sm:max-h-[80vh] sm:rounded-xl sm:pb-0 ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        {title && (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)] py-1.5 pl-4 pr-1.5 sm:py-1">
            <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
            {actions}
            <button className="tap-target sm:h-9 sm:w-9" onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A list item that flashes while `flashId` is marked as just filed. */
export function FlashItem({ flashId, className = "", ...rest }: { flashId: string } & LiHTMLAttributes<HTMLLIElement>) {
  const on = useFiledFlash(flashId);
  return <li {...rest} className={`${className} ${on ? "fn-flash" : ""}`} />;
}

/** "The assistant is working" indicator. */
export function TypingDots({ label }: { label?: string }) {
  return (
    <div className="fn-rise flex items-center gap-2 text-[15px] text-[var(--muted)]" role="status">
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="fn-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </span>
      {label}
    </div>
  );
}

// ---- Icons (inline SVG, no dependency) -------------------------------------
const paths: Record<string, string> = {
  note: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  todo: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  finance: "M3 7h18v12H3zM3 11h18M7 15h3",
  today: "M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  send: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  menu: "M4 7h16M4 12h16M4 17h16",
  x: "M6 6l12 12M18 6L6 18",
  logout: "M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  chevron: "M9 6l6 6-6 6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  // Notes editor
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3",
  bold: "M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z",
  italic: "M19 4h-9M14 20H5M15 4L9 20",
  underline: "M6 4v6a6 6 0 0012 0V4M4 20h16",
  strike: "M16 6.5A4 4 0 0012 4c-2.8 0-4 1.6-4 3.2 0 1.3.8 2.2 2.2 2.8M4 12h16M8.5 17.5A4.6 4.6 0 0012 20c2.6 0 4-1.5 4-3.2 0-.8-.2-1.4-.6-1.8",
  highlight: "M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4",
  listBullet: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  listOrdered: "M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 14.5c0-.8.7-1.5 1.5-1.5S7 13.6 7 14.4c0 1-3 2.1-3 3.6h3",
  checklist: "M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M11 6h10M11 12h10M11 18h10",
  alignLeft: "M4 6h16M4 12h10M4 18h13",
  alignCenter: "M4 6h16M7 12h10M5.5 18h13",
  alignRight: "M4 6h16M10 12h10M7 18h13",
  indent: "M4 6h16M11 12h9M11 18h9M4 10l3 2.5L4 15",
  outdent: "M4 6h16M11 12h9M11 18h9M7 10l-3 2.5L7 15",
  superscript: "M4 19l8-8M12 19l-8-8M16 10h4l-4 0c0-1.5 4-2 4-4a2 2 0 00-4 0",
  subscript: "M4 5l8 8M12 5l-8 8M16 20h4l-4 0c0-1.5 4-2 4-4a2 2 0 00-4 0",
  quote: "M7 17c-2 0-3-1.5-3-3.5C4 9 7 7 9 6.5M17 17c-2 0-3-1.5-3-3.5 0-4.5 3-6.5 5-7",
  code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  divider: "M3 12h18M8 6h8M8 18h8",
  palette: "M12 3a9 9 0 100 18c.8 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 005-5c0-4.4-4-8-9-8zM7.5 11.5h.01M10.5 7.5h.01M15 8h.01",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  collapseLeft: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
  collapseRight: "M13 17l5-5-5-5M6 17l5-5-5-5",
  chevronDown: "M6 9l6 6 6-6",
  chevronLeft: "M15 18l-6-6 6-6",
  share: "M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v13",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1",
  more: "M5 11.2a.8.8 0 110 1.6.8.8 0 010-1.6zM12 11.2a.8.8 0 110 1.6.8.8 0 010-1.6zM19 11.2a.8.8 0 110 1.6.8.8 0 010-1.6z",
  textSize: "M3 18l5-12 5 12M4.8 14h6.4M15 18v-5.5a2.5 2.5 0 015 0V18M20 15.5h-2.8a1.8 1.8 0 100 3.6c1.4 0 2.8-.9 2.8-2.6",
  eraser: "M7 21h10M4.5 14.5L13 6l5 5-6.5 6.5H8z",
  print: "M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v7H6z",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01",
  sort: "M3 6h18M6 12h12M10 18h4",
  check: "M20 6L9 17l-5-5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  warning: "M12 3.5l9.5 16.5h-19zM12 10v4M12 17h.01",
  cart: "M3 4h2l2.4 11h10.2L20 8H6.2M9 20h.01M17 20h.01",
  car: "M5 17h14v-5l-2-5H7l-2 5zM5 12h14M7 17v2M17 17v2M8 14.5h.01M16 14.5h.01",
  bag: "M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4",
  book: "M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 19v2H6",
  arrowUpRight: "M7 17L17 7M8 7h9v9",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  wallet: "M4 7a2 2 0 0 1 2-2h12v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  status: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  bill: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  lines: "M4 6h16M4 12h16M4 18h10",
  noteAdd: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M12 18v-6M9 15h6",
  stop: "M7 7h10v10H7z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  pin: "M12 17v5M9 3h6l-1 7 4 3v2H6v-2l4-3z",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  cloud: "M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z",
  wave: "M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  clipboard: "M9 4h6v3H9zM9 5H6v16h12V5h-3",
  scan: "M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10",
  coffee: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  key: "M15 3a6 6 0 1 1-5.3 8.8L3 18.5V21h3v-2h2v-2h2l1.2-1.2A6 6 0 0 1 15 3zM16.5 7.5h.01",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  wifiOff: "M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.2-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M12 20h.01",
};

export function Icon({ name, size = 16, className = "" }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--line)] px-6 py-10 text-center">
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm text-[var(--muted)]">{hint}</div>
    </div>
  );
}

export function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${className}`}>{children}</h3>;
}

/** The rounded box every tab uses (Notes editor, task panel, Today, Finance). */
export const CARD = "rounded-2xl border border-[var(--line)] bg-[var(--bg)] md:shadow-[var(--shadow)]";

/** A card's title row: optional round icon, title, extra controls, and an "open" arrow. */
export function CardHead({ icon, title, onOpen, openLabel, children }: {
  icon?: string; title: ReactNode; onOpen?: () => void; openLabel?: string; children?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2.5">
      {icon && (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--hover)]">
          <Icon name={icon} size={18} />
        </span>
      )}
      <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h3>
      {children}
      {onOpen && (
        <button className="tap-target !h-9 !w-9 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={onOpen} aria-label={openLabel} title={openLabel}>
          <Icon name="arrowUpRight" size={18} />
        </button>
      )}
    </div>
  );
}

export const inputBox = "rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[var(--text)]";
