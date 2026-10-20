// Dashboard panel: how much each Dr / each service has earned.
//
// Every non-cancelled appointment in the picked range is split by its
// items - a Dr's share of an appointment is that Dr's line total, and
// what was actually COLLECTED is that same share of the appointment's
// paid amount (so a half-paid 4,500 appointment counts 2,250 collected).
// Clicking a Dr/service opens its history (every appointment, patient,
// time slot, payment method, Online/Clinic) with a PDF download.
import { cs } from '@/lib/currency';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, Loader2, Stethoscope, Wrench, X } from 'lucide-react';
import { fetchOrders, fetchProducts } from '@/lib/pos-api';
import type { Product, SavedOrder } from '@/lib/pos-types';
import { formatAppointmentDate, formatSlot, isDoctorProduct, todayISO } from '@/lib/appointments';
import { useBackspaceToClose } from '@/lib/keyboard-shortcuts';
import { useToast } from '@/lib/toast';

type RangeMode = 'today' | 'month' | 'custom';
type Tab = 'drs' | 'services';

interface HistoryRow {
  orderId: string;
  createdAt: string;
  appointmentNo: string;
  patient: string;
  phone: string;
  slot: string;
  method: string;
  source: 'Online' | 'Clinic';
  billed: number;
  collected: number;
  status: SavedOrder['status'];
}

export interface EarnerStat {
  name: string;
  appointments: number;
  billed: number;
  collected: number;
  history: HistoryRow[];
}

function money(amount: number) {
  return `${cs()}${Math.round(amount || 0).toLocaleString()}`;
}

function startOfDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function rangeFor(mode: RangeMode, from: string, to: string) {
  const today = todayISO();
  if (mode === 'today') return { start: startOfDay(today), end: endOfDay(today), label: `Today (${formatAppointmentDate(today)})` };
  if (mode === 'month') {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: first, end: endOfDay(today), label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
  }
  const a = from || today;
  const b = to || today;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { start: startOfDay(lo), end: endOfDay(hi), label: `${formatAppointmentDate(lo)} - ${formatAppointmentDate(hi)}` };
}

export function buildStats(orders: SavedOrder[], products: Product[], tab: Tab): EarnerStat[] {
  const doctorNames = new Set(products.filter((p) => isDoctorProduct(p)).map((p) => p.name));
  const isDoctorName = (name: string) => doctorNames.has(name) || isDoctorProduct({ name });
  const byName = new Map<string, EarnerStat>();

  orders.forEach((order) => {
    if (order.status === 'cancelled') return;
    const itemsTotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const billTotal = Number(order.total ?? itemsTotal) || itemsTotal;
    const paid = Math.min(Number(order.paidAmount || 0), billTotal);
    const historyRow = (billed: number, collected: number): HistoryRow => ({
      orderId: order.id,
      createdAt: order.createdAt,
      appointmentNo: `#${String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0')}`,
      patient: order.customer?.name || 'Patient',
      phone: order.customer?.phone && order.customer.phone !== '03000000000' ? order.customer.phone : '',
      slot: order.appointmentTime ? `${formatAppointmentDate(order.appointmentDate)} ${formatSlot(order.appointmentTime)}` : '',
      method: paid > 0 ? (order.paymentMethod === 'Bank' && order.bankName ? `Bank - ${order.bankName}` : order.paymentMethod || 'Cash') : 'Unpaid',
      source: order.source === 'customer-qr' ? 'Online' : 'Clinic',
      billed,
      collected,
      status: order.status,
    });
    // Drs tab: the whole appointment goes to the Dr it was booked with -
    // including a Service the Dr did (booked in that Dr's slot).
    if (tab === 'drs' && order.doctorName && isDoctorName(order.doctorName)) {
      const stat = byName.get(order.doctorName) || { name: order.doctorName, appointments: 0, billed: 0, collected: 0, history: [] };
      stat.appointments += 1;
      stat.billed += billTotal;
      stat.collected += paid;
      stat.history.push(historyRow(billTotal, paid));
      byName.set(order.doctorName, stat);
      return;
    }
    order.items.forEach((item) => {
      const itemIsDoctor = isDoctorName(item.name);
      if ((tab === 'drs') !== itemIsDoctor) return;
      const lineTotal = item.price * item.quantity;
      const collected = itemsTotal > 0 ? (lineTotal / itemsTotal) * paid : 0;
      const stat = byName.get(item.name) || { name: item.name, appointments: 0, billed: 0, collected: 0, history: [] };
      stat.appointments += 1;
      stat.billed += lineTotal;
      stat.collected += collected;
      stat.history.push({
        orderId: order.id,
        createdAt: order.createdAt,
        appointmentNo: `#${String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0')}`,
        patient: order.customer?.name || 'Patient',
        phone: order.customer?.phone && order.customer.phone !== '03000000000' ? order.customer.phone : '',
        slot: order.appointmentTime ? `${formatAppointmentDate(order.appointmentDate)} ${formatSlot(order.appointmentTime)}` : '',
        method: paid > 0 ? (order.paymentMethod === 'Bank' && order.bankName ? `Bank - ${order.bankName}` : order.paymentMethod || 'Cash') : 'Unpaid',
        source: order.source === 'customer-qr' ? 'Online' : 'Clinic',
        billed: lineTotal,
        collected,
        status: order.status,
      });
      byName.set(item.name, stat);
    });
  });

  return [...byName.values()]
    .map((stat) => ({ ...stat, history: stat.history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }))
    .sort((a, b) => b.collected - a.collected || a.name.localeCompare(b.name));
}

export default function DrsServicesRevenue() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [tab, setTab] = useState<Tab>('drs');
  const [mode, setMode] = useState<RangeMode>('today');
  const [from, setFrom] = useState(() => todayISO());
  const [to, setTo] = useState(() => todayISO());
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const range = useMemo(() => rangeFor(mode, from, to), [mode, from, to]);

  useEffect(() => {
    fetchProducts()
      .then((result) => setProducts(result.products || []))
      .catch(() => setProducts([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list: SavedOrder[] = (await fetchOrders({ since: range.start.toISOString() })) || [];
      const endTime = range.end.getTime();
      setOrders(list.filter((order: SavedOrder) => new Date(order.createdAt).getTime() <= endTime));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load appointments.');
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => buildStats(orders, products, tab), [orders, products, tab]);
  const totals = useMemo(() => stats.reduce((acc, s) => ({ collected: acc.collected + s.collected, billed: acc.billed + s.billed }), { collected: 0, billed: 0 }), [stats]);
  const selectedStat = stats.find((s) => s.name === selected) || null;

  return (
    <div className="rounded-[32px] bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold">Drs &amp; Services</h3>
        <div className="flex gap-1 rounded-full bg-gray-100 p-1">
          <button type="button" onClick={() => setTab('drs')} className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-black ${tab === 'drs' ? 'bg-black text-white' : 'text-gray-500'}`}>
            <Stethoscope size={13} /> Drs
          </button>
          <button type="button" onClick={() => setTab('services')} className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-black ${tab === 'services' ? 'bg-black text-white' : 'text-gray-500'}`}>
            <Wrench size={13} /> Services
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['today', 'month', 'custom'] as RangeMode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-xl px-3 py-1.5 text-xs font-black ${mode === value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {value === 'today' ? 'Today' : value === 'month' ? 'This Month' : 'Custom'}
          </button>
        ))}
        {mode === 'custom' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="date" value={from} max={todayISO()} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-bold outline-none" />
            <span className="text-xs font-bold text-gray-400">to</span>
            <input type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="rounded-xl border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-bold outline-none" />
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-gray-400">
        <span className="flex items-center gap-1"><CalendarDays size={12} />{range.label}</span>
        <span>
          Collected <span className="text-emerald-600">{money(totals.collected)}</span>
          {' · '}Due <span className="text-rose-600">{money(Math.max(totals.billed - totals.collected, 0))}</span>
          {' · '}Billed {money(totals.billed)}
        </span>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p> : null}

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm font-bold text-gray-400"><Loader2 size={16} className="animate-spin" />Loading...</p>
      ) : stats.length === 0 ? (
        <p className="py-8 text-center text-sm font-bold text-gray-400">No {tab === 'drs' ? 'Dr' : 'service'} appointments in this range.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {stats.map((stat) => (
            <button
              key={stat.name}
              type="button"
              onClick={() => setSelected(stat.name)}
              className="flex w-full items-center justify-between gap-3 py-3 text-left transition hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-gray-900">{stat.name}</p>
                <p className="text-[11px] font-semibold text-gray-400">{stat.appointments} appointment{stat.appointments === 1 ? '' : 's'} · billed {money(stat.billed)}</p>
              </div>
              <div className="flex shrink-0 gap-4 text-right">
                <div>
                  <p className="font-black text-emerald-600">{money(stat.collected)}</p>
                  <p className="text-[10px] font-bold uppercase text-gray-400">collected</p>
                </div>
                <div>
                  <p className={`font-black ${stat.billed - stat.collected > 0.5 ? 'text-rose-600' : 'text-gray-300'}`}>{money(Math.max(stat.billed - stat.collected, 0))}</p>
                  <p className="text-[10px] font-bold uppercase text-gray-400">due</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedStat ? (
        <HistoryModal stat={selectedStat} kind={tab} rangeLabel={range.label} onClose={() => setSelected(null)} onError={(m) => toastRef.current.error(m)} />
      ) : null}
    </div>
  );
}

function HistoryModal({ stat, kind, rangeLabel, onClose, onError }: { stat: EarnerStat; kind: Tab; rangeLabel: string; onClose: () => void; onError: (message: string) => void }) {
  useBackspaceToClose(onClose);
  const [downloading, setDownloading] = useState(false);
  const unpaid = stat.billed - stat.collected;

  async function downloadPdf() {
    setDownloading(true);
    try {
      const { ReportPdfDocument, downloadPdfDocument } = await import('@/lib/pdf-export');
      const doc = (
        <ReportPdfDocument
          title={`${stat.name} - ${kind === 'drs' ? 'Dr' : 'Service'} Earnings`}
          subtitle={`${rangeLabel} · ${stat.appointments} appointment${stat.appointments === 1 ? '' : 's'}`}
          stats={[
            { label: 'Collected', value: money(stat.collected) },
            { label: 'Billed', value: money(stat.billed) },
            { label: 'Still Due', value: money(Math.max(unpaid, 0)) },
          ]}
          tables={[
            {
              title: 'Payment History',
              columns: [
                { label: 'Booked', width: 1.6 },
                { label: 'Appt', width: 0.8 },
                { label: 'Patient', width: 2 },
                { label: 'Time Slot', width: 1.8 },
                { label: 'Paid Via', width: 1.3 },
                { label: 'From', width: 0.9 },
                { label: 'Billed', width: 1.1, align: 'right' },
                { label: 'Collected', width: 1.2, align: 'right' },
              ],
              rows: stat.history.map((row) => [
                new Date(row.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
                row.appointmentNo,
                row.phone ? `${row.patient} (${row.phone})` : row.patient,
                row.slot || '-',
                row.method,
                row.source,
                money(row.billed),
                money(row.collected),
              ]),
              footer: ['Total', '', '', '', '', '', money(stat.billed), money(stat.collected)],
              emptyMessage: 'No appointments in this range.',
            },
          ]}
        />
      );
      const safeName = stat.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await downloadPdfDocument(doc, `${safeName}-earnings.pdf`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the PDF.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-[32px] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-6">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-indigo-500">{kind === 'drs' ? 'Dr' : 'Service'} history · {rangeLabel}</p>
            <h2 className="text-2xl font-black text-gray-900">{stat.name}</h2>
            <p className="mt-1 text-xs font-bold text-gray-500">
              {stat.appointments} appointment{stat.appointments === 1 ? '' : 's'} · collected <span className="text-emerald-600">{money(stat.collected)}</span> · billed {money(stat.billed)}
              {unpaid > 0.5 ? <> · <span className="text-rose-600">{money(unpaid)} due</span></> : null}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void downloadPdf()} disabled={downloading} className="flex items-center gap-2 rounded-2xl bg-black px-4 py-2.5 text-xs font-black text-white disabled:opacity-60">
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} PDF
            </button>
            <button type="button" onClick={onClose} className="rounded-full bg-gray-100 p-2.5 text-gray-500 hover:bg-gray-200"><X size={16} /></button>
          </div>
        </div>
        <div className="overflow-auto p-6">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                <th className="pb-2">Booked</th>
                <th className="pb-2">Appt</th>
                <th className="pb-2">Patient</th>
                <th className="pb-2">Time Slot</th>
                <th className="pb-2">Paid Via</th>
                <th className="pb-2">From</th>
                <th className="pb-2 text-right">Billed</th>
                <th className="pb-2 text-right">Collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stat.history.map((row) => (
                <tr key={`${row.orderId}-${row.createdAt}`}>
                  <td className="py-2.5 text-xs font-semibold text-gray-500">{new Date(row.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-2.5 text-xs font-black text-gray-700">{row.appointmentNo}</td>
                  <td className="py-2.5">
                    <p className="font-bold text-gray-900">{row.patient}</p>
                    {row.phone ? <p className="text-[11px] text-gray-400">{row.phone}</p> : null}
                  </td>
                  <td className="py-2.5 text-xs font-semibold text-gray-600">{row.slot || '-'}</td>
                  <td className={`py-2.5 text-xs font-black ${row.method === 'Unpaid' ? 'text-rose-600' : 'text-gray-700'}`}>{row.method}</td>
                  <td className="py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${row.source === 'Online' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>{row.source}</span>
                  </td>
                  <td className="py-2.5 text-right text-xs font-bold text-gray-500">{money(row.billed)}</td>
                  <td className="py-2.5 text-right font-black text-emerald-600">{money(row.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
