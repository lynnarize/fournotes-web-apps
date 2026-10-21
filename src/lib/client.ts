"use client";
// Browser-side helpers: API calls, image resizing, calendar links, file export.
import { authHeaders } from "./byok";
import type { BriefInput, CaptureResult, ChatMessage, ChatResponse, ClientContext, Todo } from "./types";

async function asJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const offlineGuard = () => {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You're offline. This needs internet; it will work again once you reconnect.");
};

export const api = {
  /**
   * `tools: false` asks for an answer only: nothing can be filed.
   * `signal` stops waiting for the reply (the Stop button); the request then rejects with an AbortError.
   */
  chat: async (messages: ChatMessage[], context: ClientContext, opts?: { tools?: boolean; signal?: AbortSignal }) => {
    offlineGuard();
    return fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ messages, context, tools: opts?.tools !== false }),
      signal: opts?.signal,
    }).then((r) => asJson<ChatResponse>(r));
  },

  /** "Ideas from the web" for a note (needs Claude: web search is Anthropic's). */
  webIdeas: async (title: string, content: string, question: string) => {
    offlineGuard();
    return fetch("/api/ai/web-ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ title, content, question }),
    }).then((r) => asJson<{ text: string; sources: { title: string; url: string }[] }>(r));
  },

  captureImage: async (file: Blob, context: ClientContext) => {
    offlineGuard();
    const fd = new FormData();
    fd.append("file", file, "capture.jpg");
    fd.append("context", JSON.stringify(context));
    return fetch("/api/ingest/image", { method: "POST", body: fd, headers: await authHeaders() }).then((r) => asJson<CaptureResult>(r));
  },

  captureAudio: async (audio: Blob | null, transcript: string, context: ClientContext) => {
    offlineGuard();
    const fd = new FormData();
    if (audio) fd.append("file", audio, "recording.webm");
    fd.append("transcript", transcript);
    fd.append("context", JSON.stringify(context));
    return fetch("/api/ingest/audio", { method: "POST", body: fd, headers: await authHeaders() }).then((r) =>
      asJson<CaptureResult & { transcript: string }>(r),
    );
  },

  /** Notes editor AI menu: summarize / improve / fix / shorter / continue. */
  write: async (task: "summarize" | "improve" | "fix" | "shorter" | "continue", text: string, title: string) => {
    offlineGuard();
    return fetch("/api/ai/write", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ task, text, title }),
    }).then((r) => asJson<{ text: string }>(r));
  },

  monthlySummary: async (month: string, currency: string, transactions: unknown[]) => {
    offlineGuard();
    return fetch("/api/finance/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ month, currency, transactions }),
    }).then((r) => asJson<{ text: string }>(r));
  },

  brief: async (input: BriefInput) => {
    offlineGuard();
    return fetch("/api/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    }).then((r) => asJson<{ text: string }>(r));
  },

  fx: async (from: string, to: string) => {
    offlineGuard();
    return fetch(`/api/fx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then((r) => asJson<{ rate: number }>(r));
  },
};

/** Downscale a photo before upload: faster, cheaper, and still readable for OCR. */
export async function resizeImage(file: Blob, maxSide = 1600): Promise<{ blob: Blob; dataUrl: string; thumb: string }> {
  const bitmap = await createImageBitmap(file);
  const draw = (side: number, quality: number) => {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const dataUrl = draw(maxSide, 0.85);
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, dataUrl, thumb: draw(320, 0.6) }; // small thumb to keep localStorage light
}

// ---- Calendar -----------------------------------------------------------
const gcalDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Opens Google Calendar prefilled — works without OAuth. Recurring tasks become recurring events. */
export function googleCalendarUrl(todo: Todo) {
  const start = todo.dueAt ?? todo.remindAt ?? new Date().toISOString();
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: todo.title,
    details: todo.notes ?? "Created with Four Notes",
    dates: `${gcalDate(start)}/${gcalDate(end)}`,
  });
  if (todo.rrule) p.set("recur", `RRULE:${todo.rrule.replace(/^RRULE:/i, "")}`);
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** .ics file for Apple Calendar / Outlook, with a built-in alarm. */
export function downloadIcs(todo: Todo) {
  const start = todo.dueAt ?? todo.remindAt ?? new Date().toISOString();
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Four Notes//EN", "BEGIN:VEVENT",
    `UID:${todo.id}@fournotes`, `DTSTAMP:${gcalDate(new Date().toISOString())}`,
    `DTSTART:${gcalDate(start)}`, `DTEND:${gcalDate(end)}`, `SUMMARY:${esc(todo.title)}`,
    `DESCRIPTION:${esc(todo.notes ?? "")}`,
    ...(todo.rrule ? [`RRULE:${todo.rrule.replace(/^RRULE:/i, "")}`] : []),
    "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", `DESCRIPTION:${esc(todo.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  downloadFile(`${todo.title.slice(0, 40)}.ics`, ics, "text/calendar");
}

// ---- Files --------------------------------------------------------------
export function downloadFile(name: string, content: string | Blob, type = "text/plain") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV with a BOM so Excel opens UTF-8 (Rupiah signs, Indonesian names) correctly. */
export function toCsv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function fmtDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * The local wall-clock time with the device's UTC offset: 2026-09-25T20:15:00+07:00.
 * The models get times in this shape (never "…Z"), so they never shift the clock when
 * they copy a time out of a ticket or a sentence.
 */
export function localIso(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
  );
}
