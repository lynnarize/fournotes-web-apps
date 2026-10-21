"use client";
// Scan button behaviour: on phones and tablets, ask whether to take a photo with
// the camera or pick an existing image; on desktop, open the file picker directly.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackDismiss } from "@/lib/backstack";
import { usePresence } from "@/lib/hooks";
import { Icon } from "./ui";

function useTouchDevice() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return touch;
}

export default function ScanPicker({ onFile, children }: { onFile: (file: File) => void; children: (open: () => void) => ReactNode }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false);
  const touch = useTouchDevice();
  const presence = usePresence(sheet);
  useBackDismiss(sheet, () => setSheet(false));

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const open = () => (touch ? setSheet(true) : filesRef.current?.click());
  const choose = (input: HTMLInputElement | null) => {
    setSheet(false);
    input?.click();
  };
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  };

  const option = (icon: string, title: string, hint: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-[18px] p-2.5 text-left transition-colors hover:bg-[var(--hover)] active:bg-[var(--hover)]">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[var(--surface-muted)] text-[var(--text-secondary)]">
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-[13px] text-[var(--text-muted)]">{hint}</span>
      </span>
    </button>
  );

  return (
    <>
      {children(open)}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <input ref={filesRef} type="file" accept="image/*" hidden onChange={picked} />
      {presence.mounted && typeof document !== "undefined" &&
        createPortal(
          <div className={`no-print fixed inset-0 z-[70] flex items-end justify-center ${sheet ? "" : "pointer-events-none"}`}>
            <div className="fn-backdrop absolute inset-0 bg-black/30" data-state={presence.state} onClick={() => setSheet(false)} aria-hidden />
            <div
              role="dialog"
              aria-modal
              aria-labelledby="scan-picker-title"
              data-state={presence.state}
              className="fn-sheet relative w-full max-w-md rounded-t-[var(--radius-panel)] border border-b-0 border-[var(--border)] bg-[var(--surface)] px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 shadow-[var(--shadow-floating)]"
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-strong)]" aria-hidden />
              <h2 id="scan-picker-title" className="px-3 text-[15px] font-medium">Scan</h2>
              <p className="px-3 pb-3 pt-0.5 text-[13px] text-[var(--text-secondary)]">A receipt, a handwritten note, or an e-wallet screenshot</p>
              {option("camera", "Take a photo", "Open the camera", () => choose(cameraRef.current))}
              {option("image", "Choose from files", "Gallery, photos or file manager", () => choose(filesRef.current))}
              <button type="button" onClick={() => setSheet(false)} className="btn btn-plain btn-lg mt-1 w-full">
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
