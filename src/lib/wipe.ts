"use client";
// Removes everything Four Notes keeps in this browser: your data and settings (local
// and session storage), the key that unlocks saved API keys (IndexedDB), and photos
// waiting from the share sheet (Cache Storage). Then reloads, so nothing stays in memory.
// Used by "Delete all local data" and by "Sign out and remove data" on a shared computer.
export async function wipeThisDevice() {
  for (const store of [localStorage, sessionStorage]) {
    for (const k of Object.keys(store)) if (k.startsWith("four-notes")) store.removeItem(k);
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase("four-notes-secrets");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  try { await caches.delete("share-target"); } catch { /* no Cache Storage here */ }
  window.location.reload();
}
