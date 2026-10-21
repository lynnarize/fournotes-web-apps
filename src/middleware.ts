// Content Security Policy for every page. Its main job is protecting the API keys
// users keep in this browser (src/lib/byok.ts): if a script were ever injected into
// the page, it could not run (scripts need this request's nonce) and could not send
// anything to a server of its own (connect-src and img-src only allow ours).
//
// Next.js reads the nonce from the request's CSP header and puts it on its own
// scripts; layout.tsx puts it on the theme script. 'strict-dynamic' lets those
// scripts load the ones they need (Vercel Analytics, Speed Insights, BotID).
//
// CSP_REPORT_ONLY=1 switches to report-only (logs violations, blocks nothing), so a
// deployment can be checked or rescued without a code change.
import { NextResponse, type NextRequest } from "next/server";

const dev = process.env.NODE_ENV !== "production";

/** Supabase (cloud sync) is called from the browser, over HTTPS and its realtime websocket. */
function supabaseOrigins(): string[] {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

function policy(nonce: string): string {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' allows WebAssembly only (BotID's challenge may use it), never eval().
    // Dev adds 'unsafe-eval' for React's hot reload.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline styles: React style props and next/font. CSS can't read the page's storage.
    "style-src 'self' 'unsafe-inline'",
    // No remote images: blocks CSS/<img> tricks that leak data through an image URL.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    // Where the page may send data. data: is for turning a stored photo back into a file.
    ["connect-src 'self' data: blob:", "https://www.googleapis.com", ...supabaseOrigins(), ...(dev ? ["ws:"] : [])].join(" "),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = policy(nonce);
  const header = process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp); // how Next.js finds the nonce

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Microphone for recordings and voice mode, camera for scanning; nothing else.
  response.headers.set("Permissions-Policy", "microphone=(self), camera=(self), display-capture=(self), geolocation=(), payment=(), usb=()");
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes return JSON, static files carry no scripts.
      source: "/((?!api/|_next/static|_next/image|sw\\.js|manifest\\.webmanifest|icon|favicon).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
