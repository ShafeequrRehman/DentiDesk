// Dr / Service Payments: what each Dr and Service earned - billed,
// collected, dues recovered, advance used - for Today / This Month /
// a custom range, what's still due on them right now and the advance
// patients keep for them. Click one for the lines behind every figure,
// add a payment against a due, remove a wrong one, or download a PDF.
// Data: backend providerPaymentsController.js (from Order.payments).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, HandCoins, Loader2, Plus, RefreshCcw, Stethoscope, Trash2, Wrench, X } from 'lucide-react';
import { addProviderPayment, fetchBanks, fetchProviderPayments, removeProviderPayment, type ProviderPaymentRow } from '@/lib/pos-api';
import type { Bank } from '@/lib/pos-types';
import { formatAppointmentDate, todayISO } from '@/lib/appointments';
import { cs } from '@/lib/currency';
import { useToast } from '@/lib/toast';
import { useBackspaceToClose } from '@/lib/keyboard-shortcuts';
import { Paged } from '@/components/Paged';

type Tab = 'dr' | 'service';
type RangeMode = 'today' | 'month' | 'custom';

function money(value: number) {
  return `${cs()}${Math.round(value || 0).toLocaleString()}`;
}

function monthStartISO() {
  const now = new Date();
  return todayISO(new Date(now.getFullYear(), now.getMonth(), 1));
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const KIND_LABEL: Record<string, string> = {
  payment: 'Paid',
  recovery: 'Due recovered',
  advance: 'Advance used',
  adjust: 'Correction',
  setoff: 'Purchase adjusted',
};

const KIND_TONE: Record<string, string> = {
  payment: 'bg-emerald-50 text-emerald-700',
  recovery: 'bg-sky-50 text-sky-700',
  advance: 'bg-violet-50 text-violet-700',
  adjust: 'bg-amber-50 text-amber-700',
  setoff: 'bg-teal-50 text-teal-700',
};

export default function DrPaymentsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('dr');
  const [mode, setMode] = useState<RangeMode>('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<ProviderPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const range = useMemo(() => {
    if (mode === 'today') return { from: todayISO(), to: todayISO(), label: `Today (${formatAppointmentDate(todayISO())})` };
    if (mode === 'month') return { from: monthStartISO(), to: todayISO(), label: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return { from: lo, to: hi, label: `${formatAppointmentDate(lo)} - ${formatAppointmentDate(hi)}` };
  }, [mode, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProviderPayments(range.from, range.to);
      setRows(data?.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payments.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const list = useMemo(() => rows.filter((r) => r.type === tab), [rows, tab]);
  const totals = useMemo(
    () =>
      list.reduce(
        (acc, r) => ({
          billed: acc.billed + r.billed,
          collected: acc.collected + r.collected,
          recovered: acc.recovered + r.recovered,
          advanceUsed: acc.advanceUsed + r.advanceUsed,
          purchaseAdjusted: acc.purchaseAdjusted + (r.purchaseAdjusted || 0),
          remainingDue: acc.remainingDue + r.remainingDue,
          advanceHeld: acc.advanceHeld + r.advanceHeld,
        }),
        { billed: 0, collected: 0, recovered: 0, advanceUsed: 0, purchaseAdjusted: 0, remainingDue: 0, advanceHeld: 0 },
      ),
    [list],
  );
  const selectedRow = list.find((r) => r.name === selected) || rows.find((r) => r.name === selected) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-gray-900">
            Dr / Service Payments <HandCoins className="text-[#00B0C7]" size={30} />
          </h1>
          <p className="font-bold text-gray-500">Collected, dues recovered, advance used and what's still due - per Dr and Service.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-gray-600 shadow-sm hover:bg-gray-50">
            <RefreshCcw size={15} /> Refresh
          </button>
          <div className="flex gap-1 rounded-full bg-white p-1.5 shadow-sm">
            <button type="button" onClick={() => setTab('dr')} className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-black ${tab === 'dr' ? 'bg-black text-white' : 'text-gray-500'}`}>
              <Stethoscope size={14} /> Drs
            </button>
            <button type="button" onClick={() => setTab('service')} className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-black ${tab === 'service' ? 'bg-black text-white' : 'text-gray-500'}`}>
              <Wrench size={14} /> Services
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['today', 'month', 'custom'] as RangeMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide ${mode === m ? 'bg-[#00B0C7] text-white shadow' : 'bg-white text-gray-500 shadow-sm'}`}
          >
            {m === 'today' ? 'Today' : m === 'month' ? 'This Month' : 'Custom'}
          </button>
        ))}
        {mode === 'custom' ? (
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={todayISO()} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold outline-none" />
            <span className="text-xs font-bold text-gray-400">to</span>
            <input type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold outline-none" />
          </div>
        ) : null}
        <span className="flex items-center gap-1 text-xs font-bold text-gray-400"><CalendarDays size={13} /> {range.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Billed" value={money(totals.billed)} tone="text-gray-900" hint="Appointments in range" />
        <Stat label="Collected" value={money(totals.collected)} tone="text-emerald-600" hint="Cash + bank in range" />
        <Stat label="Due recovered" value={money(totals.recovered)} tone="text-sky-600" hint="Part of collected" />
        <Stat label="Advance used" value={money(totals.advanceUsed)} tone="text-violet-600" hint="From patients' advance" />
        <Stat label="Purchase adjusted" value={money(totals.purchaseAdjusted)} tone="text-teal-600" hint="Set off against purchases" />
        <Stat label="Remaining due" value={money(totals.remainingDue)} tone="text-rose-600" hint="Right now, all dates" />
      </div>

      {error ? <div className="rounded-[20px] bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div> : null}

      <div className="overflow-hidden rounded-[28px] bg-white shadow-sm">
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-12 text-sm font-bold text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading...</p>
        ) : list.length === 0 ? (
          <p className="py-12 text-center text-sm font-bold text-gray-400">No {tab === 'dr' ? 'Dr' : 'Service'} payments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-6 py-4">{tab === 'dr' ? 'Dr' : 'Service'}</th>
                  <th className="px-4 py-4 text-right">Billed</th>
                  <th className="px-4 py-4 text-right">Collected</th>
                  <th className="px-4 py-4 text-right">Due recovered</th>
                  <th className="px-4 py-4 text-right">Advance used</th>
                  <th className="px-4 py-4 text-right">Remaining due</th>
                  <th className="px-6 py-4 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map((row) => (
                  <tr key={row.name} onClick={() => setSelected(row.name)} className="cursor-pointer transition hover:bg-[#EBFAFC]/60">
                    <td className="px-6 py-4">
                      <p className="font-black text-gray-900">{row.name}</p>
                      <p className="text-[11px] font-semibold text-gray-400">{row.appointments} appointment{row.appointments === 1 ? '' : 's'} in range</p>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-bold text-gray-700">{money(row.billed)}</td>
                    <td className="px-4 py-4 text-right text-sm font-black text-emerald-600">{money(row.collected)}</td>
                    <td className="px-4 py-4 text-right text-sm font-bold text-sky-600">{money(row.recovered)}</td>
                    <td className="px-4 py-4 text-right text-sm font-bold text-violet-600">{money(row.advanceUsed)}</td>
                    <td className={`px-4 py-4 text-right text-sm font-black ${row.remainingDue > 0.5 ? 'text-rose-600' : 'text-gray-300'}`}>{money(row.remainingDue)}</td>
                    <td className="px-6 py-4 text-right text-base font-black text-gray-900">{money(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRow ? (
        <DetailModal row={selectedRow} rangeLabel={range.label} onClose={() => setSelected(null)} onChanged={() => setReloadKey((k) => k + 1)} toast={toast} />
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone: string; hint: string }) {
  return (
    <div className="rounded-[22px] bg-white p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-black ${tone}`}>{value}</p>
      <p className="text-[10px] font-semibold text-gray-400">{hint}</p>
    </div>
  );
}

type DetailTab = 'payments' | 'dues' | 'appointments';

function DetailModal({
  row,
  rangeLabel,
  onClose,
  onChanged,
  toast,
}: {
  row: ProviderPaymentRow;
  rangeLabel: string;
  onClose: () => void;
  onChanged: () => void;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const { confirm } = useToast();
  const [tab, setTab] = useState<DetailTab>('payments');
  const [downloading, setDownloading] = useState(false);
  const [payFor, setPayFor] = useState<ProviderPaymentRow['dues'][number] | null>(null);
  // Find a patient by name or phone in the lists below.
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const hit = (patient: string, phone: string) => !q || patient.toLowerCase().includes(q) || phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\u0000');
  const payments = row.payments.filter((p) => hit(p.patient, p.phone));
  const dues = row.dues.filter((d) => hit(d.patient, d.phone));
  const appointmentsList = row.appointmentsList.filter((a) => hit(a.patient, a.phone));
  useBackspaceToClose(onClose);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const { ReportPdfDocument, downloadPdfDocument } = await import('@/lib/pdf-export');
      const doc = (
        <ReportPdfDocument
          title={`${row.name} - Payments`}
          subtitle={rangeLabel}
          stats={[
            { label: 'Billed', value: money(row.billed) },
            { label: 'Collected', value: money(row.collected) },
            { label: 'Due recovered', value: money(row.recovered) },
            { label: 'Advance used', value: money(row.advanceUsed) },
            { label: 'Purchase adjusted', value: money(row.purchaseAdjusted || 0) },
            { label: 'Remaining due', value: money(row.remainingDue) },
            { label: 'Net', value: money(row.net) },
          ]}
          tables={[
            {
              title: 'Payments in this period',
              columns: [
                { label: 'Date', width: 1.1 },
                { label: 'Appt', width: 0.6 },
                { label: 'Patient', width: 1.4 },
                { label: 'Type', width: 1.1 },
                { label: 'Via', width: 0.7 },
                { label: 'Amount', width: 0.9, align: 'right' as const },
              ],
              rows: row.payments.map((p) => [shortDate(p.date), p.label, p.patient, KIND_LABEL[p.kind] || p.kind, p.kind === 'advance' ? 'Advance' : p.kind === 'setoff' ? 'Purchase' : p.method, money(p.amount)]),
              footer: ['Total', '', '', '', '', money(row.net)],
              emptyMessage: 'No payments in this period.',
            },
            {
              title: 'Still due (all dates)',
              columns: [
                { label: 'Date', width: 1.1 },
                { label: 'Appt', width: 0.6 },
                { label: 'Patient', width: 1.6 },
                { label: 'Phone', width: 1.1 },
                { label: 'Due', width: 0.9, align: 'right' as const },
              ],
              rows: row.dues.map((d) => [shortDate(d.date), d.label, d.patient, d.phone || '-', money(d.due)]),
              footer: ['Total', '', '', '', money(row.remainingDue)],
              emptyMessage: 'Nothing due.',
            },
          ]}
        />
      );
      await downloadPdfDocument(doc, `${row.name.replace(/[^a-z0-9]+/gi, '_')}-payments.pdf`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make the PDF.');
    } finally {
      setDownloading(false);
    }
  }

  async function removeLine(line: ProviderPaymentRow['payments'][number]) {
    if (!line.id) {
      toast.error('This older payment has no history line to remove - edit the appointment instead.');
      return;
    }
    const where = line.kind === 'advance' ? "back to the patient's advance" : line.method === 'Bank' ? 'out of the bank' : 'out of Cash in Hand';
    const ok = await confirm(
      `Remove ${money(line.full)} ${KIND_LABEL[line.kind] || ''} on Appointment ${line.label} (${line.patient})? The money goes ${where} and the appointment shows it as due again.`,
      { title: 'Remove payment', confirmText: 'Remove', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await removeProviderPayment(line.orderId, line.id);
      toast.success('Payment removed.');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the payment.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-gray-900">{row.name}</h2>
            <p className="text-xs font-bold text-gray-400">{rangeLabel} · {row.appointments} appointment{row.appointments === 1 ? '' : 's'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={downloading} onClick={() => void downloadPdf()} className="flex items-center gap-2 rounded-2xl bg-black px-4 py-2.5 text-xs font-black text-white disabled:opacity-60">
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} PDF
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Collected" value={money(row.collected)} tone="text-emerald-600" />
          <Mini label="Due recovered" value={money(row.recovered)} tone="text-sky-600" />
          <Mini label="Advance used" value={money(row.advanceUsed)} tone="text-violet-600" />
          <Mini label="Purchase adjusted" value={money(row.purchaseAdjusted || 0)} tone="text-teal-600" />
          <Mini label="Net" value={money(row.net)} tone="text-gray-900" />
          <Mini label="Billed" value={money(row.billed)} tone="text-gray-700" />
          <Mini label="Remaining due" value={money(row.remainingDue)} tone="text-rose-600" />
        </div>

        <div className="mt-5 flex gap-1 rounded-full bg-gray-100 p-1 text-xs font-black">
          {([
            ['payments', `Payments (${payments.length})`],
            ['dues', `Still due (${dues.length})`],
            ['appointments', `Appointments (${appointmentsList.length})`],
          ] as Array<[DetailTab, string]>).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`flex-1 rounded-full px-3 py-2 ${tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient by name or phone..."
          className="mt-3 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold outline-none focus:border-[#00B0C7]"
        />

        <div className="mt-3 max-h-[46vh] overflow-y-auto rounded-2xl border border-gray-100">
          {tab === 'payments' ? (
            payments.length === 0 ? (
              <p className="p-5 text-sm font-bold text-gray-400">No payments in this period.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-gray-50">
                  {<Paged items={payments} colSpan={7}>{(pagedRows) => pagedRows.map((p, index) => (
                    <tr key={`${p.orderId}-${p.id || index}`}>
                      <td className="px-4 py-2.5 font-bold text-gray-500">{shortDate(p.date)}</td>
                      <td className="px-3 py-2.5 font-black text-gray-900">{p.label}</td>
                      <td className="px-3 py-2.5 font-semibold text-gray-700">{p.patient}</td>
                      <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${KIND_TONE[p.kind] || 'bg-gray-100 text-gray-600'}`}>{KIND_LABEL[p.kind] || p.kind}</span></td>
                      <td className="px-3 py-2.5 font-semibold text-gray-500">{p.kind === 'advance' ? 'Advance' : p.kind === 'setoff' ? 'Purchase' : p.method}</td>
                      <td className={`px-3 py-2.5 text-right font-black ${p.amount < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{money(p.amount)}{p.share < 0.999 ? <span className="block text-[9px] font-semibold text-gray-400">of {money(p.full)}</span> : null}</td>
                      <td className="px-3 py-2.5 text-right">
                        {p.amount > 0 && p.id && p.kind !== 'setoff' ? (
                          <button type="button" title="Remove this payment" onClick={() => void removeLine(p)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={13} /></button>
                        ) : null}
                      </td>
                    </tr>
                  ))}</Paged>}
                </tbody>
              </table>
            )
          ) : tab === 'dues' ? (
            dues.length === 0 ? (
              <p className="p-5 text-sm font-bold text-gray-400">Nothing due.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-gray-50">
                  {<Paged items={dues} colSpan={5}>{(pagedRows) => pagedRows.map((d) => (
                    <tr key={d.orderId}>
                      <td className="px-4 py-2.5 font-bold text-gray-500">{shortDate(d.date)}</td>
                      <td className="px-3 py-2.5 font-black text-gray-900">{d.label}</td>
                      <td className="px-3 py-2.5 font-semibold text-gray-700">{d.patient}<span className="block text-[10px] text-gray-400">{d.phone}</span></td>
                      <td className="px-3 py-2.5 text-right font-black text-rose-600">{money(d.due)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button type="button" onClick={() => setPayFor(d)} className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-[11px] font-black text-emerald-700 hover:bg-emerald-100">
                          <Plus size={12} /> Add payment
                        </button>
                      </td>
                    </tr>
                  ))}</Paged>}
                </tbody>
              </table>
            )
          ) : appointmentsList.length === 0 ? (
            <p className="p-5 text-sm font-bold text-gray-400">No appointments in this period.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-gray-50">
                {<Paged items={appointmentsList} colSpan={6}>{(pagedRows) => pagedRows.map((a) => (
                  <tr key={a.orderId}>
                    <td className="px-4 py-2.5 font-bold text-gray-500">{shortDate(a.date)}</td>
                    <td className="px-3 py-2.5 font-black text-gray-900">{a.label}</td>
                    <td className="px-3 py-2.5 font-semibold text-gray-700">{a.patient}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-gray-700">{money(a.billed)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-emerald-600">{money(a.paid)}</td>
                    <td className={`px-3 py-2.5 text-right font-black ${a.due > 0 ? 'text-rose-600' : 'text-gray-300'}`}>{money(a.due)}</td>
                  </tr>
                ))}</Paged>}
              </tbody>
            </table>
          )}
        </div>

        {payFor ? (
          <AddPaymentForm
            due={payFor}
            onClose={() => setPayFor(null)}
            onSaved={() => {
              setPayFor(null);
              toast.success('Payment added.');
              onChanged();
            }}
            toast={toast}
          />
        ) : null}
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-gray-50 px-3 py-2.5">
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`text-sm font-black ${tone}`}>{value}</p>
    </div>
  );
}

function AddPaymentForm({
  due,
  onClose,
  onSaved,
  toast,
}: {
  due: ProviderPaymentRow['dues'][number];
  onClose: () => void;
  onSaved: () => void;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const [amount, setAmount] = useState(String(due.fullDue));
  const [method, setMethod] = useState<'Cash' | 'Bank'>('Cash');
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchBanks().then((list) => {
      setBanks(list || []);
      if (list && list.length === 1) setBankId(list[0].id);
    }).catch(() => undefined);
  }, []);

  async function save() {
    const value = Number(amount);
    if (!value || value <= 0) return toast.error('Enter an amount.');
    if (value > due.fullDue) return toast.error(`Only ${money(due.fullDue)} is due on ${due.label}.`);
    if (method === 'Bank' && !bankId) return toast.error('Pick the bank.');
    setSaving(true);
    try {
      await addProviderPayment(due.orderId, { amount: value, method, bankId: method === 'Bank' ? bankId : undefined, note: note.trim() });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the payment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black text-gray-900">Add payment - {due.label} · {due.patient} <span className="text-rose-600">({money(due.fullDue)} due)</span></p>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-white"><X size={16} /></button>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <input value={amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)} placeholder="Amount" className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold outline-none" />
        <div className="flex gap-1">
          {(['Cash', 'Bank'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={`flex-1 rounded-xl py-2.5 text-xs font-black ${method === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 ring-1 ring-gray-200'}`}>
              {m === 'Cash' ? 'Cash in Hand' : 'Bank'}
            </button>
          ))}
        </div>
        {method === 'Bank' ? (
          <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold outline-none">
            <option value="">Select bank</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : (
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold outline-none" />
        )}
        <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white disabled:opacity-60">
          {saving ? 'Saving...' : 'Save payment'}
        </button>
      </div>
      <p className="mt-2 text-[10px] font-semibold text-gray-500">The money goes into {method === 'Bank' ? 'the picked bank' : 'Cash in Hand'} and this appointment's due goes down.</p>
    </div>
  );
}
