"use client";
import { useRef, useState } from "react";
import { activeProvider, useUserKeys } from "@/lib/byok";
import { downloadFile } from "@/lib/client";
import { useInstallPrompt } from "@/lib/hooks";
import { alive, useStore, type ListKind } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { CURRENCIES } from "@/lib/types";
import { wipeThisDevice } from "@/lib/wipe";
import ApiKeysSection from "./ApiKeysSection";
import AppearanceSection from "./AppearanceSection";
import BriefStyleSection from "./BriefStyleSection";
import { useBriefStyle } from "@/lib/briefParagraph";
import { useCloud } from "./cloud";
import { GoogleSyncPanel, useGoogleSync } from "./googleSync";
import { RemoveSamplesButton, SampleDataButton } from "./SampleData";
import { startOnboarding } from "./Onboarding";
import SettingsSection, { setAllSettingsSections } from "./SettingsSection";
import TypeToConfirm from "./TypeToConfirm";
import { Icon, inputBox, Modal, useToast } from "./ui";

const KOFI_URL = "https://ko-fi.com/lynnarize";
/** The native Mac app's latest release (a disk image) on GitHub. */
const MAC_DOWNLOAD_URL = "https://github.com/lynnarize/fournotes-macos/releases/latest";

const PRIVACY_POINTS = [
  { icon: "shield", title: "Saved on this device", text: "Everything you add is stored in this browser. Nothing leaves it unless you use AI features or turn on sync." },
  { icon: "sparkle", title: "Shared with AI only when you ask", text: "Chat messages, scanned photos and voice recordings are sent to the AI provider to be read. The results are saved here." },
  { icon: "cloud", title: "Sync is optional", text: "With Google Drive sync on, a copy is kept in a private app folder in your own Drive. You can delete it any time." },
  { icon: "key", title: "Your API keys stay private", text: "Keys are kept in this browser only. They are never synced or included in backups." },
];

const dangerBorder = { borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)" };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const { settings, updateSettings, all } = store;
  const cloud = useCloud();
  const google = useGoogleSync();
  const theme = useTheme();
  const [briefStyle] = useBriefStyle();
  const { keys } = useUserKeys();
  const ownProvider = activeProvider(keys);
  const aiKeySummary = ownProvider
    ? `Using your ${{ anthropic: "Anthropic", opencode: "OpenCode Go", openrouter: "OpenRouter" }[ownProvider]} key`
    : "No personal key";
  const toast = useToast();
  const install = useInstallPrompt();
  const [email, setEmail] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));

  const counts = { notes: alive(all.notes).length, tasks: alive(all.todos).length, transactions: alive(all.transactions).length };

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

  const [confirmWipe, setConfirmWipe] = useState(false);
  const deleteLocal = () => wipeThisDevice();

  const syncSummary = google.email
    ? `Google Drive · ${google.email}`
    : cloud.email
      ? `Supabase · ${cloud.email}`
      : google.enabled || cloud.enabled ? "Not connected" : "Off · data stays on this device";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      actions={
        <span className="flex shrink-0 items-center text-xs">
          <button className="min-h-11 rounded-md px-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] sm:min-h-8" onClick={() => setAllSettingsSections(true)}>Expand all</button>
          <button className="min-h-11 rounded-md px-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] sm:min-h-8" onClick={() => setAllSettingsSections(false)}>Collapse all</button>
        </span>
      }
    >
      <div className="space-y-3 p-4 text-sm">

        <SettingsSection id="appearance" icon="moon" title="Appearance" defaultOpen
          summary={theme.pref === "system" ? `System (${theme.resolved})` : theme.pref[0].toUpperCase() + theme.pref.slice(1)}>
          <AppearanceSection />
        </SettingsSection>

        <SettingsSection id="today" icon="today" title="Today" summary={briefStyle === "paragraph" ? "Brief as one paragraph" : "Brief point by point"}>
          <BriefStyleSection />
        </SettingsSection>

        <SettingsSection id="general" icon="settings" title="General"
          summary={`${settings.currency}${settings.name ? ` · ${settings.name}` : ""} · Notifications ${perm === "granted" ? "on" : "off"}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Your name (used in the daily brief)
              <input key={settings.name ?? ""} defaultValue={settings.name ?? ""} onBlur={(e) => updateSettings({ name: e.target.value.trim() || undefined })} className={`${inputBox} h-9`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Base currency
              <select value={settings.currency} onChange={(e) => changeCurrency(e.target.value)} className={`${inputBox} h-9`}>
                {[...new Set([settings.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.voiceReplies} onChange={(e) => updateSettings({ voiceReplies: e.target.checked })} />
              Speak replies aloud in voice mode
            </label>
            <button
              className="justify-self-start rounded-md border border-[var(--line)] px-3 py-1.5 text-sm hover:bg-[var(--hover)] sm:col-span-2 sm:justify-self-auto sm:w-fit"
              onClick={() => { onClose(); startOnboarding(); }}
            >
              Run first-time setup again
            </button>
            <div className="flex items-center gap-2">
              Notifications: <span className="text-[var(--muted)]">{perm === "granted" ? "On" : perm === "denied" ? "Blocked in browser settings" : "Off"}</span>
              {perm === "default" && (
                <button className="rounded-md border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--hover)]" onClick={() => Notification.requestPermission().then(setPerm)}>Turn on</button>
              )}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection id="sync" icon="cloud" title="Cloud sync" summary={syncSummary}>
          <div className="space-y-6">
            {google.enabled && <GoogleSyncPanel />}

            {cloud.enabled && (
              <div className="space-y-3">
                {google.enabled && <p className="border-t border-[var(--line)] pt-4 font-medium">Supabase sync & shared spaces</p>}
                {!cloud.email ? (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--muted)]">Sign in to back up, sync and share spaces. Everything already on this device is uploaded on first sign-in.</p>
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); attempt(() => cloud.sendMagicLink(email), "Check your email for the sign-in link."); }}>
                      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={`${inputBox} min-w-0 flex-1`} aria-label="Email" />
                      <button className="rounded-md border border-[var(--line)] px-3 py-1 hover:bg-[var(--hover)]" disabled={working}>Email me a link</button>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{cloud.email}</span>
                      <span className="chip">{cloud.status}{cloud.lastSyncedAt ? ` · ${new Date(cloud.lastSyncedAt).toLocaleTimeString("en-US")}` : ""}</span>
                      <button className="btn-ghost text-xs" onClick={cloud.syncNow}>Sync now</button>
                      <button className="btn-ghost ml-auto text-xs" onClick={() => attempt(cloud.signOut)}>Sign out</button>
                    </div>
                    {cloud.error && <p className="text-xs text-[var(--danger)]">{cloud.error}</p>}
                    <div>
                      <div className="mb-1 text-xs font-medium text-[var(--muted)]">Shared spaces</div>
                      <ul className="space-y-1">
                        {store.spaces.map((s) => (
                          <li key={s.id} className="flex items-center gap-2">
                            <span className="flex-1">{s.name}</span>
                            {s.inviteCode && (
                              <button className="chip hover:bg-[var(--line)]" title="Copy invite code"
                                onClick={() => navigator.clipboard.writeText(s.inviteCode!).then(() => toast("Invite code copied. Share it with the people you want to invite."))}>
                                invite: {s.inviteCode}
                              </button>
                            )}
                            <button className="btn-ghost text-xs text-[var(--danger)]"
                              onClick={() => window.confirm(`Leave “${s.name}”? You'll lose access to its shared items.`) && attempt(() => cloud.leaveSpace(s.id), "Left space")}>
                              Leave
                            </button>
                          </li>
                        ))}
                        {store.spaces.length === 0 && <li className="text-[var(--faint)]">No shared spaces yet.</li>}
                      </ul>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (spaceName.trim()) attempt(() => cloud.createSpace(spaceName.trim()), "Space created").then(() => setSpaceName("")); }}>
                          <input value={spaceName} onChange={(e) => setSpaceName(e.target.value)} placeholder="New space (e.g. Home)" className={`${inputBox} min-w-0 flex-1`} aria-label="New space name" />
                          <button className="btn-ghost border border-[var(--line)]" disabled={working}>Create</button>
                        </form>
                        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) attempt(() => cloud.joinSpace(code.trim()), "Joined space").then(() => setCode("")); }}>
                          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" className={`${inputBox} min-w-0 flex-1`} aria-label="Invite code" />
                          <button className="btn-ghost border border-[var(--line)]" disabled={working}>Join</button>
                        </form>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!google.enabled && !cloud.enabled && (
              <p className="text-xs leading-relaxed text-[var(--muted)]">
                Sync is off, so your data stays in this browser. To let people sync with their Google account, add a Google OAuth client
                (<code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>) to the deployment. See GUIDE.md.
              </p>
            )}
          </div>
        </SettingsSection>

        <SettingsSection id="api" icon="key" title="AI & API keys" summary={aiKeySummary}>
          <ApiKeysSection />
        </SettingsSection>

        <SettingsSection id="install" icon="download" title="Install app" summary="Use offline, or get the Mac app">
          {/* The native Mac app: everything here, plus the edge dock, Apple Intelligence and models on your Mac. */}
          <div className="mb-3 flex flex-col items-start gap-3 rounded-lg border border-[var(--line)] p-3 sm:flex-row sm:items-center">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--hover)]"><Icon name="monitor" size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Four Notes for Mac</span>
              <span className="block text-xs text-[var(--muted)]">A native app with the edge dock, Apple Intelligence and offline models. macOS 26 or later, free.</span>
            </span>
            <a
              href={MAC_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="fn-press inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--text)] px-3.5 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-90"
            >
              <Icon name="download" size={15} /> Download for macOS
            </a>
          </div>
          {install ? (
            <button className="rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--hover)]" onClick={install}>Install Four Notes on this device</button>
          ) : (
            <ul className="space-y-1.5 text-xs leading-relaxed text-[var(--muted)]">
              <li><b className="text-[var(--text)]">iPhone / iPad:</b> tap Share, then Add to Home Screen.</li>
              <li><b className="text-[var(--text)]">Android / Chrome / Edge:</b> open the browser menu or the install icon in the address bar.</li>
              <li>Once installed, the app works offline and can receive photos from the share sheet.</li>
            </ul>
          )}
        </SettingsSection>

        <SettingsSection id="privacy" icon="shield" title="Data & privacy"
          summary={[plural(counts.notes, "note"), plural(counts.tasks, "task"), plural(counts.transactions, "transaction")].join(" · ")}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {([["Notes", counts.notes], ["Tasks", counts.tasks], ["Transactions", counts.transactions]] as const).map(([label, n]) => (
                <div key={label} className="rounded-lg bg-[var(--hover)] px-2 py-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">{n}</div>
                  <div className="text-xs text-[var(--muted)]">{label}</div>
                </div>
              ))}
            </div>

            <dl className="space-y-3">
              {PRIVACY_POINTS.map((p) => (
                <div key={p.title} className="flex gap-2.5">
                  <Icon name={p.icon} size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                  <div>
                    <dt className="font-medium">{p.title}</dt>
                    <dd className="text-xs leading-relaxed text-[var(--muted)]">{p.text}</dd>
                  </div>
                </div>
              ))}
            </dl>
            <p className="text-xs text-[var(--muted)]">
              Full details: <a href="/privacy" className="text-[var(--accent)] underline">Privacy Policy</a> ·{" "}
              <a href="/terms" className="text-[var(--accent)] underline">Terms of Service</a>
            </p>

            <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
              <p className="font-medium">Sample data</p>
              <p className="text-xs text-[var(--muted)]">
                A few example notes, tasks and transactions to try things out. They stay on this device and can be removed in one click.
              </p>
              <div className="flex flex-wrap gap-2">
                <SampleDataButton />
                <RemoveSamplesButton />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
              <p className="font-medium">Backup</p>
              <p className="text-xs text-[var(--muted)]">Save everything to a file, or restore from one. When importing, the newer version of each item is kept.</p>
              <div className="flex flex-wrap gap-2">
                <button className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--hover)]" onClick={exportBackup}>
                  <Icon name="download" size={14} /> Export backup
                </button>
                <button className="rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--hover)]" onClick={() => fileRef.current?.click()}>Import backup</button>
                <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = ""; }} />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3" style={dangerBorder}>
              <p className="font-medium text-[var(--danger)]">Danger zone</p>
              <p className="text-xs text-[var(--muted)]">
                Erase all notes, tasks, spending, settings and saved API keys from this browser. A Google Drive copy, if you have one, isn&apos;t touched. This can&apos;t be undone.
              </p>
              <button className="rounded-md border px-3 py-1.5 text-[var(--danger)] hover:bg-[var(--hover)]" style={dangerBorder} onClick={() => setConfirmWipe(true)}>
                Delete all local data
              </button>
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
                <p className="text-[var(--muted)]">
                  {google.email ? "The copy in your Google Drive is not touched. " : ""}It can&apos;t be undone.{" "}
                  <button type="button" className="text-[var(--accent)] underline" onClick={exportBackup}>Export a backup first</button>
                  {" "}if you might need it.
                </p>
              </TypeToConfirm>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection id="about" icon="info" title="About" summary={`Version ${process.env.NEXT_PUBLIC_APP_VERSION}`}>
          <div className="flex flex-wrap gap-x-8 gap-y-2 select-text">
            <div>
              <div className="text-xs text-[var(--muted)]">Version</div>
              <div className="font-medium tabular-nums">{process.env.NEXT_PUBLIC_APP_VERSION}</div>
            </div>
            {process.env.NEXT_PUBLIC_APP_COMMIT && (
              <div>
                <div className="text-xs text-[var(--muted)]">Commit</div>
                <div className="font-medium tabular-nums">{process.env.NEXT_PUBLIC_APP_COMMIT}</div>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--faint)]">The web app updates itself: reloading the page always runs the latest version.</p>
        </SettingsSection>

        <div className="flex flex-col items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--hover)] p-4 sm:flex-row sm:items-center">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FF5E5B]/15 text-[#FF5E5B]">
            <Icon name="coffee" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Enjoying Four Notes?</p>
            <p className="text-xs text-[var(--muted)]">Four Notes is free. If it helps you, a coffee keeps it going.</p>
          </div>
          <a
            href={KOFI_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#FF5E5B] px-4 py-2 font-medium text-white hover:brightness-110"
          >
            <Icon name="coffee" size={16} /> Buy me a coffee
          </a>
        </div>
      </div>
    </Modal>
  );
}
