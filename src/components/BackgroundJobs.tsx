"use client";
// Runs while the app is open. With a sync backend, move reminders and the
// month-end review to the server (cron + push notifications) so they work when
// the app is closed — see GUIDE.md.
import { useEffect, useRef } from "react";
import { looksLikeThinking } from "@/lib/ai/text";
import { api } from "@/lib/client";
import { baseAmount } from "@/lib/insights";
import { alive, useStore } from "@/lib/store";
import { useToast } from "./ui";

async function notify(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  // Through the service worker when available: required on Android, nicer on desktop.
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg) reg.showNotification(title, { body, tag, icon: "/icon.svg" });
  else new Notification(title, { body, tag });
}

export default function BackgroundJobs() {
  const store = useStore();
  const toast = useToast();
  const storeRef = useRef(store);
  storeRef.current = store;

  // 1) Reminders: check every 20 seconds (all spaces).
  useEffect(() => {
    if (!store.ready) return;
    const tick = () => {
      const { all, updateTodo } = storeRef.current;
      const now = Date.now();
      for (const t of alive(all.todos)) {
        if (t.done || t.reminded || !t.remindAt || new Date(t.remindAt).getTime() > now) continue;
        updateTodo(t.id, { reminded: true });
        toast(`Reminder: ${t.title}`);
        notify("Four Notes reminder", t.title, t.id);
      }
    };
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [store.ready, toast]);

  // 2) End-of-month review: when a new month starts, summarize last month once.
  const ran = useRef(false);
  useEffect(() => {
    if (!store.ready || ran.current) return;
    ran.current = true;
    const d = new Date();
    d.setDate(0); // last day of previous month
    const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const { transactions, summaries, settings, saveSummary } = storeRef.current;
    if (summaries.some((s) => s.month === prev && !looksLikeThinking(s.text))) return;
    const txs = alive(transactions).filter((t) => t.date.startsWith(prev));
    if (txs.length === 0 || !navigator.onLine) return;
    const cur = settings.currency;
    const total = txs.reduce((s, t) => s + Math.max(0, baseAmount(t, cur)), 0);
    api
      .monthlySummary(prev, cur, txs.map((t) => ({ merchant: t.merchant, amount: baseAmount(t, cur), category: t.category, date: t.date })))
      .then(({ text }) => {
        saveSummary({ month: prev, total, currency: cur, byCategory: {}, text, createdAt: new Date().toISOString() });
        toast(`Your ${d.toLocaleDateString("en-US", { month: "long" })} spending review is ready in Finance`);
      })
      .catch(() => {});
  }, [store.ready, toast]);

  // 3) Once the user has their own items, offer to remove the sample data.
  const offeredCleanup = useRef(false);
  useEffect(() => {
    if (!store.ready || offeredCleanup.current || !store.hasSamples) return;
    const { all } = storeRef.current;
    const own = [...alive(all.notes), ...alive(all.todos), ...alive(all.transactions)].filter((x) => !x.sample).length;
    if (own < 3) return;
    offeredCleanup.current = true;
    toast("You've added a few of your own items. Remove the sample data?", "ok", {
      label: "Remove",
      run: () => storeRef.current.clearSamples(),
    });
  }, [store.ready, store.hasSamples, store.all, toast]);

  // 4) Multi-currency: fetch exchange rates for foreign transactions that lack one.
  const triedFx = useRef(new Set<string>());
  const base = store.settings.currency;
  useEffect(() => {
    if (!store.ready || typeof navigator === "undefined" || !navigator.onLine) return;
    const missing = alive(store.all.transactions).filter((t) => t.currency !== base && t.fxRate == null);
    for (const cur of new Set(missing.map((t) => t.currency))) {
      const key = `${cur}>${base}`;
      if (triedFx.current.has(key)) continue;
      triedFx.current.add(key);
      api.fx(cur, base)
        .then(({ rate }) => {
          const { all, updateTransaction } = storeRef.current;
          for (const t of all.transactions) if (t.currency === cur && t.fxRate == null) updateTransaction(t.id, { fxRate: rate });
        })
        .catch(() => triedFx.current.delete(key));
    }
  }, [store.ready, store.all.transactions, base]);

  return null;
}
