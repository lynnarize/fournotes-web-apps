"use client";
// Dictation: the browser's speech recognition writes into the composer, and the words
// stay there to read over and send. Only where the browser has speech recognition;
// elsewhere the mic records a voice note instead (see Composer).
import { useCallback, useEffect, useRef, useState } from "react";
import { getSpeechRecognition, speechErrorMessage, type SpeechRec } from "../assistant";

export function useDictation(onText: (text: string) => void, onError: (message: string) => void) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => { setSupported(Boolean(getSpeechRecognition())); }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setActive(false);
  }, []);

  /** Starts listening; what's heard is added after `before` (what was typed already). */
  const start = useCallback((before: string) => {
    const SR = getSpeechRecognition();
    if (!SR || recRef.current) return;
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    const lead = before.trim() ? `${before.replace(/\s+$/, "")} ` : "";
    let heard = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) heard += r[0].transcript;
        else interim += r[0].transcript;
      }
      textRef.current(`${lead}${heard}${interim}`.replace(/\s{2,}/g, " "));
    };
    rec.onerror = (e) => {
      const msg = speechErrorMessage(e.error);
      if (msg) errorRef.current(msg);
    };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      setActive(false);
    };
    recRef.current = rec;
    setActive(true);
    rec.start();
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, active, start, stop };
}
