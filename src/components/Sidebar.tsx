"use client";
// The sidebar, after Arc (Main.dc.html): the space switcher with the mark, a search field
// that opens ⌘K, the four places with their counts, then capture (Scan, Record), the voice
// assistant and Settings, and a last line saying where the data lives.
// On phones the same sidebar is a drawer behind the header's mark.
import { useEffect, useState } from "react";
import { usePulsingTabs } from "@/lib/highlight";
import { isMac } from "@/lib/hooks";
import { openItem, openSettings as openSettingsAt } from "@/lib/nav";
import { alive, localMonth, useStore } from "@/lib/store";
import type { Tab } from "@/lib/types";
import { wipeThisDevice } from "@/lib/wipe";
import { useAssistant } from "./assistant";
import { useCloud } from "./cloud";
import { GOOGLE_STATUS_LABEL, useGoogleSync } from "./googleSync";
import { Dropdown, MenuItem, MenuLabel, MenuSep } from "./notes/Dropdown";
import ScanPicker from "./ScanPicker";
import Logo from "./Logo";
import TypeToConfirm from "./TypeToConfirm";
import { Icon, useToast } from "./ui";

export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "today" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "todo", label: "To-Do", icon: "todo" },
  { id: "finance", label: "Finance", icon: "finance" },
];

const STATUS_LABEL = { off: "", "signed-out": "Not synced", syncing: "Syncing…", synced: "Synced", offline: "Offline", error: "Sync error" } as const;

/** Up and down chevrons: this opens a list to switch between. */
export const ChevronsUpDown = ({ size = 16, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </svg>
);

/** Kit nav row; 44px tall in the phone drawer. */
const ROW = "nav-row w-full text-left disabled:opacity-45 disabled:hover:bg-transparent max-md:h-11";

export default function Sidebar({ tab, setTab, onClose, onSearch, onSettings }: {
  tab: Tab; setTab: (t: Tab) => void; onClose?: () => void; onSearch: () => void; onSettings: () => void;
}) {
  const store = useStore();
  const { notes, todos, transactions, spaces, currentSpaceId, switchSpace } = store;
  const { scan, recording, startRecording, stopRecording, busy, voice, toggleVoice } = useAssistant();
  const cloud = useCloud();
  const google = useGoogleSync();
  const month = localMonth();
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const counts: Record<Tab, number> = {
    today: alive(todos).filter((t) => !t.done && t.dueAt && new Date(t.dueAt) <= endToday).length,
    notes: alive(notes).length,
    todo: alive(todos).filter((t) => !t.done).length,
    finance: alive(transactions).filter((t) => t.date.startsWith(month)).length,
  };
  const go = (t: Tab) => { setTab(t); onClose?.(); };
  const search = () => { onSearch(); onClose?.(); };
  const openSettings = () => { onSettings(); onClose?.(); };
  const syncSettings = () => { onClose?.(); openSettingsAt("sync"); };
  const pulsing = usePulsingTabs();
  // Shortcut labels depend on the platform, which the server can't know: set after mount.
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);
  // In the phone drawer, rows follow the slide-in one after another.
  const enter = (i: number) => (onClose ? { animationDelay: `${90 + i * 35}ms` } : undefined);

  const spaceLabel = spaces.find((s) => s.id === currentSpaceId)?.name ?? "Personal";

  // Making something from outside its own tab: each one opens what it made.
  const newNote = () => { const n = store.addNote({ title: "" }); setTab("notes"); openItem("note", n.id); onClose?.(); };
  const newTask = () => { const t = store.addTodo({ title: "" }); setTab("todo"); openItem("todo", t.id); onClose?.(); };
  const newTransaction = () => { const t = store.addTransaction({ merchant: "" }); setTab("finance"); openItem("transaction", t.id); onClose?.(); };
  const record = () => { recording ? stopRecording() : startRecording(); onClose?.(); };

  // Signed in means Google Drive sync or a Supabase account; sign-out ends both, and keeps what's on this device.
  const signedInAs = google.email ?? cloud.email ?? null;
  const syncAvailable = google.enabled || cloud.enabled;
  const toast = useToast();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const accountSync = google.email ? google.status : cloud.status;
  /** Sign out, then erase this browser's copy. The synced copy stays and comes back on the next sign-in. */
  const signOutAndWipe = async () => {
    if (google.email) await google.disconnect(false);
    if (cloud.email) await cloud.signOut();
    await wipeThisDevice();
  };
  const signOut = async () => {
    if (google.email) await google.disconnect(false);
    if (cloud.email) {
      await cloud.signOut();
      toast("Signed out. Your data stays on this device.");
    }
    onClose?.();
  };

  const identity = (
    <>
      <Logo size={30} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-[var(--foreground)]">Four Notes</span>
        <span className="truncate text-xs text-[var(--text-muted)]">{spaceLabel}</span>
      </span>
    </>
  );

  // Where the data lives, and how to change that.
  const syncState = google.email ? google.status : cloud.email ? cloud.status : null;
  const syncTone = syncState === "error" ? "text-[var(--danger)]" : syncState === "synced" ? "text-[var(--success)]" : "";
  const syncText = google.email
    ? `${GOOGLE_STATUS_LABEL[google.status]} · Google Drive`
    : cloud.email
      ? `${STATUS_LABEL[cloud.status]} · ${cloud.email}`
      : "Saved on this device";

  return (
    <nav
      aria-label={onClose ? "Menu" : "Main"}
      className={`scroll-thin flex h-full flex-col gap-5 overflow-y-auto bg-[var(--sidebar)] px-3 pb-4 text-sm ${
        onClose ? "w-[86vw] max-w-[22rem] pt-[calc(env(safe-area-inset-top)+14px)]" : "w-[248px] border-r border-[var(--border)] pt-3.5"
      }`}
    >
      {/* The space switcher: whose notes these are, which space, and the ways out. */}
      <div className="flex items-center gap-1">
        {spaces.length > 0 || signedInAs || syncAvailable ? (
          <Dropdown
            label={`Switch space, current space ${spaceLabel}`}
            title={signedInAs ? `Signed in as ${signedInAs}` : undefined}
            width={260}
            chevron={false}
            className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[18px] pl-1.5 pr-2.5 text-left transition-colors hover:bg-[var(--hover)]"
            button={<>{identity}<ChevronsUpDown className="shrink-0 text-[var(--text-muted)]" /></>}
          >
            {(close) => (
              <>
                {/* Shared spaces (Supabase) are only there once signed in. */}
                {spaces.length > 0 && (
                  <>
                    <MenuLabel>Space</MenuLabel>
                    <MenuItem label="Personal" active={!currentSpaceId} onSelect={() => { close(); switchSpace(null); }} />
                    {spaces.map((s) => (
                      <MenuItem key={s.id} label={s.name} active={currentSpaceId === s.id} onSelect={() => { close(); switchSpace(s.id); }} />
                    ))}
                    <MenuSep />
                  </>
                )}
                {signedInAs ? (
                  <>
                    <MenuLabel>{signedInAs}</MenuLabel>
                    <MenuItem icon="logout" label="Sign out" onSelect={() => { close(); void signOut(); }} />
                    {/* Someone else's or a shared computer: leave nothing behind. */}
                    <MenuItem icon="trash" label="Sign out and remove data…" danger onSelect={() => { close(); setConfirmWipe(true); }} />
                  </>
                ) : (
                  <MenuItem icon="cloud" label="Sign in to sync and share" onSelect={() => { close(); syncSettings(); }} />
                )}
              </>
            )}
          </Dropdown>
        ) : (
          // Nothing to switch to: the mark and the space, nothing to open.
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 pl-1.5 pr-2.5">{identity}</div>
        )}
        {onClose && (
          <button className="btn btn-plain btn-icon fn-pop h-11 w-11 md:hidden" style={{ animationDelay: "120ms" }} onClick={onClose} aria-label="Close menu">
            <Icon name="x" size={20} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={search}
        className="flex h-9 shrink-0 items-center gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] pl-3 pr-1.5 text-left text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] max-md:h-11"
      >
        <Icon name="search" size={16} className="shrink-0" />
        <span className="flex-1">Search or add</span>
        <kbd className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      {/* The four places. The count gives way to a menu of quick actions while a row is in use. */}
      <ul className="flex flex-col gap-0.5">
        {TABS.map((t, i) => {
          const selected = tab === t.id;
          const pulse = pulsing.includes(t.id) && !selected;
          // In the phone drawer there's no hover: the open tab keeps its menu showing.
          const menuAlways = selected && !!onClose;
          return (
            <li key={t.id} style={enter(i)} className={`${onClose ? "fn-rise" : ""} group relative`}>
              <button type="button" onClick={() => go(t.id)} aria-current={selected ? "page" : undefined} className={ROW}>
                <Icon name={t.icon} size={16} className="shrink-0" />
                <span className="truncate">{t.label}</span>
                {/* Still being shaped: said plainly beside its name. */}
                {t.id === "finance" && <span className="badge badge-info h-5 px-1.5 text-[11px]">Beta</span>}
                <span className="flex-1" />
                {pulse && (
                  <span className="relative grid h-4 w-4 shrink-0 place-items-center">
                    <span className="fn-ping relative" aria-hidden />
                    <span className="sr-only">, new from the assistant</span>
                  </span>
                )}
                {counts[t.id] > 0 && (
                  <span
                    className={`fn-num pr-0.5 text-xs font-normal text-[var(--text-muted)] ${
                      menuAlways ? "invisible" : "group-hover:invisible group-has-[:focus-visible]:invisible group-has-[[aria-expanded=true]]:invisible"
                    }`}
                  >
                    {counts[t.id]}
                  </span>
                )}
              </button>
              <span
                className={`absolute right-1 top-1/2 -translate-y-1/2 transition-opacity ${
                  menuAlways ? "" : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-has-[[aria-expanded=true]]:opacity-100"
                }`}
              >
                <Dropdown
                  label={`${t.label} actions`}
                  width={230}
                  align="right"
                  chevron={false}
                  className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] max-md:h-9 max-md:w-9"
                  button={<Icon name="more" size={18} />}
                >
                  {(close) => (
                    <>
                      {t.id === "today" && (
                        <>
                          <MenuItem icon="today" label="Open Today" onSelect={() => { close(); go("today"); }} />
                          <MenuItem icon="search" label="Search or quick add…" onSelect={() => { close(); search(); }} />
                        </>
                      )}
                      {t.id === "notes" && (
                        <>
                          <MenuItem icon="noteAdd" label="New note" onSelect={() => { close(); newNote(); }} />
                          <ScanPicker onFile={(f) => { onClose?.(); scan(f); }}>
                            {(pick) => <MenuItem icon="scan" label="Scan a note…" onSelect={() => { close(); pick(); }} />}
                          </ScanPicker>
                          <MenuItem icon={recording ? "stop" : "mic"} label={recording ? "Stop recording" : "Record to note"} onSelect={() => { close(); record(); }} />
                        </>
                      )}
                      {t.id === "todo" && <MenuItem icon="todo" label="New task" onSelect={() => { close(); newTask(); }} />}
                      {t.id === "finance" && (
                        <>
                          <MenuItem icon="finance" label="New transaction" onSelect={() => { close(); newTransaction(); }} />
                          <ScanPicker onFile={(f) => { onClose?.(); scan(f); }}>
                            {(pick) => <MenuItem icon="scan" label="Scan a receipt…" onSelect={() => { close(); pick(); }} />}
                          </ScanPicker>
                        </>
                      )}
                    </>
                  )}
                </Dropdown>
              </span>
            </li>
          );
        })}
      </ul>

      <span className="flex-1" aria-hidden />

      {/* Capture, side by side. */}
      <div className="flex gap-2">
        <ScanPicker onFile={(f) => { onClose?.(); scan(f); }}>
          {(pick) => (
            <button type="button" className="btn btn-secondary flex-1 font-normal max-md:h-11" onClick={pick} disabled={!!busy} title="Scan a receipt, note or e-wallet screenshot">
              <Icon name="scan" size={16} /> Scan
            </button>
          )}
        </ScanPicker>
        <button
          type="button"
          className={`btn btn-secondary flex-1 font-normal max-md:h-11 ${recording ? "!text-[var(--danger)]" : ""}`}
          onClick={record}
          disabled={(!!busy && !recording) || voice !== "off"}
          title={recording ? "Stop recording" : "Record a voice note"}
        >
          <Icon name={recording ? "stop" : "mic"} size={16} /> {recording ? "Stop" : "Record"}
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        <button type="button" className={ROW} onClick={toggleVoice} disabled={recording}>
          <Icon name="wave" size={16} className={`shrink-0 ${voice !== "off" ? "text-[var(--accent)]" : ""}`} />
          {voice !== "off" ? "End voice mode" : "Voice assistant"}
        </button>
        <button type="button" className={ROW} onClick={openSettings} aria-keyshortcuts={mac ? "Meta+Comma" : "Control+Comma"}>
          <Icon name="settings" size={16} className="shrink-0" />
          <span className="flex-1">Settings</span>
          <kbd className="bg-transparent p-0 text-xs text-[var(--text-muted)] max-md:hidden" aria-hidden>{mac ? "⌘," : "Ctrl ,"}</kbd>
        </button>
      </div>

      {/* Where the data lives. Signed in: the line opens sync settings. */}
      <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 pt-2.5 text-xs text-[var(--text-muted)]">
        <Icon name="cloud" size={16} className={`shrink-0 ${syncTone}`} />
        {syncState ? (
          <button
            type="button"
            className="min-h-8 min-w-0 flex-1 truncate text-left hover:text-[var(--foreground)] max-md:min-h-11"
            onClick={syncSettings}
            title={(google.email ? google.error : cloud.error) ?? "Sync settings"}
          >
            {syncText}
          </button>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{syncText}</span>
            {syncAvailable && (
              <button type="button" className="min-h-8 shrink-0 font-medium text-[var(--foreground)] hover:underline max-md:min-h-11" onClick={syncSettings}>
                Turn on sync
              </button>
            )}
          </>
        )}
      </div>

      <TypeToConfirm
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Sign out and remove data?"
        confirmLabel="Sign out and remove"
        onConfirm={signOutAndWipe}
      >
        <p>
          For a shared or public computer: this signs <strong className="font-medium">{signedInAs}</strong> out and erases everything Four Notes keeps in this
          browser: notes, tasks, spending, settings and saved API keys.
        </p>
        <p className="text-[var(--text-secondary)]">
          The synced copy in your account is kept, and comes back when you sign in again.
          {accountSync !== "synced" && (
            <> <strong className="font-medium text-[var(--danger)]">Some changes may not have synced yet</strong> ({accountSync}); they would be lost. Sync first if you can.</>
          )}
        </p>
      </TypeToConfirm>
    </nav>
  );
}
