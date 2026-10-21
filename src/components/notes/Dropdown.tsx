"use client";
// Toolbar menus for the Notes editor (and the app's other small menus). A floating
// layer: radius 26 with 6px padding, so its rows are 20. Rendered in a portal with fixed
// positioning, so they aren't clipped by the toolbar's horizontal scroll on phones, and
// every control prevents mousedown so the editor keeps its text selection.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui";

const keep = (e: React.MouseEvent) => e.preventDefault();

export function Dropdown({ label, button, children, width = 240, title, className, chevron = true, align = "left" }: {
  label: string;
  button: ReactNode;
  /** Receives `close` so items can dismiss the menu. */
  children: (close: () => void) => ReactNode;
  width?: number;
  title?: string;
  /** Replaces the default toolbar-button styling (the sidebar uses its own rows). */
  className?: string;
  chevron?: boolean;
  /** "right" lines the menu up with the trigger's right edge. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const wanted = align === "right" ? r.right - w : r.left;
    const left = Math.min(Math.max(8, wanted), window.innerWidth - w - 8);
    const top = r.bottom + 6;
    const below = window.innerHeight - top - 12;
    const above = r.top - 18;
    // Near the bottom of the screen (the assistant's composer), open upwards instead.
    if (below < 220 && above > below) setPos({ bottom: window.innerHeight - r.top + 6, left, maxHeight: above });
    else setPos({ top, left, maxHeight: Math.max(160, below) });
  }, [open, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) close(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseDown={keep}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        className={className ?? `tb-btn gap-1 px-2 ${open ? "tb-on" : ""}`}
      >
        {button}
        {chevron && <Icon name="chevronDown" size={14} className="opacity-60" />}
      </button>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onMouseDown={keep}
            className="fn-pop scroll-thin floating fixed z-[80] overflow-y-auto p-1.5 text-sm"
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxHeight }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({ icon, label, hint, active, danger, onSelect }: {
  icon?: string; label: string; hint?: string; active?: boolean; danger?: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      // A choice among several (sort order, font) reads as checked or not.
      role={active === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={active === undefined ? undefined : active}
      onMouseDown={keep}
      onClick={onSelect}
      className={`flex min-h-10 w-full items-center gap-3 rounded-[20px] px-3 text-left transition-colors [@media(pointer:coarse)]:min-h-11 ${
        danger
          ? "text-[var(--danger)] hover:bg-[var(--danger-subtle)] focus-visible:bg-[var(--danger-subtle)]"
          : `hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] ${active ? "font-medium text-[var(--foreground)]" : ""}`
      }`}
    >
      {icon && <Icon name={icon} size={17} className={danger ? "shrink-0" : "shrink-0 text-[var(--text-secondary)]"} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs text-[var(--text-muted)]">{hint}</span>}
      {active && <Icon name="check" size={15} className="shrink-0 text-[var(--accent)]" />}
    </button>
  );
}

export const MenuSep = () => <div className="mx-3 my-1.5 h-px bg-[var(--border-subtle)]" role="separator" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-3 pb-1.5 pt-2 text-xs text-[var(--text-muted)]">{children}</div>
);
