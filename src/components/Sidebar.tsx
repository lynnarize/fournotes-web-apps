"use client";
// The sidebar, laid out like the macOS app (macos/FourNotes/Views/SidebarView.swift):
// an account card, a search card, the four tabs as cards with the open one raised,
// then quick capture and settings as flat rows.
import { useState } from "react";
import { usePulsingTabs } from "@/lib/highlight";
import { isMac } from "@/lib/hooks";
import { openItem } from "@/lib/nav";
import { alive, localMonth, useStore } from "@/lib/store";
import { useTheme, type ThemePref } from "@/lib/theme";
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

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "today" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "todo", label: "To-Do", icon: "todo" },
  { id: "finance", label: "Finance", icon: "finance" },
];

const STATUS_LABEL = { off: "", "signed-out": "Not synced", syncing: "Syncing…", synced: "Synced", offline: "Offline", error: "Sync error" } as const;

/** Half of the capture row: an outlined button, icon and name. */
const CAPTURE = "fn-press flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50";

/** A flat sidebar row: only the pointer lights it up. */
const ROW = "flex w-full items-center gap-3 rounded-xl px-3.5 text-left text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50 disabled:hover:bg-transparent";

export default function Sidebar({ tab, setTab, onClose, onSearch, onSettings }: {
  tab: Tab; setTab: (t: Tab) => void; onClose?: () => void; onSearch: () => void; onSettings: () => void;
}) {
  const store = useStore();
  const { notes, todos, transactions, spaces, currentSpaceId, switchSpace, settings } = store;
  const { scan, recording, startRecording, stopRecording, busy, voice, toggleVoice } = useAssistant();
  const cloud = useCloud();
  const google = useGoogleSync();
  const syncState = google.email ? google.status : cloud.enabled ? cloud.status : null;
  const syncTone = syncState === "error" ? "text-[var(--danger)]" : syncState === "synced" ? "text-[var(--ok)]" : "";
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
  const pulsing = usePulsingTabs();
  // In the phone drawer, rows follow the slide-in one after another.
  const enter = (i: number) => (onClose ? { animationDelay: `${90 + i * 35}ms` } : undefined);

  const name = settings.name?.trim();
  const initials = name ? name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() : null;
  const spaceLabel = spaces.find((s) => s.id === currentSpaceId)?.name ?? "Personal";

  // Making something from outside its own tab: each one opens what it made.
  const newNote = () => { const n = store.addNote({ title: "" }); setTab("notes"); openItem("note", n.id); onClose?.(); };
  const newTask = () => { const t = store.addTodo({ title: "" }); setTab("todo"); openItem("todo", t.id); onClose?.(); };
  const newTransaction = () => { const t = store.addTransaction({ merchant: "" }); setTab("finance"); openItem("transaction", t.id); onClose?.(); };
  const record = () => { recording ? stopRecording() : startRecording(); onClose?.(); };

  // Signed in means Google Drive sync or a Supabase account; sign-out ends both, and keeps what's on this device.
  const signedInAs = google.email ?? cloud.email ?? null;
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
      {initials ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--accent)] text-[14px] font-semibold text-white">{initials}</span>
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--bg)]"><Logo size={28} /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-[var(--text)]">{name || "Four Notes"}</span>
        <span className="block truncate text-xs text-[var(--faint)]">{spaceLabel}</span>
      </span>
    </>
  );

  return (
    <nav className={`flex h-full flex-col bg-[var(--panel)] px-3.5 pb-4 pt-3.5 text-sm ${onClose ? "w-[86vw] max-w-[22rem] pt-[calc(env(safe-area-inset-top)+14px)]" : "w-64"}`}>
      {/* Account: whose notes these are, which space, and the two ways out of here */}
      <div className="flex items-center gap-1">
        {signedInAs ? (
          <Dropdown
            label={`${name || "Four Notes"}, ${spaceLabel}`}
            title={`Signed in as ${signedInAs}`}
            width={260}
            chevron={false}
            className="flex h-[60px] min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 text-left transition-colors hover:bg-[var(--hover)]"
            button={<>{identity}<Icon name="chevronDown" size={14} className="shrink-0 text-[var(--muted)]" /></>}
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
                <MenuLabel>{signedInAs}</MenuLabel>
                <MenuItem icon="logout" label="Sign out" onSelect={() => { close(); void signOut(); }} />
                {/* Someone else's or a shared computer: leave nothing behind. */}
                <MenuItem icon="trash" label="Sign out and remove data…" danger onSelect={() => { close(); setConfirmWipe(true); }} />
              </>
            )}
          </Dropdown>
        ) : (
          // Not signed in: whose notes these are, nothing to open.
          <div className="flex h-[60px] min-w-0 flex-1 items-center gap-2.5 px-3">{identity}</div>
        )}
        {onClose && (
          <button className="tap-target fn-press fn-pop md:hidden" style={{ animationDelay: "120ms" }} onClick={onClose} aria-label="Close menu"><Icon name="x" size={20} /></button>
        )}
      </div>

      <button className={`${ROW} mt-1 h-[46px]`} onClick={search}>
        <Icon name="search" size={17} />
        <span className="flex-1">Search…</span>
        <kbd className="rounded bg-[var(--hover)] px-1.5 py-px text-[11px] text-[var(--faint)]">{isMac() ? "⌘" : "Ctrl"} K</kbd>
      </button>

      {/* The tabs: the open one is a raised card, the rest sit flat */}
      <div className="mt-7 space-y-1.5">
        {TABS.map((t, i) => {
          const selected = tab === t.id;
          return (
            <div
              key={t.id}
              style={enter(i)}
              className={`${onClose ? "fn-rise" : ""} group relative flex items-center rounded-xl border transition-colors ${
                selected ? "border-[var(--line)] bg-[var(--bg)] shadow-[var(--shadow)]" : "border-transparent hover:bg-[var(--hover)]"
              }`}
            >
              <button
                onClick={() => go(t.id)}
                aria-current={selected ? "page" : undefined}
                className={`flex min-h-[46px] min-w-0 flex-1 items-center gap-3 rounded-xl pl-3.5 text-left ${
                  selected ? "font-medium text-[var(--text)]" : "text-[var(--muted)] group-hover:text-[var(--text)]"
                }`}
              >
                <Icon name={t.icon} size={18} className="shrink-0" />
                <span className="truncate">{t.label}</span>
                {/* Still being shaped: said plainly beside its name. */}
                {t.id === "finance" && (
                  <span className="rounded border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-[5px] py-px text-[10px] font-semibold leading-tight text-[var(--danger)]">Beta</span>
                )}
                <span className="flex-1" />
                {pulsing.includes(t.id) && !selected && <span className="fn-ping relative shrink-0" aria-label="New from the assistant" />}
              </button>
              {/* The count gives way to the menu while the row is in use. */}
              {counts[t.id] > 0 && (
                <span className={`pr-3.5 text-xs tabular-nums text-[var(--faint)] ${selected ? "hidden" : "group-hover:hidden"}`}>{counts[t.id]}</span>
              )}
              <span className={`pr-2 ${selected ? "" : "hidden group-hover:block"}`}>
                <Dropdown
                  label={`${t.label} actions`}
                  width={230}
                  align="right"
                  chevron={false}
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
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
            </div>
          );
        })}
      </div>

      <div className="mt-auto" />

      {/* Capture, side by side; then voice mode and settings as flat rows at the bottom */}
      <div className="space-y-0.5">
        <div className="mb-1.5 grid grid-cols-2 gap-1.5">
          <ScanPicker onFile={(f) => { onClose?.(); scan(f); }}>
            {(pick) => (
              <button className={CAPTURE} onClick={pick} disabled={!!busy} title="Scan a receipt, note or e-wallet screenshot">
                <Icon name="scan" size={17} /> Scan
              </button>
            )}
          </ScanPicker>
          <button
            className={`${CAPTURE} ${recording ? "!text-[var(--danger)]" : ""}`}
            onClick={record}
            disabled={(!!busy && !recording) || voice !== "off"}
            title={recording ? "Stop recording" : "Record a voice note"}
          >
            <Icon name={recording ? "stop" : "mic"} size={17} /> {recording ? "Stop" : "Record"}
          </button>
        </div>
        <button className={`${ROW} h-[46px]`} onClick={toggleVoice} disabled={recording}>
          <Icon name="wave" size={18} className={voice !== "off" ? "text-[var(--accent)]" : ""} />
          {voice !== "off" ? "End voice mode" : "Voice assistant"}
        </button>
      </div>

      {/* Sync status, with a quick switch between the looks beside it. */}
      <div className="mt-1 flex items-center gap-1">
        {google.enabled || cloud.enabled ? (
          <button
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3.5 py-1.5 text-left text-xs text-[var(--faint)] hover:bg-[var(--hover)]"
            onClick={openSettings}
            title={(google.email ? google.error : cloud.error) ?? undefined}
          >
            <Icon name="cloud" size={13} className={`shrink-0 ${syncTone}`} />
            <span className="truncate">
              {google.email
                ? `${GOOGLE_STATUS_LABEL[google.status]} · Google Drive`
                : cloud.enabled && cloud.email
                  ? `${STATUS_LABEL[cloud.status]} · ${cloud.email}`
                  : "Turn on sync"}
            </span>
          </button>
        ) : (
          <span className="flex-1" />
        )}
        <ThemeSwitch />
      </div>

      <button className={`${ROW} mt-0.5 h-[46px]`} onClick={openSettings}>
        <Icon name="settings" size={18} /> Settings
      </button>
      <TypeToConfirm
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Sign out and remove data?"
        confirmLabel="Sign out and remove"
        onConfirm={signOutAndWipe}
      >
        <p>
          For a shared or public computer: this signs <strong>{signedInAs}</strong> out and erases everything Four Notes keeps in this browser —
          notes, tasks, spending, settings and saved API keys.
        </p>
        <p className="text-[var(--muted)]">
          The synced copy in your account is kept, and comes back when you sign in again.
          {accountSync !== "synced" && (
            <> <strong className="text-[var(--danger)]">Some changes may not have synced yet</strong> ({accountSync}); they would be lost. Sync first if you can.</>
          )}
        </p>
      </TypeToConfirm>
    </nav>
  );
}

const LOOKS: { id: Exclude<ThemePref, "system">; label: string; icon: string }[] = [
  { id: "light", label: "Light", icon: "today" },
  { id: "paper", label: "Paper", icon: "book" },
  { id: "dark", label: "Dark", icon: "moon" },
];

/** Light, Paper or Dark in one click. While following the device, the look it resolves to is lit. */
function ThemeSwitch() {
  const { pref, resolved, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex shrink-0 items-center rounded-lg border border-[var(--line)] p-0.5">
      {LOOKS.map((l) => {
        const on = pref === "system" ? resolved === l.id : pref === l.id;
        return (
          <button
            key={l.id}
            role="radio"
            aria-checked={on}
            onClick={() => setPref(l.id)}
            title={pref === "system" && on ? `${l.label} (following your device)` : l.label}
            aria-label={l.label}
            className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${on ? "bg-[var(--bg)] text-[var(--text)] shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-[var(--faint)] hover:text-[var(--text)]"}`}
          >
            <Icon name={l.icon} size={14} />
          </button>
        );
      })}
    </div>
  );
}
