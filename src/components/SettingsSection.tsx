"use client";
// Settings building blocks, after Arc: a section with its heading, and inside it one
// bordered group of rows. Each row has its label and description on the left and its
// control on the right, with a hairline between rows.
import { useId, type ReactNode } from "react";

let pendingSection: string | null = null;

/** Ask Settings to show this section when it opens (deep links such as "Add a key"). */
export const revealSettingsSection = (id: string) => {
  pendingSection = id;
};

/** Read once by Settings as it opens: the section a deep link asked for, if any. */
export const takeRevealedSection = () => {
  const id = pendingSection;
  pendingSection = null;
  return id;
};

export default function SettingsSection({ id, title, description, children }: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    // Phones keep the title and the find field stuck on top: scroll the heading in below them.
    <section id={`settings-${id}`} aria-labelledby={headingId} className="flex scroll-mt-[150px] flex-col gap-4 md:scroll-mt-6">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-[22px] font-medium leading-tight tracking-[-0.02em]">{title}</h2>
        {description && <p className="text-[var(--text-secondary)]">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** One bordered group of rows. */
export function SettingsGroup({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div role={label ? "group" : undefined} aria-label={label} className={`rounded-[22px] border border-[var(--border)] ${className}`}>
      {children}
    </div>
  );
}

const ROW_EDGE = "border-b border-[var(--border-subtle)] last:border-b-0";

/**
 * A setting: label and description on the left, the control on the right. On narrow
 * screens a wide control drops below the label. Pass `htmlFor` when the control is a
 * field, or use the `labelId` it returns through `children` for aria-labelledby.
 */
export function SettingsRow({ label, description, children, htmlFor, id, wide = false, icon }: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode | ((labelId: string) => ReactNode);
  htmlFor?: string;
  /** Element id, e.g. `settings-field-…` for deep links. */
  id?: string;
  /** The control takes the full width on phones (fields, button rows). */
  wide?: boolean;
  /** A small tile before the label. */
  icon?: ReactNode;
}) {
  const labelId = useId();
  const control = typeof children === "function" ? children(labelId) : children;
  return (
    <div id={id} className={`flex min-h-16 scroll-mt-20 flex-wrap items-center gap-x-4 gap-y-3 py-3 pl-5 pr-4 ${ROW_EDGE}`}>
      {icon}
      <div className="flex min-w-[min(100%,13rem)] flex-1 flex-col gap-0.5">
        {htmlFor ? (
          <label id={labelId} htmlFor={htmlFor} className="text-[var(--foreground)]">{label}</label>
        ) : (
          <span id={labelId} className="text-[var(--foreground)]">{label}</span>
        )}
        {description && <span className="text-[13px] leading-snug text-[var(--text-muted)]">{description}</span>}
      </div>
      {control != null && control !== false && (
        <div className={`flex flex-wrap items-center gap-2 ${wide ? "w-full sm:w-auto" : "shrink-0"}`}>{control}</div>
      )}
    </div>
  );
}

/** Free-form content inside a group (forms, explanations), with the same edges as a row. */
export function SettingsBlock({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={`scroll-mt-20 px-5 py-4 ${ROW_EDGE} ${className}`}>{children}</div>;
}

/** The round switch from the kit, as a real switch for assistive tech. */
export function Switch({ checked, onChange, labelledBy, label, disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelledBy?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // The track is 26px tall; the invisible ::before brings the touch target to 44px.
      className="switch before:absolute before:-inset-y-[9px] before:inset-x-0 before:content-[''] disabled:opacity-45"
    />
  );
}
