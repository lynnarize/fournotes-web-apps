"use client";
import { useCallback, useEffect, useState } from "react";
import { AssistantProvider } from "@/components/assistant";
import BackgroundJobs from "@/components/BackgroundJobs";
import ChatDock from "@/components/ChatDock";
import { CloudProvider } from "@/components/cloud";
import { GoogleSyncProvider } from "@/components/googleSync";
import CommandPalette from "@/components/CommandPalette";
import FinanceView from "@/components/FinanceView";
import Logo from "@/components/Logo";
import NotesView from "@/components/NotesView";
import Onboarding from "@/components/Onboarding";
import PwaSetup from "@/components/PwaSetup";
import SettingsModal from "@/components/SettingsModal";
import { revealSettingsSection } from "@/components/SettingsSection";
import Sidebar, { ChevronsUpDown, TABS } from "@/components/Sidebar";
import SampleBanner from "@/components/SampleData";
import TodayView from "@/components/TodayView";
import TodoView from "@/components/TodoView";
import { Icon, ToastProvider } from "@/components/ui";
import { useBackDismiss, useTabHistory } from "@/lib/backstack";
import { usePulsingTabs } from "@/lib/highlight";
import { usePresence } from "@/lib/hooks";
import { scrollToId, useOpenItem, useOpenSettings, useOpenTab } from "@/lib/nav";
import { StoreProvider, useStore } from "@/lib/store";
import type { Tab } from "@/lib/types";

const TITLES: Record<Tab, string> = { today: "Today", notes: "Notes", todo: "To-Do", finance: "Finance" };

export default function Page() {
  return (
    <StoreProvider>
      <ToastProvider>
        <CloudProvider>
          <GoogleSyncProvider>
            <Shell />
          </GoogleSyncProvider>
        </CloudProvider>
      </ToastProvider>
    </StoreProvider>
  );
}

function Shell() {
  const { ready, spaces, currentSpaceId } = useStore();
  const [tab, setTab] = useState<Tab>("today");
  const [menu, setMenu] = useState(false);
  const drawer = usePresence(menu, 220);
  useBackDismiss(menu, () => setMenu(false));
  // Back returns to the previous tab before it leaves the app.
  useTabHistory(tab, (t) => setTab(t as Tab));
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const spaceName = spaces.find((s) => s.id === currentSpaceId)?.name;
  const pulsing = usePulsingTabs().filter((t) => t !== tab);
  // Notes fills the height (its list and editor scroll on their own), and Today is one page
  // that fits the window; the other tabs scroll the page.
  const wide = tab === "notes";
  const fits = tab === "notes" || tab === "today";
  // Phones: the header stays on top; it gets a hairline once the page scrolls under it.
  const [scrolled, setScrolled] = useState(false);

  // Deep links from the manifest shortcuts: /?tab=finance
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && t in TITLES) setTab(t as Tab);
  }, []);

  // "Open on Today" from the assistant's panel, and anything else that names a place.
  useOpenTab(setTab);

  // Stickies only show on Today.
  useOpenItem("any", (f) => {
    setTab(f.kind === "sticky" ? "today" : f.kind === "note" || f.kind === "person" ? "notes" : f.kind === "todo" ? "todo" : "finance");
  });

  // ⌘K / Ctrl+K: search and quick add. ⌘, / Ctrl+,: Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === ",") {
        e.preventDefault();
        setPalette(false);
        setSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSettings = useCallback(() => setSettings(true), []);
  useOpenSettings(({ section, field }) => {
    if (section) revealSettingsSection(section);
    setMenu(false);
    setSettings(true);
    // Every section is always laid out in Settings, so it only has to be found and scrolled to.
    if (field) {
      scrollToId(`settings-field-${field}`, "center", (el) => {
        (el.querySelector<HTMLElement>("input") ?? el.querySelector<HTMLElement>("select"))?.focus({ preventScroll: true });
        return true;
      });
    } else if (section) {
      scrollToId(`settings-${section}`, "start");
    }
  });
  const closePalette = useCallback(() => setPalette(false), []);
  const sidebar = (onClose?: () => void) => (
    <Sidebar tab={tab} setTab={setTab} onClose={onClose} onSearch={() => setPalette(true)} onSettings={openSettings} />
  );

  return (
    <AssistantProvider onFiled={setTab}>
      <BackgroundJobs />
      {/* --tabbar-space: how much of the bottom edge the phone tab bar takes (0 on larger screens),
          for anything fixed to the bottom of the window. */}
      <div className="app-root flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)] [--tabbar-space:calc(env(safe-area-inset-bottom)+86px)] md:pt-0 md:[--tabbar-space:0px]">
        <PwaSetup />
        <SampleBanner />
        <div className="flex min-h-0 flex-1">
          {/* Sidebar: fixed on larger screens, a drawer behind the header's mark on phones */}
          <div className="hidden md:block">{sidebar()}</div>
          {drawer.mounted && (
            <div className={`fixed inset-0 z-40 md:hidden ${menu ? "" : "pointer-events-none"}`}>
              <button className="fn-backdrop absolute inset-0 bg-black/30" data-state={drawer.state} onClick={() => setMenu(false)} aria-label="Close menu" tabIndex={-1} />
              <div className="fn-drawer relative h-full w-fit shadow-[var(--shadow-floating)]" data-state={drawer.state}>{sidebar(() => setMenu(false))}</div>
            </div>
          )}

          <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
            {/* Phones: the mark (opens the menu: spaces, capture, voice, sync), search and settings. */}
            <header
              className={`sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-1 border-b bg-[var(--background)] px-2 pt-2 transition-colors md:hidden ${
                scrolled ? "border-[var(--border)]" : "border-transparent"
              }`}
            >
              <button
                type="button"
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-[22px] pl-2 pr-2.5 transition-colors hover:bg-[var(--hover)]"
                onClick={() => setMenu(true)}
                aria-label={`Open menu, space ${spaceName ?? "Personal"}`}
                aria-expanded={menu}
              >
                <Logo size={28} />
                <span className="truncate text-base font-medium">Four Notes</span>
                <ChevronsUpDown size={14} className="shrink-0 text-[var(--text-muted)]" />
              </button>
              <span className="flex-1" />
              <button type="button" className="btn btn-plain btn-icon h-11 w-11" onClick={() => setPalette(true)} aria-label="Search or add">
                <Icon name="search" size={20} />
              </button>
              <button type="button" className="btn btn-plain btn-icon h-11 w-11" onClick={openSettings} aria-label="Settings">
                <Icon name="settings" size={20} />
              </button>
            </header>

            {/* Every tab: same width, same side padding, same title position. */}
            <div key={tab} className={`fn-rise mx-auto w-full flex-1 px-4 md:px-8 ${fits ? "flex min-h-0 flex-col" : "pb-24"} ${wide ? "" : "max-w-[1500px]"}`}>
              {/* Today's greeting stands in for the title, and Notes has its own in the list. */}
              <h1 className={`fn-display mb-5 mt-5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 text-[34px] md:mb-6 md:mt-8 md:text-[36px] ${fits ? "sr-only" : ""}`}>
                {TITLES[tab]}
                {tab === "finance" && <span className="badge badge-info self-center font-[family-name:var(--font-body)] tracking-normal">Beta</span>}
                {spaceName && (
                  <span className="badge self-center font-[family-name:var(--font-body)] tracking-normal">
                    <Icon name="users" size={12} />
                    {spaceName}
                  </span>
                )}
              </h1>
              {!ready ? (
                <div className="text-sm text-[var(--text-muted)]">Loading…</div>
              ) : tab === "today" ? (
                <TodayView setTab={setTab} />
              ) : tab === "notes" ? (
                <NotesView />
              ) : tab === "todo" ? (
                <TodoView />
              ) : (
                <FinanceView setTab={setTab} />
              )}
            </div>

            {/* Today has the assistant in the middle of its page; everywhere else it's a pill in the corner. */}
            {tab !== "today" && <ChatDock minimized />}
          </main>
        </div>

        {/* Phones: the four places in a floating bar along the bottom. */}
        <nav aria-label="Main" className="shrink-0 px-3 pb-[calc(env(safe-area-inset-bottom)+16px)] md:hidden">
          <div className="flex rounded-[var(--radius-surface)] border border-[var(--border)] bg-[var(--surface)] p-1.5">
            {TABS.map((t) => {
              const on = tab === t.id;
              const pulse = pulsing.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={on ? "page" : undefined}
                  className={`fn-press relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-[28px] text-[11px] transition-colors ${
                    on ? "bg-[var(--accent-subtle)] font-medium text-[var(--foreground)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  <span className="relative">
                    <Icon name={t.icon} size={22} className={on ? "text-[var(--accent)]" : ""} />
                    {pulse && <span className="fn-ping absolute -right-1 -top-0.5" aria-hidden />}
                  </span>
                  {t.label}
                  {pulse && <span className="sr-only">, new from the assistant</span>}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
      <Onboarding />
      <CommandPalette open={palette} onClose={closePalette} setTab={setTab} onSettings={openSettings} />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </AssistantProvider>
  );
}
