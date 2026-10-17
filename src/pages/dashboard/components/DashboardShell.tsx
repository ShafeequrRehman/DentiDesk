import React, { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Calculator,
  Package, DollarSign, FileText, Settings, HelpCircle,
  Search, Cloud, MessageCircle, Bell, LogOut, UserCog, BookText,
  Store, Lock, ClipboardList, Wifi, WifiOff, Download, RefreshCcw,
  Menu, X, Smartphone, Boxes, Landmark, Stethoscope, FlaskConical, CalendarPlus, CalendarCheck, CalendarOff, Megaphone
} from 'lucide-react';
import { clearAuthSession, getAuthRole, getAuthShop, hasPermission, hasAnyPermission, isPageEnabled, getIsDashboardHidden } from '@/lib/auth';
import { DASHBOARD_PAGES } from '@/lib/dashboard-pages';
import { useOfflineSync } from '@/lib/offline-sync';
import { isDesktopApp, logoutRequest } from '@/lib/api';
import { closeShopSession, openShopSession } from '@/lib/pos-api';
import { useNetworkStatus } from '@/lib/network-status';
import { ShopSessionProvider, useShopSession } from '@/lib/shop-session';
import { useToast } from '@/lib/toast';
import { useNotifications, formatNotificationAge, NOTIFICATION_ICON, NOTIFICATION_ICON_BG, type AppNotification } from '@/lib/notifications';
import { getIpcRenderer } from '@/lib/electron-bridge';
import ShopClosingSummaryModal from '@/pages/dashboard/components/ShopClosingSummaryModal';
import { useLanguage } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

// Icons keyed by DASHBOARD_PAGES's `key` - kept separate from that shared
// list since it lives in lib/ and can't hold JSX.
const PAGE_ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard size={18} />,
  pos: <CalendarPlus size={18} />,
  sales: <CalendarCheck size={18} />,
  doctors: <Stethoscope size={18} />,
  availability: <CalendarOff size={18} />,
  accounting: <Calculator size={18} />,
  purchase: <Package size={18} />,
  'ingredient-stock': <Boxes size={18} />,
  'medicine-setup': <FlaskConical size={18} />,
  dues: <FileText size={18} />,
  ledger: <BookText size={18} />,
  bank: <Landmark size={18} />,
  record: <ClipboardList size={18} />,
  shifts: <Store size={18} />,
  offline: <Wifi size={18} />,
  payroll: <DollarSign size={18} />,
  reports: <FileText size={18} />,
  employees: <UserCog size={18} />,
  settings: <Settings size={18} />,
  whatsapp: <MessageCircle size={18} />,
  post: <Megaphone size={18} />,
  help: <HelpCircle size={18} />,
};

// Nav items carry an optional `permission` key - see lib/auth.ts
// hasPermission(), which mirrors backend/middleware/requirePermission.js.
// Shop Owners always see every item (hasPermission short-circuits true for
// role 'shopowner'); Employees only see items whose permission is part of
// the Role they were assigned. Items with no `permission` are always
// visible to any logged-in shop member (Dashboard home, Help).
//
// On top of that, isPageEnabled() filters against this shop's
// Super-Admin-controlled enabledPages (see lib/dashboard-pages.ts) - this
// applies to EVERYONE at the shop, including the owner, since it's a
// platform-level toggle rather than a within-shop role/permission rule.
export default function DashboardShell() {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const role = getAuthRole();
  const { t } = useLanguage();
  // Off-canvas sidebar on phone/tablet widths (<lg) - the sidebar used to
  // be a fixed, always-visible 224px column with zero responsive
  // breakpoints, which left literally no room for page content on a phone
  // screen. At lg and up this renders exactly as it always did (a static
  // column); below that it's a slide-in drawer toggled by the hamburger
  // button in the header, closed by default, and auto-closes on
  // navigation/backdrop tap.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = DASHBOARD_PAGES
    // Payroll and Manage Staff both hit Shop Owner-only backend routes
    // (requireShopOwner) - hide them from employees entirely rather than
    // showing a link that always 403s.
    .filter((item) => (item.key !== 'employees' && item.key !== 'payroll') || role === 'shopowner')
    // Dashboard Permission Gate: hides the Dashboard home link itself when
    // this employee's assigned Role has "Hide Dashboard" checked - see
    // getIsDashboardHidden's own comment (never true for a Shop Owner).
    .filter((item) => item.key !== 'dashboard' || !getIsDashboardHidden())
    .filter((item) => !item.permission || (Array.isArray(item.permission) ? hasAnyPermission(item.permission) : hasPermission(item.permission)))
    .filter((item) => isPageEnabled(item.key))
    .map((item) => ({ ...item, icon: PAGE_ICONS[item.key] }));
  // F1, F2, F3... in the exact order the sidebar shows them (after
  // Dashboard), so the badges always run in sequence for whatever pages
  // this user can see. Stops at F10 - F11/F12 belong to the browser.
  {
    let next = 1;
    navItems.forEach((item) => {
      if (item.key === 'dashboard' || next > 10) {
        item.hotkey = undefined;
        return;
      }
      item.hotkey = `F${next}`;
      next += 1;
    });
  }

  // Keyboard Shortcuts - Core Navigation: every DASHBOARD_PAGES entry that
  // carries a `hotkey` (F1-F10 - see that file's own comment on why it
  // stops there) works from anywhere in the dashboard, not just while that
  // page itself is focused - wired up once here rather than duplicated on
  // every page. F-keys never type a character into a field, so unlike the
  // Ctrl+S/Enter/Arrow/+- shortcuts each page wires up locally (see
  // POSPage.tsx), these don't need an isTypingTarget guard. Driven
  // straight off navItems (this employee's own permission/enabledPages-
  // filtered nav, not the raw DASHBOARD_PAGES list) so a hotkey can never
  // navigate somewhere their sidebar wouldn't also let them click - a
  // hotkey shouldn't be a backdoor around the permission system. F3 used
  // to be a POS-internal "focus product search" shortcut instead of a page
  // link; that behavior was removed so F3 could take its place in this
  // same sequential mapping like every other hotkeyed page.
  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      const match = navItems.find((item) => item.hotkey === event.key);
      if (!match) return;
      event.preventDefault();
      navigate(match.href);
    }
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Runs the 5-minute offline sync timer (see lib/offline-sync.ts) for the
  // lifetime of the dashboard session - a no-op outside the Electron app,
  // and harmless to mount even for shops that never use offline mode.
  const { lastResult } = useOfflineSync();
  const { toast: syncToast } = useToast();

  // A Cancel Order made offline is trusted immediately (see
  // CancelOrderModal.tsx) and only actually verified against the real
  // Cancel Order Key once this sync tick replays it - if the key turns out
  // wrong, the order is still showing "cancelled" on whatever screen
  // showed it (until that page's next cache refresh corrects it), so this
  // is the one place that actively flags it instead of leaving it to be
  // silently discovered later on the Offline Sync page.
  useEffect(() => {
    if (lastResult?.wrongKeyOrderIds && lastResult.wrongKeyOrderIds.length > 0) {
      syncToast.error(
        lastResult.wrongKeyOrderIds.length === 1
          ? `An offline cancellation used the wrong Cancel Appointment Key - appointment ${lastResult.wrongKeyOrderIds[0]} was NOT cancelled. Redo it with the correct key.`
          : `${lastResult.wrongKeyOrderIds.length} offline cancellations used the wrong Cancel Appointment Key and were NOT applied. Redo them with the correct key.`,
      );
    }
    // Conflict resolution: two devices both placed a Dine-In order for the
    // same table while offline, unaware of each other (see
    // orderController.js's importOfflineOrders). The loser stays queued
    // (still a local-<uuid> order) - staff just need to pick a different
    // table for it via the normal Change Table action, and it'll sync on
    // the next tick.
    if (lastResult?.tableConflictOrderIds && lastResult.tableConflictOrderIds.length > 0) {
      syncToast.error(
        lastResult.tableConflictOrderIds.length === 1
          ? `An offline appointment's table was also taken by another device. Change its table to sync it.`
          : `${lastResult.tableConflictOrderIds.length} offline appointments' tables were also taken by another device. Change their tables to sync them.`,
      );
    }
    // Conflict resolution: an offline edit was built against an order
    // version another till has since changed (see importOfflineOrderUpdates).
    // Rejected rather than silently overwritten - staff need to refresh
    // that order and redo the edit against its real current state.
    if (lastResult?.versionConflictOrderIds && lastResult.versionConflictOrderIds.length > 0) {
      syncToast.error(
        lastResult.versionConflictOrderIds.length === 1
          ? `An offline edit conflicted with a change from another device on appointment ${lastResult.versionConflictOrderIds[0]}. Refresh and redo that edit.`
          : `${lastResult.versionConflictOrderIds.length} offline edits conflicted with changes from another device. Refresh and redo those edits.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResult]);

  // Close the drawer automatically whenever the route changes (tapping a
  // nav link already closes it explicitly - see NavItem's onClick below -
  // but this also covers back/forward navigation and any other route
  // change that doesn't go through a nav link click).
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <ShopSessionProvider>
      {/* Floating frosted sidebar (macOS Finder / Sonoma-style) - detached
          from the edge with its own rounded glass panel on desktop, sliding
          in as a full-height glass panel on mobile (see sidebarOpen below). */}
      {/* h-screen + overflow-hidden (was min-h-screen, no overflow control)
          - min-h-screen only sets a FLOOR, so once the page's content grew
          taller than the viewport the whole document scrolled as one unit,
          sidebar included, instead of just the <main> content underneath
          it - the sidebar wasn't actually "sticky", it just happened to
          start near the top and then scroll away with everything else.
          Capping this wrapper to exactly the viewport height forces all
          scrolling to happen inside <main>'s own overflow-auto below,
          leaving the sidebar genuinely fixed on screen regardless of how
          long the page content gets. print: overrides keep printing
          (which needs its natural full-content height, not a clipped one)
          working exactly as before. */}
      <div className="glass-app-bg flex h-screen overflow-hidden font-sans text-[#2D2E2E] print:block print:h-auto print:overflow-visible print:bg-white">
        {sidebarOpen ? (
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        <aside
          className={`glass dashboard-sidebar print:hidden fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-6 overflow-y-auto p-4 transition-transform duration-200 ease-out rtl:left-auto rtl:right-0 lg:static lg:z-auto lg:top-4 lg:m-4 lg:h-[calc(100vh-2rem)] lg:w-56 lg:translate-x-0 lg:rounded-[28px] ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between gap-2 px-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-black p-1">
                <div className="text-[10px] text-white">*</div>
              </div>
              {/* Whatever name the Super Admin gave this shop at creation
                  (Shop.name, cached at login - see auth.ts's SessionShop)
                  - "Starline" is only the fallback for the rare case that
                  cache is somehow missing. The Shop Owner can override it
                  from Settings > Shop Profile (Shop Name),
                  which patches this same cached value via
                  updateCachedShopName so it shows up here immediately, no
                  re-login needed. */}
              <span className="text-xl font-bold tracking-tight">{getAuthShop()?.name || 'Starline'}</span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-full p-1.5 text-gray-400 hover:bg-gray-200 lg:hidden"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <NavItem
                key={item.label}
                icon={item.icon}
                label={t(`sidebar.${item.key}`)}
                href={item.href}
                hotkey={item.hotkey}
                active={pathname === item.href}
                onNavigate={() => setSidebarOpen(false)}
              />
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8 print:overflow-visible print:p-0">
          {/* Below sm (a real phone), this used to be one flat flex-wrap
              list - the hamburger, the shop-status pill+button, and every
              connectivity badge all competing for the same wrapping rows in
              whatever order they happened to overflow, which is what
              produced the messy/random-looking stack (icon-action group
              landing on its own oddly-spaced line with a big gap above it).
              Restructured into two deliberate blocks on mobile instead: the
              hamburger + status/connectivity pills (each its own tidy row,
              via flex-col on the inner group), then the icon-action group
              as a clean row of its own underneath, right-aligned within
              itself. `items-start` stops each pill/badge button from
              stretching into an ugly full-width bar (flex-col's default).
              Every component here is still mounted exactly once - only the
              CSS layout differs by breakpoint - so this adds no extra
              polling/state. From sm up this collapses back to the exact
              single flex-wrap row it always was - nothing changes on
              tablet/desktop. */}
          <div className="print:hidden mb-3 flex flex-col items-start gap-1.5 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
            <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="flex items-center justify-center rounded-full border border-white bg-white p-2.5 text-gray-600 shadow-sm hover:bg-gray-50 lg:hidden"
                aria-label="Open menu"
              >
                <Menu size={18} />
              </button>
              <ShopStatusControl />
              <NetworkStatusBadge />
              <OfflineModeToggle />
              <UpdateStatusBadge />
            </div>
            {/* ml-auto keeps this group hugging the right edge from sm up,
                even when it wraps onto its own row below the left group -
                plain `justify-between` on the parent has no effect on a
                line that only contains one flex item, which is what let
                this whole group (and the bell button inside it) drift
                toward the left on a narrower window instead of staying at
                the right. `justify-end` does the same job on mobile, where
                the outer container is flex-col (so this block is already
                its own full-width row - it just needs its own contents
                pushed to that row's right edge). */}
            <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:ml-auto sm:w-auto sm:gap-2">
              <InstallAppButton />
              <TopAction icon={<Search size={15} />} className="hidden sm:flex" />
              <TopAction icon={<Cloud size={15} />} className="hidden sm:flex" />
              <TopAction icon={<MessageCircle size={15} />} />
              <NotificationBellButton />
              <LanguageSwitcher />
              <button
                type="button"
                onClick={async () => {
                  await logoutRequest();
                  clearAuthSession();
                  navigate('/login', { replace: true });
                }}
                className="glass-pill flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-white/70 sm:px-3"
              >
                <LogOut size={13} />
                <span className="hidden sm:inline">{t('dashboardShell.logout')}</span>
              </button>
            </div>
          </div>
          <Outlet />
        </main>
      </div>
    </ShopSessionProvider>
  );
}

// The Android/Chrome "install this as an app" trigger for the STAFF
// dashboard itself - separate from CustomerOrderPage.tsx's own Install
// button, which only ever appears on the customer-facing ordering page.
// Needs main.tsx's site-wide sw.js registration (see the comment there) to
// ever fire at all - Chrome won't offer beforeinstallprompt without a
// registered service worker + this manifest (public/manifest.json).
// Renders nothing inside Electron (already a real installed app, nothing
// to prompt) or once the prompt has been used/dismissed for this session.
function InstallAppButton() {
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [iosStepsOpen, setIosStepsOpen] = useState(false);

  useEffect(() => {
    if (isDesktopApp()) return undefined;
    // The prompt may have fired before this mounted (e.g. on the login
    // page) - main.tsx keeps it on window.__installPrompt.
    const saved = (window as unknown as { __installPrompt?: Event }).__installPrompt;
    if (saved) setInstallEvent(saved);
    function handler(event: Event) {
      event.preventDefault();
      setInstallEvent(event);
    }
    function onReady() {
      const latest = (window as unknown as { __installPrompt?: Event }).__installPrompt;
      if (latest) setInstallEvent(latest);
    }
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('dentidesk-install-ready', onReady);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('dentidesk-install-ready', onReady);
    };
  }, []);

  // iOS Safari never fires beforeinstallprompt (an Apple platform
  // restriction) - shows a one-tap dismissible hint with the manual Share ->
  // Add to Home Screen steps instead, same pattern as CustomerOrderPage.tsx.
  useEffect(() => {
    if (isDesktopApp()) return;
    const ua = window.navigator.userAgent;
    // iPadOS reports itself as a Mac - a touch screen gives it away.
    const isIos = (/iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    setShowIosHint(isIos && !isStandalone);
  }, []);

  if (installEvent) {
    return (
      <button
        type="button"
        onClick={async () => {
          installEvent.prompt();
          await installEvent.userChoice;
          (window as unknown as { __installPrompt?: Event }).__installPrompt = undefined;
          setInstallEvent(null);
        }}
        title="Install this dashboard as an app on this phone/computer"
        className="flex items-center gap-2 rounded-full bg-black px-3 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-gray-800 sm:px-4"
      >
        <Smartphone size={16} />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  // iPhone/iPad: Apple doesn't let a website show its own Install
  // button - the app is added from Safari's Share menu. This button just
  // shows the steps.
  if (showIosHint) {
    return (
      <>
        <button
          type="button"
          onClick={() => setIosStepsOpen(true)}
          className="flex items-center gap-2 rounded-full bg-black px-3 py-2.5 text-sm font-bold text-white shadow-sm"
        >
          <Smartphone size={16} />
          <span>Install App</span>
        </button>
        {iosStepsOpen ? (
          <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setIosStepsOpen(false)}>
            <div className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <h3 className="text-lg font-black text-gray-900">Install on iPhone / iPad</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm font-semibold text-gray-700">
                <li>Open this page in <b>Safari</b> (in Chrome on iPhone use the Share button next to the address bar).</li>
                <li>Tap the <b>Share</b> button (the square with an arrow ↑) at the bottom of the screen.</li>
                <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
                <li>Tap <b>Add</b> - DentiDesk now opens from your home screen like an app.</li>
              </ol>
              <button type="button" onClick={() => setIosStepsOpen(false)} className="mt-5 w-full rounded-2xl bg-[#00B0C7] py-3 text-sm font-black text-gray-900">
                Got it
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return null;
}

// The Open/Close Shop control. Any shop member can see the current status
// (important context - the POS screen refuses new orders while closed, see
// POSPage), but only someone with the shop.session.manage permission
// (Shop Owner always, or an employee whose Role grants it - Manager by
// default) gets the actual buttons to toggle it.
function ShopStatusControl() {
  const { isOpen, session, loading, refresh, openLocally } = useShopSession();
  const { toast, confirm } = useToast();
  const canManage = hasPermission('shop.session.manage');
  const [busy, setBusy] = useState(false);
  const { isOnline } = useNetworkStatus();
  // Day-End Shop Closing Summary Sheet: "Close Shop" now opens this
  // review screen first instead of closing immediately - handleClose
  // itself (unresolved-orders confirmation, the actual close call, the
  // success toast) is unchanged and untouched, just triggered from the
  // modal's own confirm button now (see onConfirmClose below) instead of
  // straight off this button's onClick.
  const [showClosingSummary, setShowClosingSummary] = useState(false);

  async function handleOpen() {
    setBusy(true);
    try {
      if (isDesktopApp() && !isOnline) {
        // Same offline path as POSPage's "Open Shop" button - see
        // shop-session.tsx's openLocally() and offline-sync.ts's
        // reconciliation step for how this becomes a real ShopSession.
        openLocally();
        toast.success('Clinic opened offline. Will sync once back online.');
        return;
      }
      await openShopSession();
      await refresh();
      toast.success('Clinic opened. Appointments can now be taken.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open clinic.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(force = false) {
    setBusy(true);
    try {
      const result = await closeShopSession(force);
      if (!result) return;

      if (result.needsConfirmation) {
        const orders = result.unresolvedOrders || [];
        const preview = orders.slice(0, 8).map((o) => `#${o.dailyOrderNumber ?? o.id.slice(-4)} - ${o.status === 'pending' ? 'pending' : `$${o.remainingAmount} due`}`).join('\n');
        const extra = orders.length > 8 ? `\n...and ${orders.length - 8} more` : '';
        setBusy(false);
        // Sequence bug fix: this used to `await confirm(...)` right here,
        // which meant handleClose's own promise didn't resolve until the
        // cashier answered the Unresolved Orders dialog. That's harmless
        // when this button called handleClose directly, but the Day-End
        // Closing Summary sheet's own Confirm button (ShopClosingSummaryModal)
        // awaits this same handleClose (via onConfirmClose) and only
        // dismisses itself once that promise resolves - so that modal sat
        // frozen on "Closing..." for as long as the confirm dialog stayed
        // unanswered, and the confirm dialog itself was rendering underneath
        // that still-open modal the whole time (see toast.tsx's z-index
        // bump for the other half of that). Firing this off instead of
        // awaiting it lets handleClose (and therefore the summary modal)
        // return/dismiss the instant the pending-order check comes back,
        // while the Unresolved Orders dialog still opens and drives its own
        // "Close Anyway" -> handleClose(true) recursion independently.
        void confirm(
          `${orders.length} appointment${orders.length === 1 ? ' is' : 's are'} still pending or unpaid:\n\n${preview}${extra}\n\nClose the clinic anyway? These appointments stay in the system either way.`,
          { title: 'Unresolved appointments', confirmText: 'Close Anyway', tone: 'danger' }
        ).then((confirmed) => {
          if (confirmed) void handleClose(true);
        });
        return;
      }

      await refresh();
      if (result.session) {
        const s = result.session.summary;
        toast.success(`Clinic closed. ${s.orderCount} appointment${s.orderCount === 1 ? '' : 's'}, $${s.totalSales.toLocaleString()} total sales.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to close clinic.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="glass-pill h-7 w-28 animate-pulse rounded-full" />;
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        disabled={busy || !canManage}
        title={canManage ? 'Open the clinic to start taking appointments' : 'Only a Manager or Clinic Owner can open the clinic'}
        className="flex items-center gap-1.5 rounded-full border-[0.5px] border-white/40 bg-gradient-to-b from-emerald-400 to-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-3px_8px_rgba(6,95,70,0.45)] transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Store size={13} />
        {busy ? 'Opening...' : 'Open Clinic'}
      </button>
    );
  }

  const openedTime = session?.openedAt ? new Date(session.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const liveCount = session?.liveSummary?.orderCount ?? 0;

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="glass-pill flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold text-emerald-700"
        title={`Opened at ${openedTime}${session?.openedByName ? ` by ${session.openedByName}` : ''}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Open since {openedTime} · {liveCount} appointment{liveCount === 1 ? '' : 's'}
      </div>
      {canManage && (
        <button
          type="button"
          onClick={() => setShowClosingSummary(true)}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-full border-[0.5px] border-white/40 bg-gradient-to-b from-rose-500 to-rose-700 px-2.5 py-1.5 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-3px_8px_rgba(136,19,55,0.45)] transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Lock size={13} />
          {busy ? 'Closing...' : 'Close Clinic'}
        </button>
      )}
      {showClosingSummary && (
        <ShopClosingSummaryModal
          session={session}
          closing={busy}
          onClose={() => setShowClosingSummary(false)}
          onConfirmClose={() => handleClose(false)}
        />
      )}
    </div>
  );
}

// Shows real backend reachability (see src/lib/network-status.ts), not just
// the OS network-adapter flag - sits right next to the Open/Close Shop
// button since both answer "can this shop actually take/sync orders right
// now?".
function NetworkStatusBadge() {
  const { isOnline, checking, checkNow } = useNetworkStatus();

  return (
    <button
      type="button"
      onClick={() => void checkNow()}
      title={isOnline ? 'Connected to the server' : 'Cannot reach the server - check your internet connection'}
      className={`glass-pill flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold transition-colors ${
        isOnline ? 'text-emerald-700' : 'text-rose-700'
      }`}
    >
      {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
      <span className={checking ? 'opacity-60' : ''}>{isOnline ? 'Online' : 'Offline'}</span>
    </button>
  );
}

// A manual "run this till offline on purpose" switch - deliberately
// separate from NetworkStatusBadge above, which only ever reports the REAL
// connection state. Turning WiFi off entirely would be the obvious way to
// test/force offline mode, but it also kills this till's own LAN, which is
// exactly what a paired phone needs to reach the Local Hub for offline
// order-taking/pairing (see backend/localHub/) - so that "fix" breaks the
// very feature it's meant to test. This toggle fakes just the isOnline
// signal every page already reads (see network-status.ts's forcedOffline),
// leaving WiFi, the LAN, and the Local Hub completely untouched - a paired
// phone keeps working exactly as it would on a genuinely offline till.
//
// Desktop-app only: a plain browser tab has no Local Hub to fall back to
// at all, so forcing it "offline" would just break every page with
// nothing to show for it.
function OfflineModeToggle() {
  const { forcedOffline, toggleForcedOffline } = useNetworkStatus();
  if (!isDesktopApp()) return null;

  return (
    <button
      type="button"
      onClick={toggleForcedOffline}
      title={
        forcedOffline
          ? 'Offline Mode is ON - this till is treating itself as offline on purpose, even though WiFi/internet may still be connected. Click to go back online.'
          : "Manually put this till into offline mode without turning off WiFi - keeps phone pairing/the Local Hub working over your LAN while every page behaves as if there's no internet."
      }
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-bold transition-colors ${
        forcedOffline
          ? 'border-amber-300 bg-amber-100 text-amber-800'
          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
      }`}
    >
      <WifiOff size={13} />
      {forcedOffline ? 'Offline Mode: ON' : 'Offline Mode'}
    </button>
  );
}

// Listens for main.js's electron-updater events (see setupAutoUpdater there)
// and surfaces them here - a quiet "Update Downloading..." pill while a new
// version is fetched in the background, then a "Restart to Update" button
// once it's ready to install. Renders nothing in a plain browser tab or
// while no update has been found, so it never clutters the normal topbar.
function UpdateStatusBadge() {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'ready'>('idle');
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return undefined;

    const onAvailable = (_event: unknown, ...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined;
      setStatus('downloading');
      setVersion(info?.version ?? null);
    };
    const onDownloaded = (_event: unknown, ...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined;
      setStatus('ready');
      setVersion(info?.version ?? null);
    };

    ipcRenderer.on('app-update-available', onAvailable);
    ipcRenderer.on('app-update-downloaded', onDownloaded);

    return () => {
      ipcRenderer.removeListener('app-update-available', onAvailable);
      ipcRenderer.removeListener('app-update-downloaded', onDownloaded);
    };
  }, []);

  if (status === 'idle') return null;

  if (status === 'ready') {
    return (
      <button
        type="button"
        onClick={() => getIpcRenderer()?.send('install-app-update-now')}
        title={version ? `Version ${version} is downloaded - click to restart and install.` : 'Update downloaded - click to restart and install.'}
        className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
      >
        <RefreshCcw size={16} />
        Restart to Update
      </button>
    );
  }

  return (
    <div
      title={version ? `Downloading update ${version}...` : 'Downloading update...'}
      className="flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-bold text-sky-700"
    >
      <Download size={16} />
      Update Downloading...
    </div>
  );
}

function NavItem({
  icon,
  label,
  href,
  hotkey,
  active,
  onNavigate,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  hotkey?: string;
  active?: boolean;
  onNavigate?: () => void;
}) {
  const className = `flex items-center gap-2.5 rounded-full px-3 py-2.5 transition-all ${
    active
      ? 'border-[0.5px] border-white/50 bg-gradient-to-b from-[#A8E9F1] to-[#14BCD1] font-bold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_-2px_6px_rgba(0,110,125,0.4)]'
      : 'text-gray-500 hover:bg-white/50'
  }`;

  // Visual Hotkey Badge Tag: a small bracketed [F1]-style chip pinned to
  // the right edge of the row (ml-auto on the label wrapper below pushes
  // it there regardless of label length) - subtle enough not to compete
  // with the label/icon, but always legible against either nav-item state
  // (the active item's own yellow-green gradient background needs a
  // darker/more opaque chip than the plain-text inactive rows do, or it'd
  // wash out).
  const badge = hotkey ? (
    <span
      className={`ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
        active ? 'bg-black/15 text-black/70' : 'bg-black/5 text-gray-400'
      }`}
    >
      {hotkey}
    </span>
  ) : null;

  if (!href) {
    return (
      <div className={`${className} cursor-default`}>
        {icon}
        <span className="flex min-w-0 flex-1 items-center text-sm">{label}</span>
        {badge}
      </div>
    );
  }

  return (
    <Link to={href} className={className} onClick={onNavigate}>
      {icon}
      <span className="flex min-w-0 flex-1 items-center text-sm">{label}</span>
      {badge}
    </Link>
  );
}

function TopAction({ icon, className = '' }: { icon: React.ReactNode; className?: string }) {
  return (
    <div className={`clickable glass-pill rounded-full p-1.5 text-gray-500 transition-colors hover:bg-white/70 ${className}`}>
      {icon}
    </div>
  );
}

// Real notification bell - replaces the old hardcoded "Bell icon + red 2
// badge" placeholder. Shows the live unread count, and a dropdown of every
// notification fired this session (table timer expiries, order saves,
// order completions - see lib/notifications.tsx). Every order_saved row is
// clickable and always jumps straight to that order's Edit screen, no
// matter how long ago it was saved - a pending order stays editable as
// many times as needed (owner requirement: "jab tak order pending hain,
// jitni dafa marzi edit kr sky"); only once it's actually completed does
// editing lock, and that's enforced for real, live, on the order itself
// (see EditOrderPage.tsx's status guard) rather than guessed here from a
// stale client-side timestamp - the old EDITABLE_WINDOW_MS 10-minute cutoff
// used to lock this row even while the order was still genuinely pending.
// Every other kind (table_timer_expired, order_completed) is view-only in
// this history, per that same requirement.
function NotificationBellButton() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleOpen() {
    setOpen((previous) => {
      const next = !previous;
      if (next) markAllRead();
      return next;
    });
  }

  // Only order_saved rows are clickable, and always jump straight to Edit -
  // see this function's comment block above for why there's no more time
  // window here. If the order has actually been completed by the time
  // someone taps an old row, EditOrderPage.tsx itself shows the locked
  // message; this button never has to guess. Table timers no longer need a
  // staff decision at all - an expiry auto-clears the table by itself (see
  // lib/notifications.tsx's poll), so table_timer_expired rows, like
  // order_completed/info, are purely informational history.
  function handleRowClick(notification: AppNotification) {
    if (notification.kind !== 'order_saved' || !notification.orderId) return;
    setOpen(false);
    navigate(`/dashboard/sales/${notification.orderId}/edit`);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Notifications"
        className="clickable glass-pill rounded-full p-1.5 text-gray-500 transition-colors hover:bg-white/70"
      >
        <Bell size={15} />
      </button>
      {unreadCount > 0 ? (
        <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      ) : null}
      {/* Always viewport-fixed (never `absolute` off the bell button itself)
          and anchored to the window's own top-right corner, not to
          wherever this button happens to land. The header's right-hand
          icon group (`flex flex-wrap`) can wrap onto its own line on a
          narrower window, and that wrapped line isn't right-aligned - so
          the bell button itself can end up sitting well left-of-center
          (see screenshot bug report). An `absolute right-0` panel anchored
          to that button would then extend left underneath the fixed,
          opaque sidebar, and because this panel is glass/backdrop-blur,
          the sidebar's own colors bled through visually looking like
          truncated/unreadable text on its left edge - not an actual clip,
          but just as unreadable. Anchoring to the viewport instead makes
          this panel's position completely independent of the trigger's
          layout position, so it can never overlap the sidebar at any
          window size. z-[400] clears both the sidebar (z-50) and the
          toast stack (z-[350]) with real margin. */}
      {open ? (
        <div className="glass-strong fixed inset-x-4 top-24 z-[400] max-h-[70vh] overflow-y-auto rounded-2xl p-2 sm:inset-x-auto sm:left-auto sm:right-4 sm:top-20 sm:w-80">
          <p className="px-3 py-2 text-xs font-black uppercase tracking-wide text-gray-500">Notifications</p>
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm font-bold text-gray-400">No notifications yet.</p>
          ) : (
            <div className="space-y-1">
              {notifications.map((notification) => {
                const isOrderSaved = notification.kind === 'order_saved';
                return (
                  <button
                    key={notification.id}
                    type="button"
                    disabled={!isOrderSaved}
                    onClick={() => handleRowClick(notification)}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      isOrderSaved ? 'cursor-pointer hover:bg-white/70' : 'cursor-default'
                    }`}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-inner ${NOTIFICATION_ICON_BG[notification.kind]}`}>
                      {NOTIFICATION_ICON[notification.kind]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-snug text-gray-900">{notification.message}</p>
                      <p className="mt-0.5 text-[11px] font-bold text-gray-400">
                        {formatNotificationAge(notification.createdAt)}
                        {isOrderSaved ? ' · Tap to edit' : ''}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
