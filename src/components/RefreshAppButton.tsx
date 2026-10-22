// "Refresh" button for phones and the installed app (Android APK made from
// the link, iPhone "Add to Home Screen") - those have no browser reload
// button. Clears any cached files and reloads the page fresh from the
// server, so a new update shows straight away. Shown on phone-size screens
// and whenever the page runs as an installed app.
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

export async function hardRefresh() {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map((reg) => reg.update().catch(() => undefined)));
  } catch {
    // nothing cached - just reload
  }
  // A new address (?r=time) makes the phone fetch the page again instead
  // of its saved copy. The #/... part keeps the user on the same screen.
  const url = new URL(window.location.href);
  url.searchParams.set('r', String(Date.now()));
  window.location.replace(url.toString());
}

function isInstalledApp() {
  if (typeof window === 'undefined') return false;
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches;
}

export default function RefreshAppButton({ dark = false }: { dark?: boolean }) {
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setInstalled(isInstalledApp()), []);
  return (
    <button
      type="button"
      onClick={() => {
        setBusy(true);
        void hardRefresh();
      }}
      title="Refresh - load the latest version"
      className={`${installed ? 'flex' : 'flex sm:hidden'} items-center gap-1.5 rounded-full px-3 py-2 text-xs font-black transition ${
        dark ? 'bg-white/10 text-white hover:bg-white/20' : 'glass-pill text-gray-700 hover:bg-white/70'
      }`}
    >
      <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
      <span>Refresh</span>
    </button>
  );
}
