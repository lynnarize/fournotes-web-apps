"use client";
// Settings → AI & API keys: Chrome's built-in model. Without a key it answers in place of
// demo mode, and it covers the app whenever there's no internet (see lib/ai/onDevice.ts).
import { useState } from "react";
import { downloadOnDeviceModel, setOnDeviceOff, useOnDevice } from "@/lib/ai/onDevice";
import { SettingsRow, Switch } from "./SettingsSection";
import { useToast } from "./ui";

export default function OnDeviceRow() {
  const s = useOnDevice();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const description =
    s.availability === "unsupported"
      ? "Needs Chrome 148 or later on a computer (Windows, macOS or Linux). Not on phones yet."
      : s.availability === "unavailable"
        ? "This computer can't run Chrome's model: it needs about 22 GB free, and 16 GB of memory or a graphics card with more than 4 GB."
        : s.availability === "downloading"
          ? `Downloading the model${s.progress != null ? `, ${Math.round(s.progress * 100)}%` : ""}. You can keep using the app.`
          : s.availability === "downloadable"
            ? "Chrome's built-in model, free and private. It's a one-time download, then it works offline too."
            : s.off
              ? "Turned off. Without a key, replies are rule-based."
              : s.inUse
                ? "Answering now. Nothing you write leaves this device. A key gives a stronger model and photo reading."
                : "Ready. It answers when you're offline, or if you remove your keys.";

  const download = () => {
    setBusy(true);
    // Straight from the click: Chrome downloads the model only on a user gesture.
    downloadOnDeviceModel()
      .then(() => toast("The on-device model is ready."))
      .catch((e) => toast(e instanceof Error ? e.message : "The download didn't finish. Try again.", "error"))
      .finally(() => setBusy(false));
  };

  return (
    <SettingsRow label="On-device AI" description={description}>
      {(labelId) =>
        s.availability === "downloadable" ? (
          <button className="btn btn-secondary btn-sm max-md:h-11" onClick={download} disabled={busy}>Download</button>
        ) : s.availability === "available" ? (
          <Switch checked={!s.off} onChange={(on) => setOnDeviceOff(!on)} labelledBy={labelId} />
        ) : null
      }
    </SettingsRow>
  );
}
