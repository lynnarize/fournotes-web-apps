"use client";
// Settings → Today: how the daily brief reads, one short paragraph or point by point.
import { BRIEF_STYLES, useBriefStyle } from "@/lib/briefParagraph";
import { SettingsGroup, SettingsRow } from "./SettingsSection";

export default function BriefStyleSection() {
  const [style, setStyle] = useBriefStyle();
  const current = BRIEF_STYLES.find((o) => o.id === style) ?? BRIEF_STYLES[0];
  return (
    <SettingsGroup>
      <SettingsRow label="Daily brief" description={<>How the greeting sums up your day. {current.detail}</>}>
        {(labelId) => (
          <div role="radiogroup" aria-labelledby={labelId} className="seg">
            {BRIEF_STYLES.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={style === o.id} onClick={() => setStyle(o.id)} title={o.detail}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}
