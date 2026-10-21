"use client";
// First-run setup, over the whole window, as the macOS app has it (Views/OnboardingView.swift):
// a welcome that shows what the app does (Onboarding.dc.html), then asks only what it needs:
// how the day reads, how it looks, the assistant, a backup, the currency. It ends on a small
// celebration. Skippable at every step, and resumable if the Google sign-in sends the browser
// away mid-way. Each step blurs into the next.
import { useEffect, useState, type ReactNode } from "react";
import { useBackDismiss } from "@/lib/backstack";
import { BRIEF_STYLES, useBriefStyle, type BriefStyle } from "@/lib/briefParagraph";
import { saveUserKeys, useUserKeys, OPENROUTER_KEYS_URL } from "@/lib/byok";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { CURRENCIES } from "@/lib/types";
import { AccentSwatches, ThemeCards } from "./AppearanceSection";
import { GoogleSyncPanel, useGoogleSync } from "./googleSync";
import Logo from "./Logo";
import SecretInput from "./SecretInput";
import { Icon, useToast } from "./ui";

const KEY = "four-notes:onboarding";
const STEP_KEY = "four-notes:onboarding-step";
const START_EVT = "four-notes:onboarding-start";

export const needsOnboarding = () => {
  try { return localStorage.getItem(KEY) === "pending"; } catch { return false; }
};
/** Opens the wizard straight away: no reload, which would fight the back stack. */
export const startOnboarding = () => {
  try { localStorage.setItem(KEY, "pending"); localStorage.setItem(STEP_KEY, "0"); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(START_EVT));
};
const finishOnboarding = () => {
  try { localStorage.setItem(KEY, "done"); localStorage.removeItem(STEP_KEY); } catch { /* storage blocked */ }
};

type ServerStatus = { shared?: boolean; provider?: "anthropic" | "openrouter" | "demo"; sharedPerVisitorDaily?: number };

/** The steps, in order. The celebration comes after the last. */
const PAGES = ["welcome", "oneView", "brief", "nothingSlips", "look", "assistant", "backup", "money"] as const;
type Page = (typeof PAGES)[number];
const BACKUP = PAGES.indexOf("backup");
const CELEBRATION = PAGES.length;

/** The numbered stepper groups the steps into the stages people recognise. */
const STAGES: { label: string; pages: Page[] }[] = [
  { label: "Welcome", pages: ["welcome", "oneView", "brief", "nothingSlips"] },
  { label: "Look", pages: ["look"] },
  { label: "Assistant", pages: ["assistant"] },
  { label: "Backup", pages: ["backup"] },
  { label: "Money", pages: ["money"] },
];
const stageOf = (page?: Page) => (page ? STAGES.findIndex((s) => s.pages.includes(page)) : STAGES.length);

/** Side padding that grows with the window, as drawn. */
const GUTTER = "px-[clamp(16px,4vw,40px)]";

export default function Onboarding() {
  const store = useStore();
  const google = useGoogleSync();
  const { keys } = useUserKeys();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [forward, setForward] = useState(true);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [orKey, setOrKey] = useState("");
  const [notify, setNotify] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (!store.ready || !needsOnboarding()) return;
    setOpen(true);
    const saved = Number(localStorage.getItem(STEP_KEY) ?? "0");
    // Coming back from Google's consent screen lands on the backup step.
    const returned = new URLSearchParams(window.location.search).has("google") || google.email;
    setStep(returned ? BACKUP : Number.isFinite(saved) ? Math.min(Math.max(saved, 0), PAGES.length - 1) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready]);

  // "Run first-time setup again" from Settings.
  useEffect(() => {
    const onStart = () => { setStep(0); setOpen(true); };
    window.addEventListener(START_EVT, onStart);
    return () => window.removeEventListener(START_EVT, onStart);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
    setNotify(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, [open]);

  const go = (delta: number) => {
    const next = Math.min(CELEBRATION, Math.max(0, step + delta));
    setForward(delta > 0);
    setStep(next);
    try { localStorage.setItem(STEP_KEY, String(Math.min(next, PAGES.length - 1))); } catch { /* storage blocked */ }
  };

  const close = (message?: string) => {
    finishOnboarding();
    setOpen(false);
    if (message) toast(message);
  };

  // Back goes to the previous step; on the first step it closes the wizard.
  useBackDismiss(open, () => {
    if (step === 0) return close("You can set this up any time in Settings.");
    go(-1);
    return true; // still open: keep a back entry for the next press
  });

  const page = PAGES[step] as (typeof PAGES)[number] | undefined;
  const celebrating = step === CELEBRATION;

  const primary = () => {
    if (page === "assistant" && orKey.trim()) {
      saveUserKeys({ ...keys, openrouterKey: orKey.trim() }, true);
      toast("🔑 Key saved. The assistant is ready.");
    }
    if (celebrating) close();
    else go(1);
  };

  // Enter moves on, as the default button does on the Mac, but not while typing in a field.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "Enter" || e.isComposing || ["TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName)) return;
      if (t.tagName === "INPUT" && page !== "assistant") return;
      e.preventDefault();
      primary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  const primaryTitle = page === "welcome" ? "Get started" : page === "look" ? "Looks good"
    : page === "assistant" ? (orKey.trim() ? "Save and continue" : "Continue")
    : page === "money" ? "I'm ready" : celebrating ? "Open Four Notes" : "Continue";
  const skip = () => (page === "assistant" ? go(1) : close("You can set this up any time in Settings."));
  // "Explore with sample data": fill the app with examples and look around now.
  const explore = () => {
    if (!store.hasSamples) store.loadSamples();
    close("Sample data loaded. Remove it any time from the banner at the top or in Settings.");
  };
  const stage = stageOf(page);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Set up Four Notes"
      className="no-print fixed inset-0 z-[65] flex flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
    >
      <header className={`flex shrink-0 items-center gap-3 pb-2 pt-[calc(env(safe-area-inset-top)+20px)] ${GUTTER}`}>
        <Logo size={34} />
        <span className="flex-1 text-base font-medium">Four Notes</span>
        {!celebrating && (
          <button
            type="button"
            className="btn btn-plain max-md:h-11"
            onClick={skip}
            title={page === "assistant" ? "Set up the assistant later in Settings" : undefined}
          >
            {page === "assistant" ? "Not now" : "Skip setup"}
          </button>
        )}
      </header>

      <div className="scroll-thin flex min-h-0 flex-1 overflow-y-auto">
        <div key={step} data-dir={forward ? "fwd" : "back"} className={`fn-step m-auto w-full max-w-[1280px] py-6 ${GUTTER}`}>
          {page === "welcome" && (
            <div className="flex flex-wrap items-center gap-12">
              <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-7">
                <h2 className="fn-display text-[44px] sm:text-[56px] lg:text-[64px]">Four notebooks.<br />One calm place.</h2>
                <p className="max-w-[460px] text-lg leading-relaxed text-[var(--text-secondary)]">
                  Notes, to-dos, spending and an assistant that files things for you, together in one fast app.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className="btn btn-primary h-[50px] rounded-[25px] px-6 text-base" onClick={primary}>
                    Get started <Icon name="arrowRight" size={18} />
                  </button>
                  <button type="button" className="btn btn-secondary h-[50px] rounded-[25px] border-[var(--border-strong)] px-[22px] text-base font-normal" onClick={explore}>
                    Explore with sample data
                  </button>
                </div>
                <p className="text-[13px] text-[var(--text-muted)]">About a minute. Every step can be skipped and changed later in Settings.</p>
                <Stepper current={0} className="mt-3" />
              </div>
              <WelcomePicture />
            </div>
          )}
          {page === "oneView" && (
            <Centered title="Your day, on one calm page" lead="What's due, what you spent and what you jotted down, sorted by what needs you now.">
              <TodayMock />
            </Centered>
          )}
          {page === "brief" && (
            <Centered title="How should your day read?" lead="A few sentences with the details a click away, or everything point by point. Change it any time in Settings.">
              <BriefTiles />
            </Centered>
          )}
          {page === "nothingSlips" && (
            <Split picture={<RemindMock />} pictureFirst>
              <Title>Nothing slips<br />through</Title>
              <Lead>Say “remind me to pay rent Friday” and Four Notes reminds you on Friday. A receipt photo becomes spending; a voice memo becomes a note with its to-dos.</Lead>
            </Split>
          )}
          {page === "look" && (
            <Centered title="Make it yours" lead="Follow your device, or pick a look and keep it. Change it any time in Settings.">
              <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-6">
                <ThemeCards className="grid w-full grid-cols-2 gap-3 text-left sm:grid-cols-4" />
                <div className="flex flex-col items-center gap-2">
                  <span id="onboarding-accent" className="text-[13px] text-[var(--text-secondary)]">Accent, for what&apos;s selected or active</span>
                  <AccentSwatches labelledBy="onboarding-accent" className="justify-center" />
                </div>
              </div>
            </Centered>
          )}
          {page === "assistant" && (
            <Centered
              title="Meet your assistant"
              lead={server?.shared
                ? `It already works here with free AI, about ${server.sharedPerVisitorDaily ?? 10} requests a day. Your own free key gives you your own allowance.`
                : "Paste a free OpenRouter key and it can read receipts, write your daily brief and answer questions. Without one, simple rule-based replies still work."}
            >
              <div className="mx-auto flex w-full max-w-[380px] flex-col items-center gap-3">
                {server?.shared && (
                  <p className="badge badge-success h-8 px-3 text-[13px]">
                    <Icon name="check" size={14} /> The assistant is ready to use
                  </p>
                )}
                <SecretInput
                  value={orKey}
                  onChange={(e) => setOrKey(e.target.value)}
                  placeholder="OpenRouter key (optional), sk-or-v1-…"
                  aria-label="OpenRouter API key"
                  className="field field-lg w-full"
                />
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Prefer Claude? Add its key in <span className="font-medium text-[var(--foreground)]">Settings, AI and keys</span>.
                </p>
                <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-[var(--foreground)]">
                  Get a free OpenRouter key <Icon name="arrowUpRight" size={14} />
                </a>
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
                <Trust icon="key">Keys stay in this browser</Trust>
                <Trust icon="cloud">Never synced or backed up</Trust>
                <Trust icon="trash">Delete any time</Trust>
              </div>
            </Centered>
          )}
          {page === "backup" && (
            <Centered title="Keep a copy safe" lead="Everything is saved in this browser. Back it up to your own Google Drive and it syncs across your devices.">
              <Card className="mx-auto w-full max-w-[480px] p-5 text-left text-sm">
                {google.enabled ? (
                  <GoogleSyncPanel />
                ) : (
                  <p className="text-[var(--text-secondary)]">Sync isn&apos;t set up on this app yet, so everything stays in this browser. You can export a backup file any time from Settings, Data and privacy.</p>
                )}
              </Card>
            </Centered>
          )}
          {page === "money" && (
            <Split picture={<FeatureOrbit />}>
              <Title>Bring your<br />money in</Title>
              <Lead>Pick the currency you count in. Budgets and categories can wait.</Lead>
              <label className="flex items-center gap-3 text-[var(--text-secondary)]">
                Currency
                <select
                  value={store.settings.currency}
                  onChange={(e) => store.updateSettings({ currency: e.target.value })}
                  className="field w-auto max-md:h-11"
                >
                  {[...new Set([store.settings.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              {store.hasSamples ? (
                <p className="text-[13px] text-[var(--text-muted)]">Sample data is loaded. Remove it any time in Settings.</p>
              ) : (
                <button
                  type="button"
                  className="min-h-11 self-start text-left text-[13px] text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-[var(--foreground)]"
                  onClick={() => { store.loadSamples(); toast("Sample data loaded. Remove it any time in Settings, Data and privacy."); }}
                >
                  Load a few samples to look around first
                </button>
              )}
            </Split>
          )}
          {celebrating && (
            <div className="flex flex-col items-center">
              <CelebrationRow />
              <p className="mt-9 max-w-[420px] text-center text-[var(--text-secondary)]">Your notebook is ready. Press / anywhere to ask the assistant.</p>
            </div>
          )}
        </div>
      </div>

      {page !== "welcome" && (
        <footer className={`flex shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4 ${GUTTER}`}>
          <div className="flex flex-1 justify-start">
            {celebrating ? (
              notify !== "unsupported" && (
                <button
                  type="button"
                  className="btn btn-secondary max-md:h-11"
                  disabled={notify !== "default"}
                  onClick={() => Notification.requestPermission().then(setNotify)}
                  title={notify === "denied" ? "Notifications are blocked for this site in the browser's settings" : undefined}
                >
                  <Icon name={notify === "granted" ? "check" : "bell"} size={15} />
                  {notify === "granted" ? "Reminders on" : notify === "denied" ? "Reminders blocked in the browser" : "Turn on reminders"}
                </button>
              )
            ) : (
              <button type="button" className="btn btn-plain max-md:h-11" onClick={() => go(-1)}>
                <Icon name="chevronLeft" size={16} /> Back
              </button>
            )}
          </div>
          {!celebrating && (
            <>
              <Stepper current={stage} className="hidden md:flex" />
              <span className="fn-num text-[13px] text-[var(--text-muted)] md:hidden">Step {stage + 1} of {STAGES.length}</span>
            </>
          )}
          <div className="flex flex-1 justify-end">
            <button type="button" className="btn btn-primary btn-lg" onClick={primary}>
              {primaryTitle} <span className="hidden text-xs opacity-60 sm:inline" aria-hidden>↵</span>
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

// ---- Layout pieces ------------------------------------------------------------------------

function Stepper({ current, className = "" }: { current: number; className?: string }) {
  return (
    <ol aria-label="Setup steps" className={`flex flex-wrap gap-x-5 gap-y-2 text-[13px] ${className}`}>
      {STAGES.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s.label} aria-current={now ? "step" : undefined} className={`flex items-center gap-2 ${now ? "font-medium" : "text-[var(--text-muted)]"}`}>
            <span
              aria-hidden
              className={`fn-num grid h-[22px] w-[22px] place-items-center rounded-full text-xs ${
                now ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : done ? "bg-[var(--accent-subtle)] text-[var(--foreground)]" : "border border-[var(--border-strong)]"
              }`}
            >
              {done ? <Icon name="check" size={12} /> : i + 1}
            </span>
            {s.label}
            {done && <span className="sr-only">, done</span>}
          </li>
        );
      })}
    </ol>
  );
}

const Title = ({ children, centered }: { children: ReactNode; centered?: boolean }) => (
  <h2 className={`fn-display text-[36px] sm:text-[44px] ${centered ? "text-center" : ""}`}>{children}</h2>
);
const Lead = ({ children }: { children: ReactNode }) => (
  <p className="max-w-[420px] text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">{children}</p>
);

/** Words on one side, a picture on the other; stacked on phones. */
function Split({ children, picture, pictureFirst }: { children: ReactNode; picture: ReactNode; pictureFirst?: boolean }) {
  return (
    <div className="mx-auto grid max-w-[1000px] items-center gap-10 md:grid-cols-2 md:gap-12">
      <div className={`flex flex-col gap-5 ${pictureFirst ? "md:order-2" : ""}`}>{children}</div>
      <div className={`flex justify-center ${pictureFirst ? "md:order-1" : ""}`}>{picture}</div>
    </div>
  );
}

function Centered({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col items-center text-center">
      <Title centered>{title}</Title>
      <p className="mt-4 max-w-[560px] text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">{lead}</p>
      <div className="mt-8 w-full">{children}</div>
    </div>
  );
}

/** A card resting on its border, the building block of every picture. */
const Card = ({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) => (
  <div className={`rounded-[22px] border border-[var(--border)] bg-[var(--surface)] ${className}`} style={style}>{children}</div>
);

/** Comes in once, a beat after the one before it. */
const arrive = (delay: number): React.CSSProperties => ({ animationDelay: `${delay}s` });

const MarkTile = ({ size = 56, className = "" }: { size?: number; className?: string }) => (
  <span
    className={`grid shrink-0 place-items-center border border-[var(--border)] bg-[var(--surface)] ${className}`}
    style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
  >
    <Logo size={Math.round(size * 0.62)} />
  </span>
);

/** An item's kind, as a quiet tile. */
const Glyph = ({ icon, size = 40, accent }: { icon: string; size?: number; accent?: boolean }) => (
  <span
    aria-hidden
    className={`grid shrink-0 place-items-center bg-[var(--surface-muted)] ${accent ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}
    style={{ width: size, height: size, borderRadius: Math.round(size * 0.35) }}
  >
    <Icon name={icon} size={Math.round(size * 0.5)} />
  </span>
);

const Trust = ({ icon, children }: { icon: string; children: ReactNode }) => (
  <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)]"><Icon name={icon} size={14} className="text-[var(--text-muted)]" />{children}</span>
);

// ---- Pictures -------------------------------------------------------------------------------

/** A very soft wash behind the welcome picture, per look. */
const WASH = {
  light: "linear-gradient(135deg, oklch(96.8% 0.02 300), oklch(97.6% 0.022 65))",
  paper: "linear-gradient(135deg, oklch(95.5% 0.025 60), oklch(96.5% 0.02 100))",
  dark: "linear-gradient(135deg, oklch(24% 0.02 300), oklch(24.5% 0.018 65))",
};

/** One message in, and the things the assistant filed from it. */
function WelcomePicture() {
  const { resolved } = useTheme();
  const rows = [
    { icon: "finance", title: "Kopi Kenangan", detail: "Finance, food and drink", trailing: "Rp 25,000", trailingClass: "font-medium" },
    { icon: "todo", title: "Pay the electricity bill", detail: "To-Do, reminder set", trailing: "Tomorrow, 9:00", trailingClass: "text-[13px] text-[var(--text-secondary)]" },
    { icon: "note", title: "Singapore trip", detail: "Notes, flights on the 12th, hotel near Bugis", trailing: "Yesterday", trailingClass: "text-[13px] text-[var(--text-muted)]", faded: true },
  ];
  return (
    <figure
      aria-label="How the assistant files things"
      className="m-0 flex min-w-0 flex-[1_1_480px] flex-col gap-3.5 rounded-[var(--radius-surface)] p-6 sm:p-10"
      style={{ background: WASH[resolved] }}
    >
      <p className="fn-arrive max-w-[380px] self-end rounded-[22px_22px_6px_22px] bg-[var(--accent)] px-4 py-3 text-[15px] leading-normal text-[var(--accent-foreground)]" style={arrive(0.1)}>
        Kopi Kenangan 25k, and pay the electricity bill tomorrow at 9
      </p>
      <p className="fn-arrive flex items-center gap-2 px-1 pt-1 text-[13px] text-[var(--text-secondary)]" style={arrive(0.35)}>
        <Icon name="sparkle" size={16} className="text-[var(--accent)]" />Filed 2 things
      </p>
      {rows.map((r, i) => (
        <Card key={r.title} className="fn-arrive flex items-center gap-3.5 p-4" style={{ ...arrive(0.45 + i * 0.12), opacity: r.faded ? 0.72 : undefined }}>
          <Glyph icon={r.icon} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium">{r.title}</span>
            <span className="truncate text-[13px] text-[var(--text-muted)]">{r.detail}</span>
          </span>
          <span className={`fn-num shrink-0 ${r.trailingClass}`}>{r.trailing}</span>
        </Card>
      ))}
    </figure>
  );
}

/** A small Today page: the sidebar, what's due, and the assistant's note. */
function TodayMock() {
  const line = (icon: string, title: string, detail: string, tag: string, tagClass = "text-[var(--text-muted)]") => (
    <div className="flex items-center gap-2">
      <Glyph icon={icon} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium">{title}</span>
        <span className="block text-[10px] text-[var(--text-muted)]">{detail}</span>
      </span>
      <span className={`fn-num text-[10px] ${tagClass}`}>{tag}</span>
    </div>
  );
  return (
    <div className="relative mx-auto h-[270px] w-full max-w-[540px] text-left">
      <Card className="fn-arrive absolute left-0 top-0 flex h-[250px] w-[min(440px,100%)] overflow-hidden" style={arrive(0.05)}>
        <div className="flex w-[42px] flex-col items-center gap-3.5 border-r border-[var(--border)] bg-[var(--sidebar)] pt-3">
          <Logo size={16} />
          {["today", "note", "todo", "finance"].map((i) => <Icon key={i} name={i} size={13} className={i === "today" ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />)}
        </div>
        <div className="flex-1 space-y-2 p-3.5">
          <div className="flex items-center justify-between text-[13px] font-medium">Today <Icon name="search" size={11} className="text-[var(--text-muted)]" /></div>
          <div className="pt-0.5 text-[10.5px] font-medium">Due today <span className="font-normal text-[var(--text-muted)]">2</span></div>
          {line("todo", "Pay the electricity bill", "9:00, Bills", "Due", "font-medium text-[var(--accent)]")}
          {line("todo", "Send the Q3 deck to Maya", "Before 5 PM", "2h")}
          <div className="pt-0.5 text-[10.5px] font-medium">Spent yesterday</div>
          {line("coffee", "Kopi Kenangan", "Food and drink", "Rp 25,000")}
          {line("cart", "Indomaret", "Groceries", "Rp 128,500")}
        </div>
      </Card>
      <Card className="fn-arrive absolute bottom-0 right-0 w-[200px] space-y-1.5 p-3" style={arrive(0.3)}>
        <div className="flex items-center gap-2">
          <MarkTile size={26} />
          <span>
            <span className="block text-[12.5px] font-medium">Assistant</span>
            <span className="block text-[10.5px] text-[var(--text-muted)]">One message, three things</span>
          </span>
        </div>
        {["A task for Friday", "Rp 45,000 at Warteg", "A note: “gift ideas”"].map((t) => (
          <div key={t} className="flex items-center gap-1.5 text-[11.5px]"><Icon name="check" size={10} className="text-[var(--success)]" />{t}</div>
        ))}
      </Card>
    </div>
  );
}

/** "Remind me…" and the task it becomes, typed out as it happens. */
function RemindMock() {
  const message = "Remind me to pay rent on Friday";
  const [typed, setTyped] = useState(0);
  const [filed, setFiled] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setTyped(message.length); setFiled(true); return; }
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setTyped(i);
      t = i < message.length ? setTimeout(tick, 34) : setTimeout(() => setFiled(true), 350);
    };
    t = setTimeout(tick, 450);
    return () => clearTimeout(t);
  }, []);
  return (
    <Card className="fn-arrive h-[230px] w-[360px] max-w-full space-y-3 p-4 text-left" style={arrive(0.05)}>
      <div className="flex items-center gap-2.5">
        <MarkTile size={30} />
        <span>
          <span className="block text-[13px] font-medium">Four Notes</span>
          <span className="block text-[11px] text-[var(--text-muted)]">Assistant</span>
        </span>
      </div>
      <div className="h-px bg-[var(--border-subtle)]" />
      <div className="flex justify-end pl-10">
        <span className="rounded-[18px_18px_6px_18px] bg-[var(--accent)] px-3 py-2 text-[13px] text-[var(--accent-foreground)]">{message.slice(0, typed)}{typed < message.length ? "▍" : ""}</span>
      </div>
      {filed && (
        <div className="fn-rise flex items-center gap-2.5 rounded-[18px] bg-[var(--surface-muted)] p-2.5">
          <Glyph icon="bell" size={30} accent />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">Pay rent</span>
            <span className="block text-[11.5px] text-[var(--text-muted)]">Friday, 9:00. I&apos;ll remind you</span>
          </span>
          <Icon name="check" size={13} className="text-[var(--success)]" />
        </div>
      )}
    </Card>
  );
}

/** Each way the brief can read, shown as a small live Today; a link or row lights up in turn. */
function BriefTiles() {
  const [style, setStyle] = useBriefStyle();
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setBeat((b) => b + 1), 1100);
    return () => clearInterval(id);
  }, []);
  const tile = (id: BriefStyle) => {
    const o = BRIEF_STYLES.find((b) => b.id === id)!;
    const selected = style === id;
    return (
      <button key={id} type="button" className="fn-arrive w-[280px] max-w-full text-left" style={arrive(id === "paragraph" ? 0.08 : 0.18)} onClick={() => setStyle(id)} role="radio" aria-checked={selected}>
        <Card
          className={`h-[164px] p-4 transition-[border-color,box-shadow] ${
            selected ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-subtle)]" : "hover:border-[var(--border-strong)]"
          }`}
        >
          <p className="text-[17px] font-medium">Good morning.</p>
          {id === "paragraph" ? (
            <p className="mt-2 text-[12.5px] leading-[1.75] text-[var(--text-secondary)]">
              {[["You have ", false], ["3 things due", true], [" today, starting with ", false], ["Call Budi", true], [" at 2:30 PM. Yesterday you spent ", false], ["Rp 120rb", true], [", mostly on food.", false]].reduce<{ out: ReactNode[]; link: number }>(
                (acc, [text, isLink], i) => {
                  if (isLink) {
                    const lit = acc.link === beat % 3;
                    acc.out.push(<span key={i} className={`underline underline-offset-2 transition-colors ${lit ? "text-[var(--accent)] decoration-[var(--accent)]" : "text-[var(--foreground)] decoration-[var(--border-strong)]"}`}>{text as string}</span>);
                    acc.link += 1;
                  } else acc.out.push(<span key={i}>{text as string}</span>);
                  return acc;
                },
                { out: [], link: 0 },
              ).out}
            </p>
          ) : (
            <div className="mt-2.5 space-y-[9px]">
              {([["✳︎", 150], ["○", 120], ["○", 170], ["⚠︎", 110]] as const).map(([g, w], i) => {
                const lit = beat % 4 === i;
                return (
                  <div key={i} className="flex items-center gap-[9px] transition-transform duration-300" style={{ transform: lit ? "translateX(3px)" : undefined }}>
                    <span className={`w-3 text-[10px] ${lit ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>{g}</span>
                    <span className="h-[5px] rounded-full transition-colors" style={{ width: w, background: lit ? "var(--accent)" : "var(--control-track)" }} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <span className={`mt-3 flex items-center gap-1.5 ${selected ? "font-medium" : "text-[var(--text-secondary)]"}`}>
          <Icon name={o.icon} size={15} /> {o.label}
          {id === "paragraph" && <span className="badge badge-info h-5 px-2 text-[11px]">Compact</span>}
          <span className={`ml-auto grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] ${selected ? "border-[var(--accent)]" : "border-[var(--border-strong)]"}`}>
            {selected && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
          </span>
        </span>
        <span className="mt-1 block text-[13px] text-[var(--text-muted)]">{o.detail}</span>
      </button>
    );
  };
  return <div role="radiogroup" aria-label="How the daily brief reads" className="flex flex-wrap justify-center gap-8 sm:gap-10">{tile("paragraph")}{tile("points")}</div>;
}

/** Everything the app does, around its mark. */
function FeatureOrbit() {
  const items = [["note", "Notes"], ["todo", "To-Do"], ["finance", "Finance"], ["scan", "Scan"], ["mic", "Voice"], ["search", "Search"]];
  const r = 124;
  return (
    <div className="relative h-[320px] w-[320px] max-w-full">
      <span className="absolute left-1/2 top-1/2 rounded-full border border-dashed border-[var(--border-strong)]" style={{ width: r * 2, height: r * 2, transform: "translate(-50%, -50%)" }} />
      <span className="fn-arrive absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={arrive(0.05)}><MarkTile size={70} /></span>
      {items.map(([icon, label], i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length;
        return (
          <span
            key={label}
            className="fn-arrive absolute flex flex-col items-center gap-[5px]"
            style={{ ...arrive(0.12 + i * 0.07), left: `calc(50% + ${Math.cos(a) * r}px)`, top: `calc(50% + ${Math.sin(a) * r + 8}px)`, transform: "translate(-50%, -50%)" }}
          >
            <span className="grid h-[42px] w-[42px] place-items-center rounded-[14px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
              <Icon name={icon} size={17} />
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The last page: what you just set up, in a row, with the mark raised. */
function CelebrationRow() {
  const left = ["note", "todo", "today"];
  const right = ["finance", "mic", "scan"];
  const tile = (icon: string) => (
    <span key={icon} className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-[16px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
      <Icon name={icon} size={20} />
    </span>
  );
  return (
    <div className="flex flex-col items-center gap-3.5">
      <h2 className="fn-arrive fn-display flex min-h-[50px] items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-[22px] text-center text-[26px] sm:text-[32px]" style={arrive(0.35)}>
        I&apos;ve just set up my Four Notes 🎉
      </h2>
      <div className="fn-arrive flex h-[76px] max-w-full items-center gap-2 overflow-visible rounded-[26px] border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 sm:gap-3" style={arrive(0.05)}>
        <span className="hidden gap-2 sm:flex sm:gap-3">{left.map(tile)}</span>
        <span className="fn-raise"><MarkTile size={74} /></span>
        <span className="hidden gap-2 sm:flex sm:gap-3">{right.map(tile)}</span>
      </div>
    </div>
  );
}
