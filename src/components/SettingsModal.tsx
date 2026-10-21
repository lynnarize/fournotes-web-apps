"use client";
// Settings, after Arc. Larger screens: a big dialog with the sections listed on the left
// (a field to find a setting above them, the version below) and the settings on the
// right as grouped rows. Phones: a full-height sheet with the sections stacked.
// Every section is always rendered, so deep links (#settings-<id>, settings-field-<id>)
// only have to scroll to it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackDismiss } from "@/lib/backstack";
import { downloadFile } from "@/lib/client";
import { useInstallPrompt, usePresence } from "@/lib/hooks";
import { alive, useStore, type ListKind } from "@/lib/store";
import { CURRENCIES } from "@/lib/types";
import { wipeThisDevice } from "@/lib/wipe";
import ApiKeysSection from "./ApiKeysSection";
import AppearanceSection from "./AppearanceSection";
import BriefStyleSection from "./BriefStyleSection";
import { useCloud } from "./cloud";
import { GoogleSyncPanel, useGoogleSync } from "./googleSync";
import { RemoveSamplesButton, SampleDataButton } from "./SampleData";
import { startOnboarding } from "./Onboarding";
import SettingsSection, { SettingsBlock, SettingsGroup, SettingsRow, Switch, takeRevealedSection } from "./SettingsSection";
import TypeToConfirm from "./TypeToConfirm";
import { Icon, useToast } from "./ui";

const KOFI_URL = "https://ko-fi.com/lynnarize";
/** The native Mac app's latest release (a disk image) on GitHub. */
const MAC_DOWNLOAD_URL = "https://github.com/lynnarize/fournotes-macos/releases/latest";
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION;
const COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT;

type SectionId = "appearance" | "today" | "api" | "general" | "sync" | "install" | "privacy" | "about";

/** In the order they appear. The ids are the deep-link names (openSettings("api"), …). */
const SECTIONS: { id: SectionId; title: string; icon: string; description?: string; keywords: string }[] = [
  { id: "appearance", title: "Appearance", icon: "palette", description: "Changes apply straight away, on this device.", keywords: "theme look light dark paper system device accent colour color" },
  { id: "today", title: "Today", icon: "today", keywords: "daily brief greeting paragraph point by point" },
  { id: "api", title: "AI and keys", icon: "sparkle", keywords: "assistant api key keys openrouter opencode claude anthropic model free paid voyage speech text transcription whisper groq" },
  { id: "general", title: "General", icon: "settings", keywords: "name currency money voice replies speak notifications reminders setup first run" },
  { id: "sync", title: "Backup and sync", icon: "cloud", description: "Everything is saved in this browser. Sync keeps a copy in your own account.", keywords: "google drive supabase account sign in out spaces shared invite join email" },
  { id: "install", title: "Install app", icon: "download", keywords: "mac macos desktop offline home screen pwa iphone ipad android" },
  { id: "privacy", title: "Data and privacy", icon: "shield", keywords: "data privacy export import backup file sample delete erase local terms policy keys" },
  { id: "about", title: "About", icon: "info", keywords: "version commit update coffee support ko-fi" },
];

const PRIVACY_POINTS = [
  { icon: "shield", title: "Saved on this device", text: "Everything you add is stored in this browser. Nothing leaves it unless you use AI features or turn on sync." },
  { icon: "sparkle", title: "Shared with AI only when you ask", text: "Chat messages, scanned photos and voice recordings are sent to the AI provider to be read. The results are saved here." },
  { icon: "cloud", title: "Sync is optional", text: "With Google Drive sync on, a copy is kept in a private app folder in your own Drive. You can delete it any time." },
  { icon: "key", title: "Your API keys stay private", text: "Keys are kept in this browser only. They are never synced or included in backups." },
];

const CLOUD_STATUS = { off: "Off", "signed-out": "Signed out", syncing: "Syncing…", synced: "Synced", offline: "Offline", error: "Sync error" } as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const matches = (s: (typeof SECTIONS)[number], q: string) => {
  const hay = `${s.title} ${s.keywords}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
};

/** Kit controls, grown to 44px on phones. */
const FIELD = "field max-md:h-11";
const SMALL = "btn btn-sm max-md:h-11";
const linkClass = "text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-[var(--foreground)]";

function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return match;
}

/** A square tile before a row's label. */
const Tile = ({ icon }: { icon: string }) => (
  <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[var(--surface-muted)] text-[var(--text-secondary)]">
    <Icon name={icon} size={18} />
  </span>
);

function FindField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">Find a setting</label>
      <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Find a setting"
        autoComplete="off"
        className={`${FIELD} pl-9 pr-3`}
      />
    </div>
  );
}

export default function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const { settings, updateSettings, all } = store;
  const cloud = useCloud();
  const google = useGoogleSync();
  const toast = useToast();
  const install = useInstallPrompt();
  const [email, setEmail] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));
  const [confirmWipe, setConfirmWipe] = useState(false);

  // ---- The dialog -------------------------------------------------------------------
  const { mounted, state } = usePresence(open);
  useBackDismiss(open, onClose);
  const wide = useMedia("(min-width: 768px)");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<SectionId>("appearance");
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** While a click in the list scrolls the page, the list keeps the clicked section lit. */
  const holdSpy = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const revealed = takeRevealedSection();
    setActive(SECTIONS.find((s) => s.id === revealed)?.id ?? "appearance");
    const previous = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => dialogRef.current?.focus({ preventScroll: true }), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A confirmation opened from here (its own dialog) closes first.
      const inOther = (e.target as HTMLElement | null)?.closest?.('[role="dialog"]');
      if (inOther && inOther !== dialogRef.current) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = q ? SECTIONS.filter((s) => matches(s, q)) : SECTIONS;

  const onScroll = () => {
    const box = scrollRef.current;
    if (!box || Date.now() < holdSpy.current || visible.length === 0) return;
    const top = box.getBoundingClientRect().top;
    let current = visible[0].id;
    for (const s of visible) {
      const el = document.getElementById(`settings-${s.id}`);
      if (el && el.getBoundingClientRect().top - top <= 120) current = s.id;
    }
    // At the very end, the last section is the one being read.
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) current = visible[visible.length - 1].id;
    setActive(current);
  };

  const jump = (id: SectionId) => {
    setActive(id);
    holdSpy.current = Date.now() + 800;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  };

  // ---- Settings ---------------------------------------------------------------------
  const counts = { notes: alive(all.notes).length, tasks: alive(all.todos).length, transactions: alive(all.transactions).length };
  const syncOn = Boolean(google.email || cloud.email);

  const attempt = async (fn: () => Promise<void>, ok?: string) => {
    setWorking(true);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), "error"); } finally { setWorking(false); }
  };

  const changeCurrency = (currency: string) => {
    if (currency === settings.currency) return;
    updateSettings({ currency });
    // Stored rates were relative to the old base currency; refetch them.
    for (const t of all.transactions) if (t.fxRate != null) store.updateTransaction(t.id, { fxRate: null });
    toast(`Base currency is now ${currency}. Budgets stay as numbers; adjust them if needed.`);
  };

  const exportBackup = () =>
    downloadFile(`four-notes-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(all, null, 2), "application/json");

  const importBackup = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      for (const kind of ["notes", "todos", "transactions", "stickies"] as ListKind[]) {
        if (Array.isArray(data[kind])) store.mergeRemote(kind, data[kind]);
      }
      if (data.settings?.budgets) updateSettings({ budgets: { ...settings.budgets, ...data.settings.budgets } });
      toast("Backup imported. The newer version of each item was kept.");
    } catch {
      toast("That file isn't a Four Notes backup.", "error");
    }
  };

  const deleteLocal = () => wipeThisDevice();

  const body: Record<SectionId, ReactNode> = {
    appearance: <AppearanceSection />,

    today: <BriefStyleSection />,

    api: <ApiKeysSection />,

    general: (
      <SettingsGroup>
        <SettingsRow label="Your name" description="Used in the daily brief" htmlFor="settings-name" wide>
          <input
            id="settings-name"
            key={settings.name ?? ""}
            defaultValue={settings.name ?? ""}
            onBlur={(e) => updateSettings({ name: e.target.value.trim() || undefined })}
            autoComplete="given-name"
            className={`${FIELD} w-full sm:w-56`}
          />
        </SettingsRow>
        <SettingsRow label="Base currency" description="Totals and budgets are counted in it" htmlFor="settings-currency">
          <select id="settings-currency" value={settings.currency} onChange={(e) => changeCurrency(e.target.value)} className={`${FIELD} w-auto`}>
            {[...new Set([settings.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow label="Speak replies aloud" description="In voice mode, the assistant reads its answers out">
          {(labelId) => <Switch checked={settings.voiceReplies} onChange={(v) => updateSettings({ voiceReplies: v })} labelledBy={labelId} />}
        </SettingsRow>
        <SettingsRow
          label="Notifications"
          description={perm === "granted" ? "Reminders arrive when tasks are due" : perm === "denied" ? "Blocked in your browser's settings for this site" : "Turn on to be reminded when tasks are due"}
        >
          {perm === "default" ? (
            <button type="button" className={`${SMALL} btn-secondary`} onClick={() => Notification.requestPermission().then(setPerm)}>Turn on</button>
          ) : (
            <span className={`badge ${perm === "granted" ? "badge-success badge-dot" : ""}`}>{perm === "granted" ? "On" : "Blocked"}</span>
          )}
        </SettingsRow>
        <SettingsRow label="First-time setup" description="Walk through the setup again. Nothing you have is changed">
          <button type="button" className={`${SMALL} btn-secondary`} onClick={() => { onClose(); startOnboarding(); }}>Run setup again</button>
        </SettingsRow>
      </SettingsGroup>
    ),

    sync: (
      <div className="flex flex-col gap-4">
        {google.enabled && (
          <SettingsGroup>
            <SettingsBlock><GoogleSyncPanel /></SettingsBlock>
          </SettingsGroup>
        )}

        {cloud.enabled && (
          <SettingsGroup label="Supabase sync and shared spaces">
            {google.enabled && (
              <SettingsBlock><p className="font-medium">Supabase sync and shared spaces</p></SettingsBlock>
            )}
            {!cloud.email ? (
              <SettingsBlock className="flex flex-col gap-3">
                <p className="text-[13px] text-[var(--text-secondary)]">Sign in to back up, sync and share spaces. Everything already on this device is uploaded on first sign-in.</p>
                <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); attempt(() => cloud.sendMagicLink(email), "Check your email for the sign-in link."); }}>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={`${FIELD} min-w-0 flex-1 basis-56`} aria-label="Email" autoComplete="email" />
                  <button className="btn btn-primary max-md:h-11" disabled={working}>Email me a link</button>
                </form>
              </SettingsBlock>
            ) : (
              <>
                <SettingsRow
                  label={<span className="break-all">{cloud.email}</span>}
                  description={
                    <span className="fn-num">
                      {CLOUD_STATUS[cloud.status]}
                      {cloud.lastSyncedAt ? `, ${new Date(cloud.lastSyncedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
                    </span>
                  }
                >
                  <button type="button" className={`${SMALL} btn-secondary`} onClick={cloud.syncNow}>Sync now</button>
                  <button type="button" className={`${SMALL} btn-plain`} onClick={() => attempt(cloud.signOut)}>Sign out</button>
                </SettingsRow>
                {cloud.error && (
                  <SettingsBlock><p className="text-[13px] text-[var(--danger)]" role="alert">{cloud.error}</p></SettingsBlock>
                )}
                <SettingsBlock className="flex flex-col gap-3">
                  <p className="font-medium">Shared spaces</p>
                  <ul className="flex flex-col">
                    {store.spaces.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 py-1">
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        {s.inviteCode && (
                          <button
                            type="button"
                            className={`${SMALL} btn-secondary fn-num`}
                            title="Copy invite code"
                            aria-label={`Copy invite code ${s.inviteCode}`}
                            onClick={() => navigator.clipboard.writeText(s.inviteCode!).then(() => toast("Invite code copied. Share it with the people you want to invite."))}
                          >
                            <Icon name="copy" size={14} /> {s.inviteCode}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${SMALL} btn-danger`}
                          onClick={() => window.confirm(`Leave “${s.name}”? You'll lose access to its shared items.`) && attempt(() => cloud.leaveSpace(s.id), "Left space")}
                        >
                          Leave
                        </button>
                      </li>
                    ))}
                    {store.spaces.length === 0 && <li className="text-[13px] text-[var(--text-muted)]">No shared spaces yet.</li>}
                  </ul>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (spaceName.trim()) attempt(() => cloud.createSpace(spaceName.trim()), "Space created").then(() => setSpaceName("")); }}>
                      <input value={spaceName} onChange={(e) => setSpaceName(e.target.value)} placeholder="New space, e.g. Home" className={`${FIELD} min-w-0 flex-1`} aria-label="New space name" />
                      <button className="btn btn-secondary max-md:h-11" disabled={working}>Create</button>
                    </form>
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) attempt(() => cloud.joinSpace(code.trim()), "Joined space").then(() => setCode("")); }}>
                      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" className={`${FIELD} min-w-0 flex-1`} aria-label="Invite code" />
                      <button className="btn btn-secondary max-md:h-11" disabled={working}>Join</button>
                    </form>
                  </div>
                </SettingsBlock>
              </>
            )}
          </SettingsGroup>
        )}

        {!google.enabled && !cloud.enabled && (
          <SettingsGroup>
            <SettingsBlock>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                Sync is off, so your data stays in this browser. To let people sync with their Google account, add a Google OAuth client
                (<code className="rounded bg-[var(--surface-muted)] px-1 text-[12px]">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> and{" "}
                <code className="rounded bg-[var(--surface-muted)] px-1 text-[12px]">GOOGLE_CLIENT_SECRET</code>) to the deployment. See GUIDE.md.
              </p>
            </SettingsBlock>
          </SettingsGroup>
        )}
      </div>
    ),

    install: (
      <SettingsGroup>
        {/* The native Mac app: everything here, plus the edge dock, Apple Intelligence and models on your Mac. */}
        <SettingsRow
          icon={<Tile icon="monitor" />}
          label="Four Notes for Mac"
          description="A native app with the edge dock, Apple Intelligence and offline models. macOS 26 or later, free."
          wide
        >
          <a href={MAC_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary max-md:h-11">
            <Icon name="download" size={15} /> Download for macOS
          </a>
        </SettingsRow>
        {install ? (
          <SettingsRow label="This device" description="Install Four Notes to use it offline and share photos into it">
            <button type="button" className={`${SMALL} btn-secondary`} onClick={install}>Install</button>
          </SettingsRow>
        ) : (
          <SettingsBlock className="flex flex-col gap-2">
            <p>Install on this device</p>
            <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              <li><span className="font-medium text-[var(--foreground)]">iPhone or iPad:</span> tap Share, then Add to Home Screen.</li>
              <li><span className="font-medium text-[var(--foreground)]">Android, Chrome or Edge:</span> open the browser menu or the install icon in the address bar.</li>
              <li>Once installed, the app works offline and can receive photos from the share sheet.</li>
            </ul>
          </SettingsBlock>
        )}
      </SettingsGroup>
    ),

    privacy: (
      <div className="flex flex-col gap-4">
        <SettingsGroup className="grid grid-cols-3 divide-x divide-[var(--border-subtle)]">
          {([["Notes", counts.notes], ["Tasks", counts.tasks], ["Transactions", counts.transactions]] as const).map(([label, n]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 px-4 py-4 sm:px-5">
              <span className="fn-display fn-num text-[28px]">{n}</span>
              <span className="truncate text-[13px] text-[var(--text-muted)]">{label}</span>
            </div>
          ))}
        </SettingsGroup>

        <SettingsGroup>
          {PRIVACY_POINTS.map((p) => (
            <SettingsRow key={p.title} icon={<Tile icon={p.icon} />} label={p.title} description={p.text} />
          ))}
          <SettingsBlock className="text-[13px] text-[var(--text-secondary)]">
            Full details in the <a href="/privacy" className={linkClass}>Privacy Policy</a> and the <a href="/terms" className={linkClass}>Terms of Service</a>.
          </SettingsBlock>
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            label="Sample data"
            description="A few example notes, tasks and transactions to try things out. They stay on this device and can be removed in one click."
            wide
          >
            <SampleDataButton className={`${SMALL} btn-secondary`} />
            <RemoveSamplesButton className={`${SMALL} btn-secondary`} />
          </SettingsRow>
          <SettingsRow label="Backup file" description="Save everything to a file, or restore from one. When importing, the newer version of each item is kept." wide>
            <button type="button" className={`${SMALL} btn-secondary`} onClick={exportBackup}>
              <Icon name="download" size={14} /> Export
            </button>
            <button type="button" className={`${SMALL} btn-secondary`} onClick={() => fileRef.current?.click()}>Import</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = ""; }} />
          </SettingsRow>
          <SettingsRow
            label="Local data"
            description="Erase all notes, tasks, spending, settings and saved API keys from this browser. A Google Drive copy, if you have one, isn't touched. This can't be undone."
            wide
          >
            <button type="button" className={`${SMALL} btn-danger`} onClick={() => setConfirmWipe(true)}>Delete all local data</button>
          </SettingsRow>
        </SettingsGroup>

        <TypeToConfirm
          open={confirmWipe}
          onClose={() => setConfirmWipe(false)}
          title="Delete all local data?"
          confirmLabel="Delete everything"
          onConfirm={deleteLocal}
        >
          <p>
            This permanently erases from this browser: {plural(counts.notes, "note")}, {plural(counts.tasks, "task")},{" "}
            {plural(counts.transactions, "transaction")}, your settings and budgets, and any saved API keys.
          </p>
          <p className="text-[var(--text-secondary)]">
            {google.email ? "The copy in your Google Drive is not touched. " : ""}It can&apos;t be undone.{" "}
            <button type="button" className={linkClass} onClick={exportBackup}>Export a backup first</button>
            {" "}if you might need it.
          </p>
        </TypeToConfirm>
      </div>
    ),

    about: (
      <SettingsGroup>
        <SettingsRow label="Version" description="The web app updates itself: reloading the page always runs the latest version.">
          <span className="fn-num select-text text-[var(--text-secondary)]">{VERSION}</span>
        </SettingsRow>
        {COMMIT && (
          <SettingsRow label="Commit">
            <span className="fn-num select-text text-[var(--text-secondary)]">{COMMIT}</span>
          </SettingsRow>
        )}
        <SettingsRow icon={<Tile icon="coffee" />} label="Enjoying Four Notes?" description="Four Notes is free. If it helps you, a coffee keeps it going." wide>
          <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary max-md:h-11">
            <Icon name="coffee" size={15} /> Buy me a coffee
          </a>
        </SettingsRow>
      </SettingsGroup>
    ),
  };

  if (!mounted || typeof document === "undefined") return null;

  const sections = visible.length ? (
    visible.map((s) => (
      <SettingsSection key={s.id} id={s.id} title={s.title} description={s.description}>
        {body[s.id]}
      </SettingsSection>
    ))
  ) : (
    <p className="text-[var(--text-secondary)]">No settings match “{query.trim()}”.</p>
  );

  return createPortal(
    <div className={`no-print fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6 ${open ? "" : "pointer-events-none"}`}>
      <div className="fn-backdrop absolute inset-0 bg-black/30" data-state={state} onMouseDown={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-label="Settings"
        tabIndex={-1}
        data-state={state}
        className={`${wide ? "fn-dialog" : "fn-sheet"} relative flex h-[calc(100dvh_-_max(env(safe-area-inset-top),12px)_-_8px)] w-full flex-col overflow-hidden rounded-t-[var(--radius-panel)] border border-b-0 border-[var(--border)] bg-[var(--surface)] text-sm shadow-[var(--shadow-floating)] outline-none md:h-[min(800px,100%)] md:max-w-[1120px] md:flex-row md:rounded-[var(--radius-surface)] md:border-b`}
      >
        {/* Larger screens: the sections, a field to find a setting, and the version. */}
        <nav aria-label="Settings sections" className="scroll-thin hidden w-[260px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--border)] bg-[var(--sidebar)] px-3 py-6 md:flex">
          <h2 className="fn-display px-3 text-[28px]">Settings</h2>
          <FindField id="settings-find" value={query} onChange={setQuery} />
          <ul className="flex flex-col gap-0.5">
            {visible.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => jump(s.id)} aria-current={active === s.id ? "true" : undefined} className="nav-row w-full text-left">
                  <Icon name={s.icon} size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {s.id === "sync" && <span className="text-xs font-normal text-[var(--text-muted)]">{syncOn ? "On" : "Off"}</span>}
                </button>
              </li>
            ))}
          </ul>
          <span className="flex-1" />
          <p className="fn-num px-3 text-xs text-[var(--text-muted)]">Four Notes {VERSION}</p>
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="absolute right-5 top-5 z-20 hidden h-10 w-10 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--text-secondary)] transition-colors hover:text-[var(--foreground)] md:grid"
          >
            <Icon name="x" size={18} />
          </button>

          <div ref={scrollRef} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* Phones: the title, close, and the find field stay on top. */}
            <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface)] px-4 pb-3 pt-2 md:hidden">
              <div className="mx-auto h-1 w-10 rounded-full bg-[var(--border-strong)]" aria-hidden />
              <div className="flex items-center gap-2">
                <h2 className="fn-display flex-1 text-[28px]">Settings</h2>
                <button type="button" onClick={onClose} aria-label="Close settings" className="grid h-11 w-11 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--text-secondary)]">
                  <Icon name="x" size={18} />
                </button>
              </div>
              <FindField id="settings-find-phone" value={query} onChange={setQuery} />
            </div>

            <div className="flex max-w-[700px] flex-col gap-10 px-4 pb-[calc(env(safe-area-inset-bottom)+32px)] pt-6 md:pb-12 md:pl-12 md:pr-[72px] md:pt-8">
              {sections}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
