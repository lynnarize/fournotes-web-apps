"use client";
// Settings → AI & API keys: Chrome's built-in model. Without a key it answers in place of
// demo mode, and it covers the app whenever there's no internet (see lib/ai/onDevice.ts).
// The download shows its progress, size, speed and time left, and can be paused or cancelled.
import {
  cancelOnDeviceDownload, chooseOnDevice, onDeviceScope, downloadOnDeviceModel, MODEL_BYTES, pauseOnDeviceDownload, recheckOnDevice, setOnDeviceOff, useOnDevice, type DownloadState,
} from "@/lib/ai/onDevice";
import { SettingsBlock, SettingsRow } from "./SettingsSection";
import { Icon, useToast } from "./ui";

/** 1.6e9 -> "1.6 GB", 3.2e8 -> "320 MB". */
function size(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
}
/** 75 -> "about 2 min left", 20 -> "less than a minute left". */
function left(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return "less than a minute left";
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min left`;
  const h = Math.floor(seconds / 3600);
  return `about ${h} h ${Math.round((seconds % 3600) / 60)} min left`;
}

/** "42% · 1.7 of about 4 GB · 12 MB/s · about 3 min left" */
function details(d: DownloadState) {
  const total = d.bytes?.total ?? MODEL_BYTES;
  const loaded = d.bytes?.loaded ?? d.fraction * MODEL_BYTES;
  const approx = d.bytes ? "" : "about ";
  const parts = [`${Math.floor(d.fraction * 100)}%`, `${size(loaded)} of ${approx}${size(total)}`];
  if (d.phase === "downloading" && d.rate && d.rate > 0) {
    parts.push(`${size(d.rate * total)}/s`);
    const eta = left((1 - d.fraction) / d.rate);
    if (eta) parts.push(eta);
  }
  return parts.join(" · ");
}

function Bar({ fraction, busy, label }: { fraction: number | null; busy?: boolean; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction == null ? undefined : Math.floor(fraction * 100)}
      className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]"
    >
      {fraction == null ? (
        // Chrome is busy but doesn't say how far along: a sliding stripe.
        <span className="fn-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-[var(--accent)]" />
      ) : (
        <span
          className={`block h-full rounded-full transition-[width] duration-300 ${busy ? "bg-[var(--accent)]" : "bg-[var(--text-muted)]"}`}
          style={{ width: `${Math.max(2, fraction * 100)}%` }}
        />
      )}
    </div>
  );
}

export default function OnDeviceRow() {
  const s = useOnDevice();
  const d = s.download;
  const toast = useToast();

  const download = () => {
    // Straight from the click: Chrome downloads the model only on a user gesture.
    downloadOnDeviceModel()
      .then((outcome) => { if (outcome === "done") toast("The on-device model is ready."); })
      .catch((e) => toast(e instanceof Error ? e.message : "The download didn't finish. Try again.", "error"));
  };
  const cancel = () => {
    cancelOnDeviceDownload();
    toast("Download cancelled. Chrome may still finish it in the background.");
  };

  const following = d.phase === "downloading" || d.phase === "installing" || d.phase === "paused" || d.phase === "error";
  const description =
    s.availability === "unsupported"
      ? "This browser doesn't let web pages use Chrome's model. It needs Chrome 148 or later on a computer (Windows, macOS or Linux); on an older Chrome, turn on chrome://flags/#prompt-api-for-gemini-nano and restart. Not on phones yet."
      : s.availability === "unavailable"
        ? "This computer can't run Chrome's model: it needs about 22 GB free, and 16 GB of memory or a graphics card with more than 4 GB."
        : following || d.background
          ? "Chrome's built-in model, free and private. You can keep using the app while it downloads."
          : s.availability === "downloadable"
            ? `Chrome's built-in model, free and private. A one-time download of about ${size(MODEL_BYTES)} (Chrome needs 22 GB free while it installs), then it works offline too.`
            : s.off
              ? "Turned off. Without a key, replies are rule-based."
              : s.forced
                ? `Answering instead of the cloud. ${onDeviceScope(s)}`
                : s.inUse
                  ? `Answering now. Nothing you write leaves this device${s.sees ? ", photos included" : ""}. A key gives a stronger model${s.sees ? "" : " and photo reading"}.`
                  : "Ready. It answers when you're offline or have no key, or always if you choose it in the model menu.";

  return (
    <>
      <SettingsRow label="On-device AI" description={description}>
        {(labelId) =>
          s.availability === "available" && !following ? (
            // The same choice as the model menu's "On this device", plus turning it off.
            <select
              aria-labelledby={labelId}
              value={s.off ? "off" : s.forced ? "always" : "auto"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "off") setOnDeviceOff(true);
                else if (v === "always") chooseOnDevice("device");
                else setOnDeviceOff(false);
              }}
              className="field w-auto max-md:h-11"
            >
              <option value="auto">When there&apos;s no key</option>
              <option value="always">Always, instead of the cloud</option>
              <option value="off">Off</option>
            </select>
          ) : (s.availability === "downloadable" || s.availability === "downloading") && d.phase === "idle" && !d.background ? (
            <button className="btn btn-secondary btn-sm max-md:h-11" onClick={download}>
              <Icon name="download" size={14} /> Download
            </button>
          ) : s.availability === "unsupported" || s.availability === "unavailable" ? (
            <button className="btn btn-plain btn-sm max-md:h-11" onClick={() => void recheckOnDevice().then(() => toast("Checked again."))}>Check again</button>
          ) : null
        }
      </SettingsRow>

      {following && (
        <SettingsBlock className="flex flex-col gap-2.5">
          <Bar fraction={d.phase === "installing" ? null : d.fraction} busy={d.phase === "downloading"} label="On-device model download" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="fn-num min-w-0 flex-1 basis-56 text-[13px] text-[var(--text-secondary)]" aria-live="polite">
              {d.phase === "installing"
                ? "Downloaded. Chrome is installing the model, almost there…"
                : d.phase === "paused"
                  ? `Paused · ${details(d)}`
                  : d.phase === "error"
                    ? `Stopped: ${d.error}`
                    : d.fraction === 0
                      ? "Starting the download…"
                      : details(d)}
            </p>
            <div className="flex gap-1.5">
              {d.phase === "downloading" && (
                <button className="btn btn-secondary btn-sm max-md:h-11" onClick={pauseOnDeviceDownload} title="Stops the download here; Resume asks Chrome to carry on">
                  Pause
                </button>
              )}
              {(d.phase === "paused" || d.phase === "error") && (
                <button className="btn btn-secondary btn-sm max-md:h-11" onClick={download}>{d.phase === "paused" ? "Resume" : "Try again"}</button>
              )}
              {d.phase !== "installing" && <button className="btn btn-plain btn-sm max-md:h-11" onClick={cancel}>Cancel</button>}
            </div>
          </div>
        </SettingsBlock>
      )}

      {!following && d.background && (
        <SettingsBlock className="flex flex-col gap-2.5">
          <Bar fraction={null} label="Chrome is downloading the model" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 flex-1 basis-56 text-[13px] text-[var(--text-secondary)]">
              Chrome is downloading the model in the background. This row updates when it&apos;s ready.
            </p>
            <button className="btn btn-secondary btn-sm max-md:h-11" onClick={download} title="Follow the download here, with its progress">Show progress</button>
          </div>
        </SettingsBlock>
      )}
    </>
  );
}
