"use client";
// Offline mode + installable app:
// - registers the service worker (production builds, or NEXT_PUBLIC_ENABLE_SW=1 in dev)
// - picks up images/text shared into the app via the OS share sheet (PWA share target)
// - shows a banner while offline
import { useEffect, useRef } from "react";
import { useOnline } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { useAssistant } from "./assistant";
import { Icon } from "./ui";

const SW_ENABLED = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "1";

export default function PwaSetup() {
  const { ready } = useStore();
  const { scan, send } = useAssistant();
  const online = useOnline();
  const handled = useRef(false);

  useEffect(() => {
    if (SW_ENABLED && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Service worker failed", e));
    }
  }, []);

  useEffect(() => {
    if (!ready || handled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("share")) return;
    handled.current = true;
    window.history.replaceState(null, "", "/");
    (async () => {
      if (!("caches" in window)) return;
      const cache = await caches.open("share-target");
      const [file, text] = await Promise.all([cache.match("/shared-file"), cache.match("/shared-text")]);
      await Promise.all([cache.delete("/shared-file"), cache.delete("/shared-text")]);
      if (file) await scan(await file.blob(), "share");
      else if (text) {
        const t = (await text.text()).trim();
        if (t) await send(t);
      }
    })();
  }, [ready, scan, send]);

  if (online) return null;
  return (
    <div
      className="no-print flex min-h-9 items-center justify-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--warning-subtle)] px-4 py-1.5 text-[13px] text-[var(--foreground)]"
      role="status"
    >
      <Icon name="wifiOff" size={14} className="shrink-0 text-[var(--warning)]" />
      Offline. Everything you add is still saved on this device; AI features resume when you reconnect.
    </div>
  );
}
