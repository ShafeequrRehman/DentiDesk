
import { cs } from '@/lib/currency';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { expiryStatus } from '@/lib/medicine-expiry';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  AreaChart, Area
} from 'recharts';
import {
  Target, Users, CheckCircle2, Clock,
  RotateCcw, XCircle, Wallet, Landmark, Package, Truck,
  ShoppingBag, Receipt, HandCoins, PiggyBank, Pencil, History as HistoryIcon, List, Eraser, Undo2, Trash2,
  AlertTriangle, CalendarClock,
} from 'lucide-react';
import { adjustCash, adjustDashboardTile, clearCash, clearDashboardTile, deleteCashEntry, deleteDashboardAdjustment, undoCashEntry, undoDashboardAdjustment, fetchCashSummary, fetchDashboardAdjustmentHistory, fetchDashboardSummary, fetchIngredients, fetchOrdersSummary, fetchProducts, fetchRecoveryHistory, fetchShopSessionHistory, fetchStockValueDetail, fetchVendorBalanceDetail, fetchSaleOnCashDetail, type OrderSummary } from '@/lib/pos-api';
import { CashTransaction, DashboardAdjustmentHistoryEntry, DashboardAdjustmentKey, DashboardSummary, Product, RecoveryHistoryRow, SaleOnCashDetailRow, SavedOrder, ShopSession, StockValueDetailRow, VendorBalanceDetailRow } from '@/lib/pos-types';
import { getBusinessWindow, filterOrdersInBusinessWindow, useShopSession, type BusinessWindow as SessionBusinessWindow } from '@/lib/shop-session';
import { isDesktopApp } from '@/lib/api';
import { useNetworkStatus } from '@/lib/network-status';
import { loadOrdersFromLocalHub } from '@/lib/offline-order-helpers';
import { canOpenPage, getIsDashboardHidden, hasPermission } from '@/lib/auth';
import { getFirstAccessiblePage } from '@/lib/dashboard-pages';
import { useToast } from '@/lib/toast';
import { useBackspaceToClose } from '@/lib/keyboard-shortcuts';
import DrsServicesRevenue from '@/components/DrsServicesRevenue';

import { Paged } from '@/components/Paged';

type InventoryItem = { id: string | number; name: string; stock: number; unit?: string; lowStockThreshold?: number; expiryDate?: string; expiryAlertDays?: number };
// Extends the shared window (src/lib/shop-session.ts - the single source
// of truth for the actual date-math, shared with Record/Sales) with the
// display label this page renders in the header, which is presentation
// detail specific to this page rather than something other pages need.
type BusinessWindow = SessionBusinessWindow & { label: string };
type ServiceStats = {
  totalRevenue: number;
  totalOrders: number;
  businessSales: number;
  avgValue: number;
  completed: number;
  pending: number;
  cancelled: number;
  uniqueCustomers: number;
};

// Dashboard Permission Gate: an employee whose Role has "Hide Dashboard"
// checked, OR whose resolved permissions don't include 'view.dashboard'
// (the role never granted it, or a Shop Owner explicitly revoked it for
// just this one employee via the Manage Staff override modal - see
// config/permissions.js's own comment on why these are two independent
// gates), must not be able to reach this page even by direct navigation
// (typing/bookmarking the '/dashboard' URL) - the sidebar link and every
// automatic post-login redirect already steer them elsewhere (see
// DashboardShell.tsx's nav filter and lib/dashboard-pages.ts's
// getFirstAccessiblePage), but this is the actual enforcement point for
// this one route. A thin wrapper around the real page component rather
// than an early return inside it, so the redirect decision is made BEFORE
// any of the real component's hooks/effects (data fetching, timers) ever
// run - never violates the Rules of Hooks, and never fires a network
// request for a page about to be redirected away from anyway.
export default function DashboardPageClient() {
  if (getIsDashboardHidden() || !canOpenPage('dashboard', 'view.dashboard')) {
    return <Navigate to={getFirstAccessiblePage()} replace />;
  }
  return <DashboardPageClientInner />;
}

function DashboardPageClientInner() {
  const { popup, confirm } = useToast();
  // SavedOrder from the Local Hub cache-first paint, or the narrower
  // OrderSummary shape from the live cloud poll below - stats/chart code in
  // this file only ever reads the fields both shapes have in common
  // (status/total/createdAt/customer.phone/waiter), so either is fine here.
  const [orders, setOrders] = useState<(SavedOrder | OrderSummary)[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [medicines, setMedicines] = useState<InventoryItem[] | null>(null);
  const [chartsReady, setChartsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [shopSession, setShopSession] = useState<ShopSession | null>(null);
  const { isOnline } = useNetworkStatus();
  // The shared, cached shop-open state (see shop-session.tsx) - gives this
  // page something correct to show instantly, before its own (more
  // complete, but cloud-only) session-history fetch below has a chance to
  // land.
  const { session: cachedShopSession } = useShopSession();

  useEffect(() => {
    // Two animation frames, not a plain "run once after mount" - this page
    // can be reached mid route-transition, so on the very first paint its
    // own chart containers can still be mid-layout (computed width/height
    // briefly 0), which is exactly what produces Recharts' "width(-1)
    // height(-1)" console warning below. One rAF lands right after the
    // first real paint; the second guards against that same paint still
    // being mid-layout on slower machines.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setChartsReady(true));
    });

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearInterval(timer);
    };
  }, []);

  // "Today's" numbers on this dashboard are defined purely by the Open
  // Shop -> Close Shop cycle (see ShopStatusControl in DashboardShell and
  // backend/controllers/shopSessionController.js) - not a fixed clock
  // window. While a shift is open, the window is [openedAt, now) and
  // ticks live; once closed, it freezes at [openedAt, closedAt) so the
  // final count for that shift stays visible until the next shift opens.
  useEffect(() => {
    if (cachedShopSession) setShopSession((current) => current ?? cachedShopSession);

    async function loadSession() {
      try {
        const history = await fetchShopSessionHistory();
        // Only ever UPGRADE to a real session here - never downgrade to null
        // just because this one poll's history array came back empty (a
        // transient blip, replica lag, etc). getBusinessWindow treats "no
        // session" as "match nothing", so a wrongful null here flashed every
        // shift-scoped stat on this dashboard to 0 a few seconds after they
        // first painted correctly from the cache, even though the shop was
        // genuinely still open the whole time.
        if (history && history.length > 0) setShopSession(history[0]);
      } catch (error) {
        console.error('Dashboard clinic session fetch error', error);
      }
    }

    void loadSession();
    const intervalId = setInterval(() => void loadSession(), 45000);
    return () => clearInterval(intervalId);
  }, [cachedShopSession]);

  // Fetch products once on mount for the low-stock widget; only orders
  // (which genuinely need to feel "live" for today's sales numbers) get
  // their own interval.
  useEffect(() => {
    fetchProducts()
      .then((productsRes) => {
        if (productsRes?.products) setProducts(productsRes.products);
      })
      .catch((error) => console.error('Dashboard Drs/Services fetch error', error));
  }, []);

  // Low Inventory Alert reads Medicine Stock (not Drs/Services).
  useEffect(() => {
    if (!hasPermission('inventory.manage') && !hasPermission('stock.manage')) {
      setMedicines([]);
      return;
    }
    fetchIngredients()
      .then((list) => setMedicines((list || []).filter((i) => i.isActive !== false).map((i) => ({ id: i.id, name: i.name, stock: Number(i.currentStock) || 0, unit: i.unit, lowStockThreshold: Number(i.lowStockThreshold) || 0, expiryDate: i.expiryDate, expiryAlertDays: i.expiryAlertDays }))))
      .catch(() => setMedicines([]));
  }, []);

  // Accounting Overview widgets (Total Sale, Customer Udhar/Advance, Cash
  // in Hand, Balance on Bank, Stock Value, Vendor Balance, Total Purchase/
  // Expenses/Recovery today, Sale on Cash/Bank/Credit) - one summary
  // endpoint (reportController.getDashboardSummary), refreshed on the same
  // 45s cadence as orders/session above so it stays live through a shift.
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [showAdjustCash, setShowAdjustCash] = useState(false);
  // Task 2: clicking the Cash in Hand tile opens its own history, same
  // style as Bank's. Task 1: every OTHER tile gets its own manual
  // correction (adjustTileKey) - see DashboardAdjustment.js. Task 3/1's
  // "Details" button reuses the same history modal for those tiles too
  // (historyTileKey; 'cash' is the one special case that hits /cash
  // instead of /dashboard-adjustments/:key). Task 4's Customer Advance
  // Details is its own simple list, not a khata-style history.
  const [showCashHistory, setShowCashHistory] = useState(false);
  const [adjustTileKey, setAdjustTileKey] = useState<DashboardAdjustmentKey | null>(null);
  const [historyTileKey, setHistoryTileKey] = useState<DashboardAdjustmentKey | null>(null);
  const [showCustomerAdvances, setShowCustomerAdvances] = useState(false);
  const [showRecoveryHistory, setShowRecoveryHistory] = useState(false);
  const [showStockValueDetail, setShowStockValueDetail] = useState(false);
  const [showVendorBalanceDetail, setShowVendorBalanceDetail] = useState(false);
  const [showSaleOnCashDetail, setShowSaleOnCashDetail] = useState(false);
  const [dueList, setDueList] = useState<'patient' | 'sale' | 'total' | null>(null);

  // Accounting Overview's Day/This Month/Custom filter ("yahan bhe date
  // honi chahy... day month aur year aur custom date ka hissab say states
  // update hona chahya") - defaults to Today, same as this section always
  // showed before this filter existed. Only re-fetches the summary (see
  // getDashboardSummary's own comment on which tiles this actually moves).
  const [summaryRange, setSummaryRange] = useState<'today' | 'month' | 'custom'>('today');
  const [summaryCustomFrom, setSummaryCustomFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [summaryCustomTo, setSummaryCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Clear button: brings one figure to $0. Recorded in its history (who,
  // when) and can be undone or deleted from there.
  async function handleClearTile(key: DashboardAdjustmentKey, value: number, label: string) {
    if (!(value > 0)) {
      popup({ tone: 'info', title: `Already ${cs()}0`, message: `${label} is already ${cs()}0.` });
      return;
    }
    const ok = await confirm(`Clear ${label} (${cs()}${Math.round(value).toLocaleString()}) to ${cs()}0? This is saved in its history - you can undo it from there.`, {
      title: `Clear to ${cs()}0`,
      confirmText: 'Clear',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await clearDashboardTile(key, value, label);
      await loadSummary();
      popup({ tone: 'success', title: 'Cleared', message: `${label} is now ${cs()}0. Open its History to undo.` });
    } catch (error) {
      popup({ tone: 'error', title: "Couldn't clear", message: error instanceof Error ? error.message : 'Failed to clear.' });
    }
  }

  async function handleClearCash() {
    const value = Number(summary?.cashInHand || 0);
    if (value === 0) {
      popup({ tone: 'info', title: `Already ${cs()}0`, message: `Cash in Hand is already ${cs()}0.` });
      return;
    }
    const ok = await confirm(`Clear Cash in Hand (${cs()}${Math.round(value).toLocaleString()}) to ${cs()}0? This is saved in its history - you can undo it from there.`, {
      title: `Clear to ${cs()}0`,
      confirmText: 'Clear',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await clearCash();
      await loadSummary();
      popup({ tone: 'success', title: 'Cleared', message: `Cash in Hand is now ${cs()}0. Open its History to undo.` });
    } catch (error) {
      popup({ tone: 'error', title: "Couldn't clear", message: error instanceof Error ? error.message : 'Failed to clear.' });
    }
  }

  async function loadSummary() {
    try {
      const data = await fetchDashboardSummary(
        summaryRange === 'custom'
          ? { range: 'custom', startDate: summaryCustomFrom, endDate: summaryCustomTo }
          : { range: summaryRange }
      );
      if (data) setSummary(data);
    } catch (error) {
      console.error('Dashboard accounting summary fetch error', error);
    }
  }

  useEffect(() => {
    void loadSummary();
    // Today/This Month don't need a live 45s refresh restart on their own
    // (the interval below already re-fires loadSummary regardless), but a
    // Custom range change should refetch immediately rather than waiting
    // for the next tick.
    const intervalId = setInterval(() => void loadSummary(), 45000);
    return () => clearInterval(intervalId);
  }, [summaryRange, summaryCustomFrom, summaryCustomTo]);

  useEffect(() => {
    // Always paints instantly from the Local Hub's cache first (see
    // offline-order-helpers.ts's loadOrdersFromLocalHub) - never a live
    // cloud call up front, so this never depends on connectivity or the
    // (laggy - see network-status.ts) isOnline flag being accurate at this
    // exact moment. The real cloud fetch below still runs whenever online,
    // in the background, refining this with up-to-date numbers and
    // refreshing the cache for next time.
    async function loadOrders() {
      if (isDesktopApp()) {
        try {
          setOrders(await loadOrdersFromLocalHub());
        } catch (error) {
          console.error('Dashboard appointments cache read error', error);
        }
        if (!isOnline) return;
      }

      try {
        // This page only ever shows "today's" (current/last shift) numbers
        // via the business-window filtering below - bounding the fetch to
        // the last 14 days (a generous margin over any realistic gap
        // between shifts) keeps this 45-second poll fast regardless of how
        // much order history this shop has accumulated overall. See
        // getOrders' `since` handling in orderController.js.
        //
        // fetchOrdersSummary (not fetchOrders) - on a shop with real order
        // history, "fast regardless of history size" turned out to still
        // mean 10+ seconds once you're transferring hundreds of FULL order
        // documents (complete items array, full customer object, etc.)
        // every 45 seconds, measured via debug timing on a live shop. This
        // page only ever reads status/total/createdAt/customer.phone/waiter
        // (see the stats/businessWindowData/topEmployees useMemos below),
        // so asking the server for just those fields cuts the actual data
        // transferred by roughly the same ratio full documents were bigger
        // than that. Deliberately NOT pushed into the shared Local Hub
        // order cache (pushOrdersCache) the way it used to be - that cache
        // is what Sales/Kitchen/Record's own offline fallbacks depend on
        // having full order data in, and this summary shape would silently
        // strip that down for everyone. offline-sync.ts's own periodic
        // pushCurrentOrdersCache() (full documents, no summary flag)
        // already keeps that cache fresh independently of this page.
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const ordersData = await fetchOrdersSummary({ since });
        if (ordersData) {
          setOrders(ordersData);
        }
      } catch (error) {
        console.error('Dashboard appointments fetch error', error);
      }
    }

    void loadOrders();

    const intervalId = setInterval(() => {
      void loadOrders();
    }, 45000);

    return () => clearInterval(intervalId);
  }, [isOnline]);

  const businessWindow = useMemo<BusinessWindow>(() => buildDashboardWindow(shopSession, currentTime), [shopSession, currentTime]);
  const businessOrders = useMemo(
    () => filterOrdersInBusinessWindow(orders, businessWindow),
    [orders, businessWindow],
  );

  const stats = useMemo<ServiceStats>(() => {
    let revenue = 0;
    let ordCount = 0;
    let comp = 0;
    let pend = 0;
    let canc = 0;
    const phones = new Set<string>();

    businessOrders.forEach((order) => {
      ordCount += 1;
      if (order.customer?.phone) phones.add(order.customer.phone);

      if (order.status === 'completed') {
        revenue += order.total;
        comp += 1;
      } else if (order.status === 'pending') {
        pend += 1;
      } else if (order.status === 'cancelled') {
        canc += 1;
      }
    });

    return {
      totalRevenue: revenue,
      totalOrders: ordCount,
      businessSales: revenue,
      avgValue: comp > 0 ? revenue / comp : 0,
      completed: comp,
      pending: pend,
      cancelled: canc,
      uniqueCustomers: phones.size,
    };
  }, [businessOrders]);

  const businessWindowData = useMemo(() => {
    if (!businessWindow.hasSession) return [];
    const data = createBusinessHourBuckets(businessWindow.start, businessWindow.end);

    businessOrders.forEach((order) => {
      if (!order.createdAt) return;
      const date = new Date(order.createdAt);
      const bucketIndex = data.findIndex((bucket) => date >= bucket.start && date < bucket.end);
      if (bucketIndex !== -1) {
        data[bucketIndex].orders += 1;
        if (order.status === 'completed') data[bucketIndex].profit += order.total * 0.4;
      }
    });

    return data.map(({ start: _start, end: _end, ...bucket }) => bucket);
  }, [businessOrders, businessWindow]);

  const lowStockProducts = useMemo<InventoryItem[] | null>(() => {
    if (medicines === null) return null;
    // Drs/Services names are left out (older ones had a stock entry of their own).
    const productNames = new Set(products.map((p) => p.name.trim().toLowerCase()));
    return medicines
      .filter((m) => !productNames.has(m.name.trim().toLowerCase()));
  }, [medicines, products]);

  const formatter = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          Dashboard <span className="text-xl">+</span>
        </h1>
        <p className="text-xs text-gray-400">Live business indicators generated from your POS transactions.</p>
        <p className={`text-xs font-bold uppercase tracking-[0.14em] ${businessWindow.isOpen ? 'text-emerald-600' : 'text-gray-500'}`}>{businessWindow.label}</p>
      </div>

      <AccountingOverview
        summary={summary}
        formatter={formatter}
        canAdjustCash={hasPermission('dues.manage')}
        range={summaryRange}
        onRangeChange={setSummaryRange}
        customFrom={summaryCustomFrom}
        onCustomFromChange={setSummaryCustomFrom}
        customTo={summaryCustomTo}
        onCustomToChange={setSummaryCustomTo}
        onAdjustCash={() => setShowAdjustCash(true)}
        onOpenCashHistory={() => setShowCashHistory(true)}
        onAdjustTile={(key) => setAdjustTileKey(key)}
        onOpenTileHistory={(key) => setHistoryTileKey(key)}
        onClearTile={(key, value, label) => void handleClearTile(key, value, label)}
        onClearCash={() => void handleClearCash()}
        onOpenCustomerAdvances={() => setShowCustomerAdvances(true)}
        onOpenRecoveryHistory={() => setShowRecoveryHistory(true)}
        onOpenStockValueDetail={() => setShowStockValueDetail(true)}
        onOpenVendorBalanceDetail={() => setShowVendorBalanceDetail(true)}
        onOpenSaleOnCashDetail={() => setShowSaleOnCashDetail(true)}
        onOpenDueList={(kind) => setDueList(kind)}
      />

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 min-w-0 space-y-6 lg:col-span-7">
          <div className="rounded-[32px] bg-white p-6 shadow-sm">
            <h3 className="mb-6 font-bold text-gray-800">Sales Overview</h3>
            {/* Stacked on phone - a half-width card here (icon + truncated
                text) had no room left for a real revenue figure like
                "$1,245,690", so it just showed "$1,245..." with no way
                to see the rest. Side-by-side again from tablet width up. */}
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StatCard title={`${cs()}${formatter.format(stats.totalRevenue)}`} subtitle="Total Revenue" trend="Live" color="bg-orange-50 text-orange-400" icon={<Target size={20} />} />
              <StatCard title={formatter.format(stats.totalOrders)} subtitle="Total Appointments" trend="Live" color="bg-purple-50 text-purple-400" icon={<Users size={20} />} />
            </div>

            <div className="relative min-w-0 overflow-hidden rounded-3xl border border-gray-50 bg-white p-4 h-48">
              <div className="relative z-10 flex items-start justify-between">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-500">
                      <Users size={16} />
                    </div>
                    <span className="text-2xl font-bold">{stats.uniqueCustomers}</span>
                  </div>
                  <p className="text-[10px] font-bold uppercase text-gray-400">Stored Database Patients</p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold">{cs()}{formatter.format(stats.businessSales)}</span>
                  <p className="text-[10px] font-bold uppercase text-gray-400">Active Business Day</p>
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 top-[72px] min-w-0">
                {chartsReady ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={businessWindowData} margin={{ top: 30, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorYellow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FBBF24" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#FBBF24" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="orders" stroke="#FBBF24" strokeWidth={3} fill="url(#colorYellow)" dot={false} />
                      <Tooltip />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>

            {/* Same reasoning as the StatCard row above - 3-across left
                almost no width per figure on a phone. */}
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <MiniStat label="Business Day Sales" value={`${cs()}${formatter.format(stats.businessSales)}`} />
              <MiniStat label="Transactions" value={formatter.format(stats.totalOrders)} />
              <MiniStat label="Avg. Appointment" value={`${cs()}${formatter.format(stats.avgValue)}`} valueColor="text-green-500" />
            </div>
          </div>

          <DrsServicesRevenue />
        </div>

        <div className="col-span-12 min-w-0 space-y-6 lg:col-span-5">
          <div className="rounded-[32px] bg-white p-6 shadow-sm">
            <div className="mb-8 flex items-center justify-between">
              <h3 className="font-bold">Appointments Overview</h3>
              <div className="flex gap-4 text-[10px] font-bold uppercase text-gray-400">
                <span className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full bg-orange-400" /> Appointments
                </span>
                <span className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full bg-purple-500" /> Est Profit
                </span>
              </div>
            </div>
            <div className="h-64 min-w-0">
              {chartsReady ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={businessWindowData}>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                    <YAxis hide />
                    <Tooltip />
                    <Line type="monotone" dataKey="orders" stroke="#FBBF24" strokeWidth={4} dot={false} />
                    <Line type="monotone" dataKey="profit" stroke="#8B5CF6" strokeWidth={4} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <StatusRing stats={stats} />
            <div className="space-y-4 rounded-[32px] bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold">Service Stats</h3>
              <ServiceRow label="Completed" value={stats.completed} percent={stats.totalOrders ? `${Math.round((stats.completed / stats.totalOrders) * 100)}%` : '0%'} color="text-green-500" icon={<CheckCircle2 size={14} />} />
              <ServiceRow label="Pending" value={stats.pending} percent={stats.totalOrders ? `${Math.round((stats.pending / stats.totalOrders) * 100)}%` : '0%'} color="text-orange-400" icon={<Clock size={14} />} />
              <ServiceRow label="Refunded" value={0} percent="0%" color="text-blue-400" icon={<RotateCcw size={14} />} />
              <ServiceRow label="Cancelled" value={stats.cancelled} percent={stats.totalOrders ? `${Math.round((stats.cancelled / stats.totalOrders) * 100)}%` : '0%'} color="text-red-400" icon={<XCircle size={14} />} />
            </div>
          </div>

        </div>
      </div>

      <StockAlertsSection items={lowStockProducts} />

      {showAdjustCash ? (
        <AdjustCashModal
          onClose={() => setShowAdjustCash(false)}
          onSubmit={async (amount, direction, note) => {
            try {
              const updated = await adjustCash(amount, direction, note);
              if (updated) {
                setSummary((prev: DashboardSummary | null) => (prev ? { ...prev, cashInHand: updated.balance } : prev));
                setShowAdjustCash(false);
                popup({ tone: 'success', title: 'Cash in Hand updated', message: `New balance: ${cs()}${updated.balance.toLocaleString()}` });
              }
            } catch (error) {
              popup({ tone: 'error', title: "Couldn't update Cash in Hand", message: error instanceof Error ? error.message : 'Failed to save.' });
            }
          }}
        />
      ) : null}

      {showCashHistory ? <CashHistoryModal canChange={hasPermission('dues.manage')} onChanged={() => void loadSummary()} onClose={() => setShowCashHistory(false)} /> : null}

      {adjustTileKey ? (
        <TileAdjustModal
          tileKey={adjustTileKey}
          onClose={() => setAdjustTileKey(null)}
          onSubmit={async (amount, direction, note) => {
            try {
              const result = await adjustDashboardTile(adjustTileKey, amount, direction, note);
              if (result) {
                setSummary((prev: DashboardSummary | null) => (prev ? { ...prev, [adjustTileKey]: result.total } : prev));
                setAdjustTileKey(null);
                popup({ tone: 'success', title: 'Updated', message: `New value: ${cs()}${result.total.toLocaleString()}` });
              }
            } catch (error) {
              popup({ tone: 'error', title: "Couldn't save correction", message: error instanceof Error ? error.message : 'Failed to save.' });
            }
          }}
        />
      ) : null}

      {historyTileKey ? <TileHistoryModal tileKey={historyTileKey} canChange={hasPermission('dues.manage')} onChanged={() => void loadSummary()} onClose={() => setHistoryTileKey(null)} /> : null}

      {dueList ? <DueListModal kind={dueList} summary={summary} onClose={() => setDueList(null)} /> : null}

      {showCustomerAdvances ? (
        <CustomerAdvancesModal advances={summary?.customerAdvances || []} onClose={() => setShowCustomerAdvances(false)} />
      ) : null}

      {showRecoveryHistory ? <RecoveryHistoryModal onClose={() => setShowRecoveryHistory(false)} /> : null}

      {showStockValueDetail ? <StockValueDetailModal onClose={() => setShowStockValueDetail(false)} /> : null}

      {showVendorBalanceDetail ? <VendorBalanceDetailModal onClose={() => setShowVendorBalanceDetail(false)} /> : null}

      {showSaleOnCashDetail ? (
        <SaleOnCashDetailModal
          range={summaryRange}
          customFrom={summaryCustomFrom}
          customTo={summaryCustomTo}
          onClose={() => setShowSaleOnCashDetail(false)}
        />
      ) : null}
    </div>
  );
}

// Accounting Overview - the AccCountry-style summary row the shop owner
// asked for (Total Sale, Customer Udhar/Advance, Cash in Hand, Balance on
// Bank, Stock Value, Vendor Balance, Total Purchase/Expenses/Recovery
// today, Sale on Cash/Bank/Credit). Cash in Hand is the one figure with no
// other place to fix a mistake (unlike Bank/Dues, which are already
// editable from their own pages), so it alone gets a Pencil/Adjust button
// here - gated the same way Bank/Dues actions are (dues.manage).
function AccountingOverview({
  summary,
  formatter,
  canAdjustCash,
  range,
  onRangeChange,
  customFrom,
  onCustomFromChange,
  customTo,
  onCustomToChange,
  onAdjustCash,
  onOpenCashHistory,
  onAdjustTile,
  onOpenTileHistory,
  onClearTile,
  onClearCash,
  onOpenCustomerAdvances,
  onOpenRecoveryHistory,
  onOpenStockValueDetail,
  onOpenVendorBalanceDetail,
  onOpenSaleOnCashDetail,
  onOpenDueList,
}: {
  summary: DashboardSummary | null;
  formatter: Intl.NumberFormat;
  canAdjustCash: boolean;
  range: 'today' | 'month' | 'custom';
  onRangeChange: (range: 'today' | 'month' | 'custom') => void;
  customFrom: string;
  onCustomFromChange: (value: string) => void;
  customTo: string;
  onCustomToChange: (value: string) => void;
  onAdjustCash: () => void;
  onOpenCashHistory: () => void;
  onAdjustTile: (key: DashboardAdjustmentKey) => void;
  onOpenTileHistory: (key: DashboardAdjustmentKey) => void;
  onClearTile: (key: DashboardAdjustmentKey, value: number, label: string) => void;
  onClearCash: () => void;
  onOpenCustomerAdvances: () => void;
  onOpenRecoveryHistory: () => void;
  onOpenStockValueDetail: () => void;
  onOpenVendorBalanceDetail: () => void;
  onOpenSaleOnCashDetail: () => void;
  onOpenDueList: (kind: 'patient' | 'sale' | 'total') => void;
}) {
  const money = (value: number | undefined) => `${cs()}${formatter.format(value ?? 0)}`;
  // Every "(Today)"-suffixed tile's label follows whichever range is
  // currently picked, so switching to This Month/Custom doesn't leave a
  // stale "(Today)" next to a figure that's no longer today's.
  const periodLabel = range === 'today' ? 'Today' : range === 'month' ? 'This Month' : `${customFrom || '...'} to ${customTo || '...'}`;
  // Cash in Hand / Balance on Bank are live balances, not period sums (see
  // getDashboardSummary's own comment) - for Today/This Month that's just
  // "now", but a Custom range in the past actually rewinds them to that
  // date's end-of-day balance, so the label says exactly which moment
  // they're showing instead of implying they moved with the other tiles.
  const balanceAsOfLabel = range === 'custom' ? `As of ${customTo || '...'}` : 'Live';
  // Task 1: every tile below (besides Cash in Hand, which owns its own
  // Adjust+History pair, and Balance on Bank, which is corrected from the
  // Bank page itself) gets the same Pencil (correct it) + History (see
  // past corrections) actions, wired to one shared DashboardAdjustment key.
  const tileLabel: Record<DashboardAdjustmentKey, string> = {
    totalSaleToday: `Total Sale (${periodLabel})`,
    customerUdharTotal: 'Patient Due',
    customerAdvanceTotal: 'Patient Advance',
    stockValue: 'Stock Value',
    vendorBalance: 'Vendor Balance',
    totalPurchaseToday: `Total Purchase (${periodLabel})`,
    totalExpensesToday: `Total Expenses (${periodLabel})`,
    saleOnCash: `Sale on Cash (${periodLabel})`,
    saleOnBank: `Sale on Bank (${periodLabel})`,
    saleOnCredit: `Sale on Due (${periodLabel})`,
    totalRecoveryToday: `Total Recovery (${periodLabel})`,
  } as Record<DashboardAdjustmentKey, string>;
  // Clear (to $0) - recorded in the tile's History, undoable there.
  const clearFor = (key: DashboardAdjustmentKey) =>
    canAdjustCash
      ? [{ icon: <Eraser size={12} />, onClick: () => onClearTile(key, Number((summary as unknown as Record<string, number> | null)?.[key] || 0), tileLabel[key] || 'This figure'), label: `Clear to ${cs()}0` }]
      : [];
  const actionsFor = (key: DashboardAdjustmentKey) =>
    canAdjustCash
      ? [
          ...clearFor(key),
          { icon: <Pencil size={12} />, onClick: () => onAdjustTile(key), label: 'Adjust' },
          { icon: <HistoryIcon size={12} />, onClick: () => onOpenTileHistory(key), label: 'History' },
        ]
      : [{ icon: <HistoryIcon size={12} />, onClick: () => onOpenTileHistory(key), label: 'History' }];
  // Customer Advance / Total Recovery already have their own dedicated
  // "Details" icon (the real customer-level breakdown - onOpenCustomerAdvances/
  // onOpenRecoveryHistory) - a second, separate correction-History icon
  // there just crowded the tile with two near-identical grey circular
  // buttons for what the owner sees as the same "show me more" action, so
  // only Adjust is added here on top of Details for these two.
  // These tiles already have a Details icon - Clear + Adjust are added, and
  // the correction History (where Clear can be undone) as "Corrections".
  const adjustOnlyFor = (key: DashboardAdjustmentKey) =>
    canAdjustCash
      ? [
          ...clearFor(key),
          { icon: <Pencil size={12} />, onClick: () => onAdjustTile(key), label: 'Adjust' },
          { icon: <Undo2 size={12} />, onClick: () => onOpenTileHistory(key), label: 'Corrections history' },
        ]
      : [];
  return (
    <div className="rounded-[32px] bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-800">Accounting Overview</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['today', 'month', 'custom'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onRangeChange(mode)}
              className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors ${range === mode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              {mode === 'today' ? 'Day' : mode === 'month' ? 'Month' : 'Custom'}
            </button>
          ))}
          {range === 'custom' ? (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => onCustomFromChange(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold outline-none focus:border-slate-400"
              />
              <span className="text-[10px] font-black text-slate-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => onCustomToChange(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold outline-none focus:border-slate-400"
              />
            </>
          ) : null}
        </div>
      </div>
      {summary?.startDate ? (
        <p className="-mt-4 mb-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          {summary.startDate === summary.endDate ? summary.startDate : `${summary.startDate} to ${summary.endDate}`}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <OverviewTile icon={<Target size={18} />} color="bg-orange-50 text-orange-500" label={`Total Sale (${periodLabel})`} value={money(summary?.totalSaleToday)} actions={[{ icon: <HistoryIcon size={12} />, onClick: () => onOpenDueList('total'), label: 'History' }, ...adjustOnlyFor('totalSaleToday')]} />
        <OverviewTile icon={<HandCoins size={18} />} color="bg-rose-50 text-rose-500" label="Patient Due" value={money(summary?.customerUdharTotal)} valueColor="text-rose-600" actions={[{ icon: <HistoryIcon size={12} />, onClick: () => onOpenDueList('patient'), label: 'History' }, ...adjustOnlyFor('customerUdharTotal')]} />
        <OverviewTile
          icon={<PiggyBank size={18} />}
          color="bg-emerald-50 text-emerald-500"
          label="Patient Advance"
          value={money(summary?.customerAdvanceTotal)}
          valueColor="text-emerald-600"
          actions={[
            { icon: <HistoryIcon size={12} />, onClick: onOpenCustomerAdvances, label: 'Details' },
            ...adjustOnlyFor('customerAdvanceTotal'),
          ]}
        />
        <OverviewTile
          icon={<Wallet size={18} />}
          color="bg-blue-50 text-blue-500"
          label={`Cash in Hand (${balanceAsOfLabel})`}
          value={money(summary?.cashInHand)}
          onTileClick={onOpenCashHistory}
          actions={[
            { icon: <HistoryIcon size={12} />, onClick: onOpenCashHistory, label: 'History' },
            ...(canAdjustCash
              ? [
                  { icon: <Eraser size={12} />, onClick: onClearCash, label: `Clear to ${cs()}0` },
                  { icon: <Pencil size={12} />, onClick: onAdjustCash, label: 'Adjust' },
                ]
              : []),
          ]}
        />
        <OverviewTile icon={<Landmark size={18} />} color="bg-indigo-50 text-indigo-500" label={`Balance on Bank (${balanceAsOfLabel})`} value={money(summary?.balanceOnBank)} />
        <OverviewTile
          icon={<Package size={18} />}
          color="bg-violet-50 text-violet-500"
          label="Stock Value"
          value={money(summary?.stockValue)}
          actions={[{ icon: <List size={12} />, onClick: onOpenStockValueDetail, label: 'Details' }, ...adjustOnlyFor('stockValue')]}
        />
        <OverviewTile
          icon={<Truck size={18} />}
          color="bg-amber-50 text-amber-600"
          label="Vendor Balance"
          value={money(summary?.vendorBalance)}
          valueColor="text-amber-700"
          actions={[{ icon: <List size={12} />, onClick: onOpenVendorBalanceDetail, label: 'Details' }, ...adjustOnlyFor('vendorBalance')]}
        />
        <OverviewTile icon={<ShoppingBag size={18} />} color="bg-slate-100 text-slate-500" label={`Total Purchase (${periodLabel})`} value={money(summary?.totalPurchaseToday)} actions={actionsFor('totalPurchaseToday')} />
        <OverviewTile icon={<Receipt size={18} />} color="bg-slate-100 text-slate-500" label={`Total Expenses (${periodLabel})`} value={money(summary?.totalExpensesToday)} actions={actionsFor('totalExpensesToday')} />
        <OverviewTile
          icon={<Wallet size={18} />}
          color="bg-blue-50 text-blue-500"
          label={`Sale on Cash (${periodLabel})`}
          value={money(summary?.saleOnCash)}
          actions={[{ icon: <List size={12} />, onClick: onOpenSaleOnCashDetail, label: 'Details' }, ...adjustOnlyFor('saleOnCash')]}
        />
        <OverviewTile icon={<Landmark size={18} />} color="bg-indigo-50 text-indigo-500" label={`Sale on Bank (${periodLabel})`} value={money(summary?.saleOnBank)} actions={actionsFor('saleOnBank')} />
        <OverviewTile icon={<HandCoins size={18} />} color="bg-rose-50 text-rose-500" label={`Sale on Due (Credit · ${periodLabel})`} value={money(summary?.saleOnCredit)} valueColor="text-rose-600" actions={[{ icon: <HistoryIcon size={12} />, onClick: () => onOpenDueList('sale'), label: 'History' }, ...adjustOnlyFor('saleOnCredit')]} />
        <OverviewTile
          icon={<CheckCircle2 size={18} />}
          color="bg-emerald-50 text-emerald-500"
          label={`Total Recovery (${periodLabel})`}
          value={money(summary?.totalRecoveryToday)}
          valueColor="text-emerald-600"
          actions={[{ icon: <List size={12} />, onClick: onOpenRecoveryHistory, label: 'Details' }, ...adjustOnlyFor('totalRecoveryToday')]}
        />
      </div>
    </div>
  );
}

function OverviewTile({
  icon,
  color,
  label,
  value,
  valueColor = 'text-gray-900',
  actions,
  onTileClick,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: string;
  valueColor?: string;
  actions?: { icon: React.ReactNode; onClick: () => void; label: string }[];
  onTileClick?: () => void;
}) {
  return (
    <div
      className={`relative rounded-2xl border border-gray-50 bg-[#F8F9FB] p-4 ${onTileClick ? 'cursor-pointer transition hover:border-gray-200' : ''}`}
      onClick={onTileClick}
      role={onTileClick ? 'button' : undefined}
    >
      <div className="flex items-center justify-between">
        <div className={`rounded-full p-2 ${color}`}>{icon}</div>
        {actions && actions.length > 0 ? (
          <div className="flex gap-1">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
                title={action.label}
                className="rounded-full bg-white p-1.5 text-gray-400 shadow-sm transition hover:bg-gray-100 hover:text-gray-700"
              >
                {action.icon}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <h4 className={`mt-3 truncate text-lg font-black xl:text-xl ${valueColor}`}>{value}</h4>
      <p className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
    </div>
  );
}

// Manual Cash-in-Hand correction - the owner's own explicit ask: every
// payment figure on the Dashboard must be editable so a mistake can be
// fixed. Same in/out direction idea as Bank's own addTransaction popup.
function AdjustCashModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (amount: number, direction: 'in' | 'out', note: string) => void;
}) {
  useBackspaceToClose(onClose);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const value = Number(amount);
    if (!value || value <= 0) return;
    setSaving(true);
    try {
      await onSubmit(value, direction, note.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-black text-gray-900">Adjust Cash in Hand</h2>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">Use this only to correct a mistake in the till's cash figure.</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection('in')}
            className={`rounded-[14px] py-2.5 text-xs font-black uppercase tracking-wide transition ${direction === 'in' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            Add (+)
          </button>
          <button
            type="button"
            onClick={() => setDirection('out')}
            className={`rounded-[14px] py-2.5 text-xs font-black uppercase tracking-wide transition ${direction === 'out' ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            Remove (-)
          </button>
        </div>

        <div className="mt-4">
          <label className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Amount</label>
          <input
            value={amount}
            onChange={(event) => {
              if (!/^\d*$/.test(event.target.value)) return;
              setAmount(event.target.value);
            }}
            placeholder="0"
            className="mt-1 w-full rounded-[16px] border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-gray-400"
          />
        </div>

        <div className="mt-4">
          <label className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Note (optional)</label>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why is this being corrected?"
            className="mt-1 w-full rounded-[16px] border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-gray-400"
          />
        </div>

        <button
          type="button"
          disabled={saving || !amount}
          onClick={() => void submit()}
          className="mt-5 w-full rounded-[20px] bg-black py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Correction'}
        </button>
      </div>
    </div>
  );
}

type HistoryRangeMode = 'all' | 'today' | 'month' | 'custom';

// Shared shell for the history-style modals below (Cash in Hand / a
// generic tile's corrections) - same in/out, dated, with-note list look as
// BankPage.tsx's own transaction history, just fed from whichever endpoint
// the caller already fetched. `pdfTitle`/`pdfFilename` turn on the same
// All/Today/This Month/Custom date-range pills BankPage.tsx's own history
// uses, plus a PDF download of whatever range is currently picked - the
// owner's own ask ("download pdf ho today month aur date custom vise").
// Purely a client-side filter/render concern - the real rows and their
// balanceAfter/totalAfter are never touched, same rule every other range
// filter in this app already follows.
interface HistoryRow {
  ref?: string;
  kind?: 'adjust' | 'clear' | 'undo';
  undone?: boolean;
  undoneBy?: string;
  undoneAt?: string;
  canChange?: boolean;
  direction: 'in' | 'out';
  amount: number;
  note: string;
  createdBy: string;
  createdAt: string;
  balanceAfter?: number;
}

function HistoryModalShell({
  title,
  subtitle,
  onClose,
  loading,
  rows,
  pdfTitle,
  pdfFilename,
  onUndo,
  onDelete,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  loading: boolean;
  rows: HistoryRow[];
  pdfTitle?: string;
  pdfFilename?: string;
  // Undo / Delete buttons per entry (only rows with canChange get them).
  onUndo?: (row: HistoryRow) => void;
  onDelete?: (row: HistoryRow) => void;
}) {
  useBackspaceToClose(onClose);
  const enableFilterAndPdf = Boolean(pdfTitle);
  const [rangeMode, setRangeMode] = useState<HistoryRangeMode>('all');
  const [customFrom, setCustomFrom] = useState(todayDateInputValue());
  const [customTo, setCustomTo] = useState(todayDateInputValue());
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const filteredRows = useMemo(() => {
    if (!enableFilterAndPdf || rangeMode === 'all') return rows;
    if (rangeMode === 'today') {
      const todayStr = todayDateInputValue();
      return rows.filter((row) => {
        const d = new Date(row.createdAt);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayStr;
      });
    }
    if (rangeMode === 'month') {
      const now = new Date();
      return rows.filter((row) => {
        const d = new Date(row.createdAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      });
    }
    if (!customFrom || !customTo) return rows;
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59.999`);
    return rows.filter((row) => {
      const d = new Date(row.createdAt);
      return d >= from && d <= to;
    });
  }, [rows, enableFilterAndPdf, rangeMode, customFrom, customTo]);

  const rangeLabel =
    rangeMode === 'today' ? 'Today'
    : rangeMode === 'month' ? 'This Month'
    : rangeMode === 'custom' ? `${customFrom} to ${customTo}`
    : 'All Time';

  async function handleDownloadPdf() {
    setIsDownloadingPdf(true);
    try {
      const { ReportPdfDocument, downloadPdfDocument } = await import('@/lib/pdf-export');
      const totalIn = filteredRows.filter((r) => r.direction === 'in').reduce((sum, r) => sum + r.amount, 0);
      const totalOut = filteredRows.filter((r) => r.direction === 'out').reduce((sum, r) => sum + r.amount, 0);
      const doc = (
        <ReportPdfDocument
          title={pdfTitle || title}
          subtitle={rangeLabel}
          stats={[
            { label: 'Total In', value: `${cs()}${totalIn.toLocaleString()}` },
            { label: 'Total Out', value: `${cs()}${totalOut.toLocaleString()}` },
            { label: 'Net', value: `${cs()}${(totalIn - totalOut).toLocaleString()}` },
          ]}
          tables={[
            {
              title: 'History',
              columns: [
                { label: 'Date', width: 1.3 },
                { label: 'Type', width: 0.8 },
                { label: 'Note', width: 1.8 },
                { label: 'By', width: 0.9 },
                { label: 'In', width: 0.9, align: 'right' },
                { label: 'Out', width: 0.9, align: 'right' },
                { label: 'Balance', width: 1, align: 'right' },
              ],
              // Balance (right-most, next to In/Out) - the owner's own ask:
              // every In/Out PDF should show the running total alongside
              // each entry, same as BankPage.tsx's own statement PDF
              // already does. This is each entry's real balanceAfter/
              // totalAfter as it was stored the moment it happened
              // (CashRegister.js / DashboardAdjustment.js) - never
              // recomputed/replayed here, so it stays correct however the
              // list is filtered or sorted.
              rows: filteredRows.map((row) => [
                new Date(row.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                row.direction === 'in' ? 'In' : 'Out',
                row.note || '—',
                row.createdBy || '—',
                row.direction === 'in' ? `${cs()}${row.amount.toLocaleString()}` : '—',
                row.direction === 'out' ? `${cs()}${row.amount.toLocaleString()}` : '—',
                row.balanceAfter === undefined ? '—' : `${cs()}${row.balanceAfter.toLocaleString()}`,
              ]),
              footer: ['', '', '', 'Total', `${cs()}${totalIn.toLocaleString()}`, `${cs()}${totalOut.toLocaleString()}`, ''],
              emptyMessage: 'No transactions in this range.',
            },
          ]}
        />
      );
      await downloadPdfDocument(doc, `${(pdfFilename || title).replace(/\s+/g, '_')}.pdf`);
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">{title}</h2>
            <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>

        {enableFilterAndPdf ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(['all', 'today', 'month', 'custom'] as HistoryRangeMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRangeMode(mode)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition ${rangeMode === mode ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}
              >
                {mode === 'all' ? 'All' : mode === 'today' ? 'Today' : mode === 'month' ? 'This Month' : 'Custom'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={isDownloadingPdf || filteredRows.length === 0}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-600 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDownloadingPdf ? 'Preparing...' : 'PDF'}
            </button>
          </div>
        ) : null}

        {enableFilterAndPdf && rangeMode === 'custom' ? (
          <div className="mt-2 flex items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold" />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold" />
          </div>
        ) : null}

        <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">Loading...</p>
          ) : filteredRows.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">No history yet.</p>
          ) : (
            <Paged items={filteredRows}>{(pagedRows) => pagedRows.map((row, index) => (
              <div key={row.ref || index} className={`flex items-center justify-between gap-2 rounded-2xl p-3 ${row.undone ? 'bg-gray-50 opacity-70' : row.kind === 'clear' ? 'bg-amber-50' : 'bg-[#F8F9FB]'}`}>
                <div className="min-w-0">
                  <p className={`flex flex-wrap items-center gap-1.5 text-sm font-black ${row.undone ? 'text-gray-400 line-through' : row.direction === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {row.direction === 'in' ? '+' : '-'}{cs()}{row.amount.toLocaleString()}
                    {row.kind === 'clear' ? <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800 no-underline">Cleared</span> : null}
                    {row.kind === 'undo' ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-black uppercase text-sky-700">Undo</span> : null}
                    {row.undone ? <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[9px] font-black uppercase text-gray-600">Undone</span> : null}
                  </p>
                  {row.undone && (row.undoneBy || row.undoneAt) ? (
                    <p className="text-[10px] font-bold text-gray-500">
                      Undone{row.undoneBy ? ` by ${row.undoneBy}` : ''}{row.undoneAt ? ` · ${new Date(row.undoneAt).toLocaleString()}` : ''}
                    </p>
                  ) : null}
                  {row.note ? <p className="truncate text-[11px] text-gray-500">{row.note}</p> : null}
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    {new Date(row.createdAt).toLocaleString()}
                    {row.createdBy ? ` · ${row.createdBy}` : ''}
                  </p>
                  {row.balanceAfter !== undefined ? (
                    <p className="text-[10px] font-bold text-gray-300">Balance after: {cs()}{row.balanceAfter.toLocaleString()}</p>
                  ) : null}
                </div>
                {row.canChange && row.ref && (onUndo || onDelete) ? (
                  <div className="flex shrink-0 gap-1">
                    {onUndo && !row.undone && row.kind !== 'undo' ? (
                      <button type="button" onClick={() => onUndo(row)} title="Undo" className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1.5 text-[10px] font-black text-sky-700 shadow-sm hover:bg-sky-50">
                        <Undo2 size={12} /> Undo
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button type="button" onClick={() => onDelete(row)} title="Delete from history" className="rounded-full bg-white p-1.5 text-rose-500 shadow-sm hover:bg-rose-50">
                        <Trash2 size={12} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}</Paged>
          )}
        </div>
      </div>
    </div>
  );
}

// Task 2: clicking the Cash in Hand tile - GET /api/cash's own history[],
// same data the "Adjust" pencil's balance already comes from.
function CashHistoryModal({ onClose, onChanged, canChange }: { onClose: () => void; onChanged: () => void; canChange: boolean }) {
  const { popup, confirm } = useToast();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<CashTransaction[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchCashSummary();
      if (!cancelled && data) setHistory(data.history || []);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<{ history?: CashTransaction[] } | undefined>, done: string) {
    try {
      const data = await action();
      if (data?.history) setHistory(data.history);
      onChanged();
      popup({ tone: 'success', title: 'Done', message: done });
    } catch (error) {
      popup({ tone: 'error', title: "Couldn't update", message: error instanceof Error ? error.message : 'Failed.' });
    }
  }

  return (
    <HistoryModalShell
      title="Cash in Hand History"
      subtitle="Every sale, due recovery, purchase, advance and refund that moved the till."
      onClose={onClose}
      loading={loading}
      pdfTitle="Cash in Hand History"
      pdfFilename="cash_in_hand_history"
      rows={history.map((entry) => ({
        ref: entry.ref,
        kind: entry.kind,
        undone: entry.undone,
        // Only manual corrections / clears can be undone or deleted.
        canChange: canChange && entry.type === 'adjustment',
        direction: entry.direction,
        amount: entry.amount,
        // Whose money it was (patient / vendor) next to what it was for.
        note: [entry.note || entry.type, entry.relatedCustomerName ? `${entry.direction === 'out' ? 'To' : 'From'}: ${entry.relatedCustomerName}${entry.relatedCustomerPhone ? ` (${entry.relatedCustomerPhone})` : ''}` : ''].filter(Boolean).join(' · '),
        createdBy: entry.createdBy || '',
        createdAt: entry.createdAt,
        balanceAfter: entry.balanceAfter,
      }))}
      onUndo={async (row) => {
        if (!row.ref) return;
        const ok = await confirm(`Undo this ${row.kind === 'clear' ? 'clear' : 'correction'} of ${cs()}${row.amount.toLocaleString()}? Cash in Hand goes back by the same amount.`, { title: 'Undo', confirmText: 'Undo' });
        if (ok) void run(() => undoCashEntry(row.ref!), 'Undone - Cash in Hand updated.');
      }}
      onDelete={async (row) => {
        if (!row.ref) return;
        const ok = await confirm(`Delete this entry (${cs()}${row.amount.toLocaleString()}) from the history? Its effect on Cash in Hand is removed too.`, { title: 'Delete history entry', confirmText: 'Delete', tone: 'danger' });
        if (ok) void run(() => deleteCashEntry(row.ref!), 'Entry deleted.');
      }}
    />
  );
}

// Task 1/3: history of manual corrections made to any other Accounting
// Overview tile - GET /api/dashboard-adjustments/:key/history.
function TileHistoryModal({ tileKey, onClose, onChanged, canChange }: { tileKey: DashboardAdjustmentKey; onClose: () => void; onChanged: () => void; canChange: boolean }) {
  const { popup, confirm } = useToast();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<DashboardAdjustmentHistoryEntry[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchDashboardAdjustmentHistory(tileKey);
      if (!cancelled && data) setHistory(data.history || []);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tileKey, reloadKey]);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      setReloadKey((k) => k + 1);
      onChanged();
      popup({ tone: 'success', title: 'Done', message: done });
    } catch (error) {
      popup({ tone: 'error', title: "Couldn't update", message: error instanceof Error ? error.message : 'Failed.' });
    }
  }

  return (
    <HistoryModalShell
      title="Correction History"
      subtitle="Manual corrections made to this figure - the real transactions behind it are never changed."
      onClose={onClose}
      loading={loading}
      pdfTitle="Correction History"
      pdfFilename={`${tileKey}_correction_history`}
      rows={history.map((entry) => ({ ...entry, balanceAfter: entry.totalAfter, canChange }))}
      onUndo={async (row) => {
        if (!row.ref) return;
        const ok = await confirm(`Undo this ${row.kind === 'clear' ? 'clear' : 'correction'} of ${cs()}${row.amount.toLocaleString()}? The figure goes back to what it was.`, { title: 'Undo', confirmText: 'Undo' });
        if (ok) void run(() => undoDashboardAdjustment(tileKey, row.ref!), 'Undone - the figure is back.');
      }}
      onDelete={async (row) => {
        if (!row.ref) return;
        const ok = await confirm(
          row.undone
            ? 'Delete this undone entry from the history?'
            : `Delete this entry (${cs()}${row.amount.toLocaleString()}) from the history? Its effect on the figure is removed too.`,
          { title: 'Delete history entry', confirmText: 'Delete', tone: 'danger' },
        );
        if (ok) void run(() => deleteDashboardAdjustment(tileKey, row.ref!), 'Entry deleted.');
      }}
    />
  );
}

// Task 1: the same manual +/- correction AdjustCashModal already does for
// Cash in Hand, generalized to any other tile via one shared endpoint.
function TileAdjustModal({
  tileKey,
  onClose,
  onSubmit,
}: {
  tileKey: DashboardAdjustmentKey;
  onClose: () => void;
  onSubmit: (amount: number, direction: 'in' | 'out', note: string) => void;
}) {
  useBackspaceToClose(onClose);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const value = Number(amount);
    if (!value || value <= 0) return;
    setSaving(true);
    try {
      await onSubmit(value, direction, note.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-black text-gray-900">Correct This Figure</h2>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">This only adjusts the number shown on the Dashboard - it never touches the real appointments/purchases/ledger behind it.</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection('in')}
            className={`rounded-[14px] py-2.5 text-xs font-black uppercase tracking-wide transition ${direction === 'in' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            Add (+)
          </button>
          <button
            type="button"
            onClick={() => setDirection('out')}
            className={`rounded-[14px] py-2.5 text-xs font-black uppercase tracking-wide transition ${direction === 'out' ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            Remove (-)
          </button>
        </div>

        <div className="mt-4">
          <label className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Amount</label>
          <input
            value={amount}
            onChange={(event) => {
              if (!/^\d*$/.test(event.target.value)) return;
              setAmount(event.target.value);
            }}
            placeholder="0"
            className="mt-1 w-full rounded-[16px] border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-gray-400"
          />
        </div>

        <div className="mt-4">
          <label className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Note (optional)</label>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why is this being corrected?"
            className="mt-1 w-full rounded-[16px] border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-gray-400"
          />
        </div>

        <button
          type="button"
          disabled={saving || !amount}
          onClick={() => void submit()}
          className="mt-5 w-full rounded-[20px] bg-black py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Correction'}
        </button>
      </div>
    </div>
  );
}

// Task 4: "just the customer name + their advance amount, nothing else".
function CustomerAdvancesModal({
  advances,
  onClose,
}: {
  advances: { name: string; phone: string; amount: number }[];
  onClose: () => void;
}) {
  useBackspaceToClose(onClose);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const total = advances.reduce((sum, c) => sum + c.amount, 0);
  // This is a live snapshot (every customer currently in credit right
  // now), not a dated transaction log - there's no single "date" a
  // standing advance balance happened on. The owner's own ask was for a
  // date to show anyway (same as every other history list in this app),
  // so this is the one meaningful date available: the moment this list
  // was generated/viewed - same "As of <date>" convention already used in
  // the PDF's own subtitle.
  const asOfDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Same "title, stats, one table" PDF style every other Details/History
  // download in this app already uses (Cash in Hand History, Recovery
  // History, Bank Statement) - name + advance amount, plus the same
  // Date-first-column look those other PDFs use.
  async function handleDownloadPdf() {
    setIsDownloadingPdf(true);
    try {
      const { ReportPdfDocument, downloadPdfDocument } = await import('@/lib/pdf-export');
      const doc = (
        <ReportPdfDocument
          title="Patient Advances"
          subtitle={`As of ${asOfDate}`}
          stats={[
            { label: 'Total Advance', value: `${cs()}${total.toLocaleString()}` },
            { label: 'Patients', value: String(advances.length) },
          ]}
          tables={[
            {
              title: 'Patients',
              columns: [
                { label: 'Date', width: 1.2 },
                { label: 'Patient', width: 1.8 },
                { label: 'Phone', width: 1.4 },
                { label: 'Advance', width: 1, align: 'right' },
              ],
              rows: advances.map((c) => [asOfDate, c.name, c.phone || '\u2014', `${cs()}${c.amount.toLocaleString()}`]),
              footer: ['', '', 'Total', `${cs()}${total.toLocaleString()}`],
              emptyMessage: 'No patient currently has an advance.',
            },
          ]}
        />
      );
      await downloadPdfDocument(doc, 'customer_advances.pdf');
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">Patient Advances</h2>
            <p className="mt-1 text-xs text-gray-400">Every patient who has paid the clinic more than they currently owe.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <p className="text-sm font-black text-emerald-600">Total: {cs()}{total.toLocaleString()}</p>
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={isDownloadingPdf || advances.length === 0}
            className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-600 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDownloadingPdf ? 'Preparing...' : 'PDF'}
          </button>
        </div>

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {advances.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">No patient currently has an advance.</p>
          ) : (
            <Paged items={advances}>{(pagedRows) => pagedRows.map((customer) => (
              <div key={customer.phone || customer.name} className="flex items-center justify-between rounded-2xl bg-[#F8F9FB] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-800">{customer.name}</p>
                  {customer.phone ? <p className="text-[10px] font-bold text-gray-500">{customer.phone}</p> : null}
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">As of {asOfDate}</p>
                </div>
                <p className="text-sm font-black text-emerald-600">{cs()}{customer.amount.toLocaleString()}</p>
              </div>
            ))}</Paged>
          )}
        </div>
      </div>
    </div>
  );
}

// Task 3: Stock Value "Details" - every stock item currently in the shop
// with its own current value (quantity x rate), so "Stock Value" isn't
// just one opaque total. A live snapshot (like Customer Advances above),
// fetched fresh each time the modal opens rather than reusing anything
// already on screen, since stock quantities/rates can change between the
// dashboard's own 45s summary refresh and the moment this is opened.
function StockValueDetailModal({ onClose }: { onClose: () => void }) {
  useBackspaceToClose(onClose);
  const [rows, setRows] = useState<StockValueDetailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchStockValueDetail()
      .then((res) => {
        if (cancelled) return;
        setRows(res?.rows || []);
        setTotal(res?.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load stock value details.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">Stock Value</h2>
            <p className="mt-1 text-xs text-gray-400">Every stock item and its current value.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>

        <p className="mt-3 text-sm font-black text-violet-600">Total: {cs()}{total.toLocaleString()}</p>

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">Loading...</p>
          ) : error ? (
            <p className="py-8 text-center text-xs font-bold text-rose-500">{error}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">No stock items found.</p>
          ) : (
            <Paged items={rows}>{(pagedRows) => pagedRows.map((item, index) => (
              <div key={`${item.name}-${index}`} className="flex items-center justify-between rounded-2xl bg-[#F8F9FB] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-800">{item.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    {item.quantity.toLocaleString()} {item.unit} × {cs()}{item.rate.toLocaleString()}
                  </p>
                </div>
                <p className="text-sm font-black text-violet-600">{cs()}{item.value.toLocaleString()}</p>
              </div>
            ))}</Paged>
          )}
        </div>
      </div>
    </div>
  );
}

// Task 4: Vendor Balance "Details" - every vendor (Khata-linked contacts
// flagged isVendor=true AND plain free-text company-name vendors) with
// their own outstanding balance, summing to the same total the Vendor
// Balance tile already shows (see getVendorBalanceDetail's own comment in
// reportController.js for how it reconciles to that exact figure).
function VendorBalanceDetailModal({ onClose }: { onClose: () => void }) {
  useBackspaceToClose(onClose);
  const [rows, setRows] = useState<VendorBalanceDetailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchVendorBalanceDetail()
      .then((res) => {
        if (cancelled) return;
        setRows(res?.rows || []);
        setTotal(res?.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load vendor balance details.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">Vendor Balance</h2>
            <p className="mt-1 text-xs text-gray-400">Every vendor and what is currently owed to them.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>

        <p className="mt-3 text-sm font-black text-amber-700">Total: {cs()}{total.toLocaleString()}</p>

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">Loading...</p>
          ) : error ? (
            <p className="py-8 text-center text-xs font-bold text-rose-500">{error}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">No vendor currently has a balance.</p>
          ) : (
            <Paged items={rows}>{(pagedRows) => pagedRows.map((vendor, index) => (
              <div key={`${vendor.name}-${index}`} className="flex items-center justify-between rounded-2xl bg-[#F8F9FB] p-3">
                <p className="truncate text-sm font-bold text-gray-800">{vendor.name}</p>
                <p className="text-sm font-black text-amber-700">{cs()}{vendor.balance.toLocaleString()}</p>
              </div>
            ))}</Paged>
          )}
        </div>
      </div>
    </div>
  );
}

// Task 5: Sale on Cash "Details" - the actual orders (Cash/Card/E-Wallet -
// everything that isn't Bank, same bucket getDashboardSummary itself uses)
// that made up the tile's total, for whichever range (Today/This Month/
// Custom) the dashboard's own top-level filter is currently set to - see
// getSaleOnCashDetail's own comment in reportController.js.
function SaleOnCashDetailModal({
  range,
  customFrom,
  customTo,
  onClose,
}: {
  range: 'today' | 'month' | 'custom';
  customFrom: string;
  customTo: string;
  onClose: () => void;
}) {
  useBackspaceToClose(onClose);
  const [rows, setRows] = useState<SaleOnCashDetailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchSaleOnCashDetail({ range, startDate: customFrom, endDate: customTo })
      .then((res) => {
        if (cancelled) return;
        setRows(res?.rows || []);
        setTotal(res?.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load sale details.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, customFrom, customTo]);

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">Sale on Cash</h2>
            <p className="mt-1 text-xs text-gray-400">Every appointment that made up this total.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>

        <p className="mt-3 text-sm font-black text-blue-600">Total: {cs()}{total.toLocaleString()}</p>

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">Loading...</p>
          ) : error ? (
            <p className="py-8 text-center text-xs font-bold text-rose-500">{error}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">No sale in this range yet.</p>
          ) : (
            <Paged items={rows}>{(pagedRows) => pagedRows.map((order, index) => (
              <div key={`${order.orderNumber ?? 'na'}-${index}`} className="flex items-center justify-between rounded-2xl bg-[#F8F9FB] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-800">
                    {order.orderNumber ? `#${order.orderNumber}` : 'Appointment'} · {order.customerName || 'Walk-in'}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    {order.paymentMethod} · {new Date(order.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <p className="text-sm font-black text-blue-600">{cs()}{order.amount.toLocaleString()}</p>
              </div>
            ))}</Paged>
          )}
        </div>
      </div>
    </div>
  );
}

// Patient Due / Sale on Due "Details": who owes, and which appointments
// were left unpaid in the range shown.
function DueListModal({ kind, summary, onClose }: { kind: 'patient' | 'sale' | 'total'; summary: DashboardSummary | null; onClose: () => void }) {
  useBackspaceToClose(onClose);
  const patientRows = summary?.patientDues || [];
  // 'total' = Total Sale: completed appointments (same row shape).
  const saleRows = kind === 'total' ? summary?.completedSaleRows || [] : summary?.saleOnCreditRows || [];
  const total = kind === 'patient' ? patientRows.reduce((sum, r) => sum + r.amount, 0) : saleRows.reduce((sum, r) => sum + r.amount, 0);
  const count = kind === 'patient' ? patientRows.length : saleRows.length;
  const [pdfBusy, setPdfBusy] = useState(false);
  const title = kind === 'patient' ? 'Patient Due' : kind === 'total' ? 'Total Sale' : 'Sale on Due';
  const tone = kind === 'total' ? 'text-orange-600' : 'text-rose-600';
  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const { ReportPdfDocument, downloadPdfDocument } = await import('@/lib/pdf-export');
      const m = (n: number) => `${cs()}${n.toLocaleString()}`;
      const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const asOf = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const range = summary?.startDate ? (summary.startDate === summary.endDate ? summary.startDate : `${summary.startDate} to ${summary.endDate}`) : '';
      const doc = (
        <ReportPdfDocument
          title={title}
          subtitle={kind === 'patient' ? `As of ${asOf}` : range}
          stats={[
            { label: 'Total', value: m(total) },
            { label: kind === 'patient' ? 'Patients' : 'Appointments', value: String(count) },
          ]}
          tables={[
            kind === 'patient'
              ? {
                  title: 'Patients',
                  columns: [
                    { label: 'Patient', width: 1.8 },
                    { label: 'Phone', width: 1.4 },
                    { label: 'Appointments', width: 1.1, align: 'right' },
                    { label: 'Old Due', width: 1, align: 'right' },
                    { label: 'Total Due', width: 1.1, align: 'right' },
                  ],
                  rows: patientRows.map((r) => [r.name, r.phone || '\u2014', m(r.fromAppointments), m(r.oldDues), m(r.amount)]),
                  footer: ['', '', '', 'Total', m(total)],
                  emptyMessage: 'Nothing due.',
                }
              : {
                  title: 'Appointments',
                  columns: [
                    { label: 'Date', width: 1.5 },
                    { label: 'No.', width: 0.6 },
                    { label: 'Patient', width: 1.7 },
                    { label: 'Phone', width: 1.3 },
                    { label: kind === 'total' ? 'Amount' : 'Due', width: 1, align: 'right' },
                  ],
                  rows: saleRows.map((r) => [when(r.createdAt), r.orderNumber ? `#${r.orderNumber}` : '\u2014', r.name, r.phone || '\u2014', m(r.amount)]),
                  footer: ['', '', '', 'Total', m(total)],
                  emptyMessage: 'Nothing due.',
                },
          ]}
        />
      );
      await downloadPdfDocument(doc, kind === 'patient' ? 'patient_due.pdf' : kind === 'total' ? 'total_sale.pdf' : 'sale_on_due.pdf');
    } finally {
      setPdfBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">{title}</h2>
            <p className="mt-1 text-xs text-gray-400">
              {kind === 'patient' ? 'Every patient who owes right now (all days).' : kind === 'total' ? 'Appointments completed in this range.' : 'Appointments left unpaid in this range.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className={`text-sm font-black ${tone}`}>Total: {cs()}{total.toLocaleString()}</p>
          <button type="button" onClick={() => void downloadPdf()} disabled={pdfBusy || count === 0} className="rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-600 transition hover:bg-emerald-100 disabled:opacity-40">
            {pdfBusy ? '...' : 'PDF'}
          </button>
        </div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {count === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">{kind === 'total' ? 'No completed appointment yet.' : 'Nothing due.'}</p>
          ) : kind === 'patient' ? (
            <Paged items={patientRows}>{(rows) => rows.map((row, index) => (
              <div key={`${row.phone}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl bg-[#F8F9FB] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-800">{row.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    {row.phone}
                    {row.fromAppointments > 0 && row.oldDues !== 0 ? ` · Appts ${cs()}${row.fromAppointments.toLocaleString()} · Old ${cs()}${row.oldDues.toLocaleString()}` : ''}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-black text-rose-600">{cs()}{row.amount.toLocaleString()}</p>
              </div>
            ))}</Paged>
          ) : (
            <Paged items={saleRows}>{(rows) => rows.map((row, index) => (
              <div key={`${row.orderNumber ?? 'na'}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl bg-[#F8F9FB] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-800">{row.orderNumber ? `#${row.orderNumber}` : 'Appointment'} · {row.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    {'doctor' in row && row.doctor ? `${row.doctor} · ` : ''}{row.phone ? `${row.phone} · ` : ''}{new Date(row.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <p className={`shrink-0 text-sm font-black ${tone}`}>{cs()}{row.amount.toLocaleString()}</p>
              </div>
            ))}</Paged>
          )}
        </div>
      </div>
    </div>
  );
}

function todayDateInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function firstOfMonthDateInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

// Task 3: Recovery "Details" - every real due-payment (Cash or Bank) any
// customer has made, with a Today/This Month/Custom/All date filter (same
// idea as IngredientStockSection.tsx's own Ledger range pills) and a CSV
// download. Recovery already flows automatically into Cash in Hand (a
// Cash-method payment) or that Bank's own balance (a Bank-method payment) -
// see customerController.settleCustomerDues - this modal is purely a read
// view of what already happened, nothing here changes any total.
type RecoveryRangeMode = 'all' | 'today' | 'month' | 'custom';

function RecoveryHistoryModal({ onClose }: { onClose: () => void }) {
  useBackspaceToClose(onClose);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RecoveryHistoryRow[]>([]);
  const [rangeMode, setRangeMode] = useState<RecoveryRangeMode>('all');
  const [customFrom, setCustomFrom] = useState(todayDateInputValue());
  const [customTo, setCustomTo] = useState(todayDateInputValue());

  const { startDate, endDate } = useMemo(() => {
    if (rangeMode === 'today') return { startDate: todayDateInputValue(), endDate: todayDateInputValue() };
    if (rangeMode === 'month') return { startDate: firstOfMonthDateInputValue(), endDate: todayDateInputValue() };
    if (rangeMode === 'custom') return { startDate: customFrom, endDate: customTo };
    return { startDate: undefined, endDate: undefined };
  }, [rangeMode, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const data = await fetchRecoveryHistory(startDate, endDate);
      if (!cancelled && data) setRows(data.rows || []);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const rangeLabel =
    rangeMode === 'today' ? 'Today'
    : rangeMode === 'month' ? 'This Month'
    : rangeMode === 'custom' ? `${customFrom} to ${customTo}`
    : 'All Time';

  // Same "title, stats, one table" ReportPdfDocument style every other
  // history download in this app uses (Cash in Hand/Correction History's
  // own PDF, BankPage.tsx's Bank Statement) - the owner's own ask was a
  // PDF here too, in that same style, not a CSV.
  async function download() {
    setIsDownloadingPdf(true);
    try {
      const { ReportPdfDocument, downloadPdfDocument } = await import('@/lib/pdf-export');
      const doc = (
        <ReportPdfDocument
          title="Recovery History"
          subtitle={rangeLabel}
          stats={[{ label: 'Total Recovery', value: `${cs()}${total.toLocaleString()}` }]}
          tables={[
            {
              title: 'History',
              columns: [
                { label: 'Date', width: 1.4 },
                { label: 'Type', width: 0.9 },
                { label: 'Note', width: 1.8 },
                { label: 'By', width: 1 },
                { label: 'In', width: 1, align: 'right' },
              ],
              rows: rows.map((row) => [
                new Date(row.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                row.paymentMethod === 'bank' ? row.bankName || 'Bank' : 'Cash',
                `${row.customerName}${row.note ? ` - ${row.note}` : ''}`,
                row.createdBy || '\u2014',
                `${cs()}${row.amount.toLocaleString()}`,
              ]),
              footer: ['', '', '', 'Total', `${cs()}${total.toLocaleString()}`],
              emptyMessage: 'No recovery in this range.',
            },
          ]}
        />
      );
      await downloadPdfDocument(doc, `recovery-history-${startDate || 'all'}-to-${endDate || 'all'}.pdf`);
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">Recovery History</h2>
            <p className="mt-1 text-xs text-gray-400">Every due payment collected from a patient, Cash or Bank.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F6F7FB] p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(['all', 'today', 'month', 'custom'] as RecoveryRangeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setRangeMode(mode)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition ${rangeMode === mode ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              {mode === 'all' ? 'All' : mode === 'today' ? 'Today' : mode === 'month' ? 'This Month' : 'Custom'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void download()}
            disabled={rows.length === 0 || isDownloadingPdf}
            className="ml-auto rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-600 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDownloadingPdf ? 'Preparing...' : 'PDF'}
          </button>
        </div>

        {rangeMode === 'custom' ? (
          <div className="mt-2 flex items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold" />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold" />
          </div>
        ) : null}

        <p className="mt-3 text-sm font-black text-emerald-600">Total: {cs()}{total.toLocaleString()}</p>

        <div className="mt-2 flex-1 space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-gray-400">No recovery in this range.</p>
          ) : (
            <Paged items={rows}>{(pagedRows) => pagedRows.map((row, index) => (
              <div key={index} className="flex items-center justify-between rounded-2xl bg-[#F8F9FB] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-800">{row.customerName}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    {new Date(row.createdAt).toLocaleString()} · {row.paymentMethod === 'bank' ? row.bankName || 'Bank' : 'Cash'}
                  </p>
                </div>
                <p className="text-sm font-black text-emerald-600">{cs()}{row.amount.toLocaleString()}</p>
              </div>
            ))}</Paged>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, subtitle, trend, color, icon }: { title: string; subtitle: string; trend: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-3xl border border-gray-50 bg-[#F8F9FB] p-4">
      <div className={`rounded-full p-3 ${color}`}>{icon}</div>
      <div className="min-w-0">
        <h4 className="truncate text-[17px] font-black xl:text-xl">{title}</h4>
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{subtitle}</p>
        <p className="mt-1 text-[10px] font-bold text-green-500">Live {trend}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, valueColor = 'text-black' }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="min-w-0">
      <h4 className={`truncate text-lg font-black xl:text-2xl ${valueColor}`}>{value}</h4>
      <p className="truncate text-[10px] font-bold uppercase text-gray-400">{label}</p>
    </div>
  );
}

function StatusRing({ stats }: { stats: ServiceStats }) {
  const percent = stats.totalOrders ? Math.round((stats.completed / stats.totalOrders) * 100) : 0;
  return (
    <div className="flex flex-col items-center rounded-[32px] bg-white p-5 shadow-sm">
      <h3 className="mb-4 self-start text-sm font-bold">Completion Rate</h3>
      <div className="relative mt-2 flex h-28 w-28 items-center justify-center">
        <div className="absolute inset-0 -rotate-[135deg] rounded-full border-[8px] border-cyan-400 border-r-transparent border-t-transparent" />
        <div className="absolute inset-0 rotate-45 rounded-full border-[8px] border-yellow-400 border-b-transparent border-l-transparent" />
        <div className="text-center">
          <span className="text-2xl font-black">{percent}%</span>
          <p className="text-[8px] font-bold text-gray-400">Done</p>
        </div>
      </div>
      <div className="mt-6 w-full space-y-2">
        <div className="flex justify-between text-[10px] font-bold">
          <span className="text-gray-400">Completed</span>
          <span>{stats.completed}</span>
        </div>
        <div className="flex justify-between text-[10px] font-bold">
          <span className="text-gray-400">Pending</span>
          <span>{stats.pending}</span>
        </div>
      </div>
    </div>
  );
}

// Stock Alerts: medicines that are expired / near expiry (inside their
// "alert days") and medicines that are low (below their low-stock level)
// or finished - two lists side by side.
function StockAlertsSection({ items }: { items: InventoryItem[] | null }) {
  const expiring = (items || [])
    .map((item) => ({ item, expiry: expiryStatus(item) }))
    .filter((row): row is { item: InventoryItem; expiry: NonNullable<ReturnType<typeof expiryStatus>> } => !!row.expiry && row.expiry.alert)
    .sort((a, b) => a.expiry.daysLeft - b.expiry.daysLeft);
  const low = (items || [])
    .filter((item) => item.stock <= 0 || ((item.lowStockThreshold || 0) > 0 && item.stock < (item.lowStockThreshold || 0)))
    .sort((a, b) => a.stock - b.stock);
  const qty = (n: number, unit?: string) => `${Math.round(n * 1000) / 1000}${unit ? ` ${unit}` : ''}`;
  return (
    <div className="rounded-[32px] bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-gray-800">Stock Alerts</h3>
        <Link to="/dashboard/ingredient-stock" className="text-[11px] font-bold text-[#009AAE] hover:underline">Open Medicine Stock</Link>
      </div>
      {items === null ? (
        <p className="text-xs font-bold text-gray-400">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-red-50 p-1.5 text-red-500"><CalendarClock size={14} /></span>
              <span className="text-sm font-bold text-gray-700">Expiry</span>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-600">{expiring.length}</span>
            </div>
            {expiring.length === 0 ? (
              <p className="rounded-2xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-400">No medicine is expired or near expiry.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {<Paged items={expiring}>{(pagedRows) => pagedRows.map(({ item, expiry }) => {
                  const expired = expiry.daysLeft < 0;
                  return (
                    <li key={String(item.id)} className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 ${expired ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'}`}>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-gray-800">{item.name}</p>
                        <p className="text-[10px] font-semibold text-gray-500">Exp {expiry.dateText} · {qty(item.stock, item.unit)} in stock</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${expired ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'}`}>
                        {expired ? 'EXPIRED' : expiry.daysLeft === 0 ? 'TODAY' : `${expiry.daysLeft} day${expiry.daysLeft === 1 ? '' : 's'} left`}
                      </span>
                    </li>
                  );
                })}</Paged>}
              </ul>
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-amber-50 p-1.5 text-amber-500"><AlertTriangle size={14} /></span>
              <span className="text-sm font-bold text-gray-700">Low Stock</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">{low.length}</span>
            </div>
            {low.length === 0 ? (
              <p className="rounded-2xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-400">No medicine is low on stock.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {<Paged items={low}>{(pagedRows) => pagedRows.map((item) => {
                  const out = item.stock <= 0;
                  return (
                    <li key={String(item.id)} className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 ${out ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-gray-800">{item.name}</p>
                        <p className="text-[10px] font-semibold text-gray-500">{item.lowStockThreshold ? `Alert below ${qty(item.lowStockThreshold, item.unit)}` : 'No alert level set'}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black text-white ${out ? 'bg-red-600' : 'bg-amber-500'}`}>
                        {out ? 'OUT OF STOCK' : `${qty(item.stock, item.unit)} left`}
                      </span>
                    </li>
                  );
                })}</Paged>}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceRow({ label, value, percent, color, icon }: { label: string; value: number; percent: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="group flex cursor-pointer items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`rounded-full bg-gray-50 p-1.5 ${color}`}>{icon}</div>
        <span className="text-xs font-bold text-gray-500">{label}</span>
      </div>
      <div className="flex gap-4">
        <span className="text-xs font-black">{value}</span>
        <span className={`w-10 text-right text-[10px] font-bold ${color}`}>{percent}</span>
      </div>
    </div>
  );
}

function formatTime(value: Date) {
  return value.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// The dashboard's "today" is exactly one ShopSession, computed by the
// shared getBusinessWindow (src/lib/shop-session.tsx - the single source
// of truth for this date-math, also used by Record/Sales) - no fixed clock
// hours involved. This just adds the header label text on top, which is
// display detail specific to this page. `history[0]` (most recent session,
// open or closed) is passed in from the effect above.
function buildDashboardWindow(session: ShopSession | null, now: Date): BusinessWindow {
  const window = getBusinessWindow(session, now);
  if (!window.hasSession) {
    return { ...window, label: 'No shift yet — open the clinic to start counting appointments' };
  }

  const label = window.isOpen
    ? `Open since ${formatWindowDate(window.start)} ${formatTime(window.start)} · Live`
    : `${formatWindowDate(window.start)} ${formatTime(window.start)} - ${formatWindowDate(window.end)} ${formatTime(window.end)} · Closed`;

  return { ...window, label };
}

function createBusinessHourBuckets(start: Date, end: Date) {
  const diffHours = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60));
  const length = diffHours > 0 ? diffHours : 24;

  return Array.from({ length }, (_, index) => {
    const bucketStart = new Date(start);
    bucketStart.setHours(start.getHours() + index, 0, 0, 0);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setHours(bucketStart.getHours() + 1, 0, 0, 0);
    return {
      name: bucketStart.toLocaleTimeString('en-PK', { hour: 'numeric', hour12: true }),
      start: bucketStart,
      end: bucketEnd,
      orders: 0,
      profit: 0,
    };
  });
}

function formatWindowDate(value: Date) {
  return value.toLocaleDateString('en-PK', {
    day: '2-digit',
    month: 'short',
  });
}
