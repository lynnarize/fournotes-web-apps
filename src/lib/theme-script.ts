// Shared by the server layout (inline script) and the client theme helpers.
// Kept free of "use client" so the layout can import plain strings from it.

export const THEME_KEY = "four-notes:theme";
export const ACCENT_KEY = "four-notes:accent";
export const THEME_COLORS = { light: "#ffffff", paper: "#fbf8f1", dark: "#141414" } as const;
/** "neutral" is the theme's own ink; the others are hues from Settings → Appearance. */
export const ACCENTS = ["neutral", "blue", "violet", "green", "coral", "rose"] as const;

/**
 * Runs before first paint so the page never flashes the wrong theme or accent. Paper is a
 * light look (warm paper, ink-brown text), so a dark device setting doesn't apply to it.
 */
export const themeInitScript = `(function(){var r=document.documentElement;var p="system",a="neutral";try{p=localStorage.getItem("${THEME_KEY}")||"system";a=localStorage.getItem("${ACCENT_KEY}")||"neutral"}catch(e){}var d=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);r.dataset.theme=d?"dark":p==="paper"?"paper":"light";r.dataset.themePref=p;if(a!=="neutral")r.dataset.accent=a;})();`;
