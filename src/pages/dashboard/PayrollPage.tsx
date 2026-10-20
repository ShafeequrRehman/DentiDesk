import { cs } from '@/lib/currency';
import { useEffect, useMemo, useState } from 'react';
import { useBackspaceToClose } from '@/lib/keyboard-shortcuts';
import {
  Banknote, Landmark, Calendar,
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight,
  Calculator, History, X, RefreshCcw, UtensilsCrossed,
  Printer, MessageCircle, Trash2, Wallet, Users,
} from 'lucide-react';
import { shopApi, type PayrollResponse, type PayrollRow, type StaffPayment } from '@/lib/shop-api';
import { fetchExpenses, createExpense, fetchBanks } from '@/lib/pos-api';
import type { Bank, Expense } from '@/lib/pos-types';
import { paidFromLabel, printSalarySlip, sendSalarySlipWhatsapp, type SalarySlipInfo } from '@/lib/salary-slip';
import { useToast } from '@/lib/toast';

import { Paged } from '@/components/Paged';

// Real payroll, built on top of Manage Staff's monthlySalary field plus a
// ledger of StaffPayment rows recorded here (salary/advance/bonus/
// deduction) - see backend/controllers/shopOwnerController.js
// listPayroll/recordPayment. Replaces the earlier static/placeholder
// version of this page.
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Slip details for one payment, using the staff member's row this month.
function slipInfo(payment: StaffPayment, rows: PayrollRow[]): SalarySlipInfo {
  const emp = typeof payment.employeeId === 'object' ? payment.employeeId : null;
  const id = emp?._id || (typeof payment.employeeId === 'string' ? payment.employeeId : '');
  const row = rows.find((r) => r.employeeId === id);
  return {
    payment,
    name: emp?.name || row?.name || 'Staff member',
    phone: emp?.phone || row?.phone || '',
    designation: emp?.designation || row?.designation || '',
    monthlySalary: row?.monthlySalary,
    paidThisMonth: row?.paidThisMonth,
    remaining: row?.remaining,
  };
}

// Print / WhatsApp / delete buttons for one payment row.
function PaymentActions({ payment, rows, onDeleted }: { payment: StaffPayment; rows: PayrollRow[]; onDeleted?: () => void }) {
  const { toast, confirm } = useToast();
  const [sending, setSending] = useState(false);
  async function sendWhatsapp() {
    setSending(true);
    try {
      await sendSalarySlipWhatsapp(slipInfo(payment, rows));
      toast.success('Salary slip sent on WhatsApp.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the slip.');
    } finally {
      setSending(false);
    }
  }
  async function remove() {
    const where = payment.paymentSource ? ` The ${cs()}${payment.amount.toLocaleString()} goes back to ${paidFromLabel(payment)}.` : '';
    const ok = await confirm(`Delete this ${payment.type} record?${where}`, { title: 'Delete payment', confirmText: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await shopApi.deletePayment(payment._id);
      toast.success('Payment deleted.');
      onDeleted?.();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Could not delete the payment.');
    }
  }
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button type="button" title="Print slip" onClick={() => { if (!printSalarySlip(slipInfo(payment, rows))) toast.error('Allow pop-ups to print.'); }} className="rounded-xl bg-slate-100 p-2 text-slate-600 hover:bg-slate-200">
        <Printer size={14} />
      </button>
      <button type="button" title="Send slip on WhatsApp" disabled={sending} onClick={() => void sendWhatsapp()} className="rounded-xl bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50">
        {sending ? <RefreshCcw size={14} className="animate-spin" /> : <MessageCircle size={14} />}
      </button>
      {onDeleted ? (
        <button type="button" title="Delete" onClick={() => void remove()} className="rounded-xl bg-rose-50 p-2 text-rose-500 hover:bg-rose-100">
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}

export default function PayrollPage() {
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState<PayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [payTarget, setPayTarget] = useState<PayrollRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<PayrollRow | null>(null);
  const [history, setHistory] = useState<StaffPayment[]>([]);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [visibleRowCount, setVisibleRowCount] = useState(10);

  const load = () => {
    setLoading(true);
    Promise.all([shopApi.getPayroll(month), shopApi.listPayments({ month })])
      .then(([payroll, payments]) => { setData(payroll); setHistory(payments); })
      .finally(() => setLoading(false));
  };

  useEffect(load, [month]);
  useEffect(() => setVisibleRowCount(10), [data]);
  useEffect(() => setVisibleHistoryCount(10), [history]);

  const rows = data?.rows || [];
  const visibleRows = rows.slice(0, visibleRowCount);
  const visibleHistory = history.slice(0, visibleHistoryCount);

  const isCurrentMonth = month === currentMonthKey();

  return (
    <div className="min-h-screen bg-[#F9FAFB] p-4 lg:p-8 space-y-8">

      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            Payroll <Landmark className="text-purple-600" size={32} />
          </h1>
          <p className="text-slate-500 font-bold">What each staff member is owed, has taken, and has left for the month.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-[20px] border border-slate-200 bg-white px-3 py-2">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
              <ChevronLeft size={16} />
            </button>
            <span className="flex items-center gap-2 px-2 text-sm font-black text-slate-900">
              <Calendar size={14} className="text-purple-500" /> {monthLabel(month)}
            </span>
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              disabled={isCurrentMonth}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-[20px] font-black text-sm hover:bg-slate-50 transition-all disabled:opacity-60">
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Payroll Summary Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Total Monthly Salaries</p>
          <h2 className="text-3xl font-black text-slate-900">{cs()}{(data?.summary.totalMonthlySalary || 0).toLocaleString()}</h2>
          <p className="text-slate-400 text-xs font-bold mt-2 flex items-center gap-1"><Users size={13} /> {rows.length} staff member{rows.length === 1 ? '' : 's'} - grows as you add staff</p>
        </div>

        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Given This Month</p>
          <h2 className="text-3xl font-black text-emerald-600">{cs()}{(data?.summary.totalPaidThisMonth || 0).toLocaleString()}</h2>
          <p className="text-slate-400 text-xs font-bold mt-2">
            Cash {cs()}{(data?.summary.paidCash || 0).toLocaleString()} · Bank {cs()}{(data?.summary.paidBank || 0).toLocaleString()}
          </p>
        </div>

        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Fully Paid Staff</p>
          <h2 className="text-3xl font-black text-slate-900">{data?.summary.settledCount || 0} / {rows.length}</h2>
          <p className="text-slate-400 text-xs font-bold mt-2 italic">Got their whole salary this month</p>
        </div>

        <div className="bg-purple-900 p-8 rounded-[32px] text-white shadow-xl shadow-purple-100">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-300 mb-2">Remaining To Pay</p>
          <h2 className="text-3xl font-black">{cs()}{(data?.summary.totalRemaining || 0).toLocaleString()}</h2>
          <p className="text-purple-300 text-xs font-bold mt-2 flex items-center gap-1">
            <AlertCircle size={14} /> Still owed to {rows.filter((r) => r.remaining > 0).length} staff member{rows.filter((r) => r.remaining > 0).length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Per-employee table */}
      <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-white/50 backdrop-blur-md">
          <h3 className="font-black text-xl text-slate-900">Staff Pay Summary</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-400 text-[10px] uppercase tracking-widest font-black">
                <th className="px-8 py-6">Staff Member</th>
                <th className="px-8 py-6">Designation</th>
                <th className="px-8 py-6">Monthly Salary</th>
                <th className="px-8 py-6">Taken This Month</th>
                <th className="px-8 py-6">Remaining</th>
                <th className="px-8 py-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={6} className="px-8 py-10 text-center text-slate-400 font-bold">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-8 py-10 text-center text-slate-400 font-bold">No staff members yet. Add them from Manage Staff.</td></tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.employeeId} className="group hover:bg-slate-50/50 transition-colors">
                    <td className="px-8 py-6">
                      <div className="text-sm font-black text-slate-900">{row.name}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase">@{row.username}</div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-bold text-slate-600">{row.designation || '—'}</span>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-black text-slate-900">{cs()}{row.monthlySalary.toLocaleString()}</span>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-bold text-slate-600">{cs()}{row.paidThisMonth.toLocaleString()}</span>
                      {row.bonusThisMonth ? (
                        <div className="text-[10px] text-emerald-600 font-bold uppercase">+{cs()}{row.bonusThisMonth.toLocaleString()} bonus</div>
                      ) : null}
                    </td>
                    <td className="px-8 py-6">
                      <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase px-3 py-1.5 rounded-lg w-fit ${row.remaining <= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        {row.remaining <= 0 ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                        {cs()}{Math.abs(row.remaining).toLocaleString()} {row.remaining <= 0 ? (row.remaining < 0 ? 'overpaid' : 'settled') : 'left'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setHistoryTarget(row)}
                          className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-200"
                        >
                          <History size={14} /> History
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayTarget(row)}
                          className="flex items-center gap-2 rounded-full bg-purple-600 px-4 py-2 text-xs font-black text-white hover:bg-purple-700"
                        >
                          <Calculator size={14} /> Pay Salary
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {rows.length > visibleRows.length ? (
          <div className="flex justify-center border-t border-slate-100 py-4">
            <button type="button" onClick={() => setVisibleRowCount((c) => c + 10)} className="rounded-full bg-slate-50 px-5 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100">
              Load More ({rows.length - visibleRows.length} more)
            </button>
          </div>
        ) : null}
      </div>

      {/* Recent transactions */}
      <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center gap-2 bg-white/50 backdrop-blur-md">
          <History size={18} className="text-purple-600" />
          <h3 className="font-black text-xl text-slate-900">Payments This Month</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-400 text-[10px] uppercase tracking-widest font-black">
                <th className="px-8 py-5">Staff Member</th>
                <th className="px-8 py-5">Type</th>
                <th className="px-8 py-5">Amount</th>
                <th className="px-8 py-5">Paid From</th>
                <th className="px-8 py-5">Note</th>
                <th className="px-8 py-5">Date</th>
                <th className="px-8 py-5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {history.length === 0 ? (
                <tr><td colSpan={7} className="px-8 py-8 text-center text-slate-400 font-bold">No payments recorded this month yet.</td></tr>
              ) : (
                visibleHistory.map((p) => {
                  const emp = typeof p.employeeId === 'object' ? p.employeeId : null;
                  return (
                    <tr key={p._id} className="hover:bg-slate-50/50">
                      <td className="px-8 py-4 text-sm font-bold text-slate-800">{emp?.name || emp?.username || '—'}</td>
                      <td className="px-8 py-4">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">{p.type}</span>
                      </td>
                      <td className="px-8 py-4 text-sm font-black text-slate-900">{cs()}{p.amount.toLocaleString()}</td>
                      <td className="px-8 py-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black ${p.paymentSource === 'bank' ? 'bg-sky-50 text-sky-700' : p.paymentSource === 'cash' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                          {p.paymentSource === 'bank' ? <Landmark size={11} /> : p.paymentSource === 'cash' ? <Wallet size={11} /> : null}
                          {paidFromLabel(p)}
                        </span>
                      </td>
                      <td className="px-8 py-4 text-sm text-slate-500">{p.note || '—'}</td>
                      <td className="px-8 py-4 text-xs font-bold text-slate-400">{new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className="px-8 py-4"><PaymentActions payment={p} rows={rows} onDeleted={load} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {history.length > visibleHistory.length ? (
          <div className="flex justify-center border-t border-slate-100 py-4">
            <button type="button" onClick={() => setVisibleHistoryCount((c) => c + 10)} className="rounded-full bg-slate-50 px-5 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100">
              Load More ({history.length - visibleHistory.length} more)
            </button>
          </div>
        ) : null}
      </div>

      {historyTarget ? (
        <EmployeeHistoryModal
          row={historyTarget}
          rows={rows}
          month={month}
          onClose={() => setHistoryTarget(null)}
          onLoggedMeal={() => toast.success('Meal expense logged.')}
        />
      ) : null}

      {payTarget ? (
        <RecordPaymentModal
          row={payTarget}
          onClose={() => setPayTarget(null)}
          onSaved={() => { toast.success('Payment recorded.'); load(); }}
        />
      ) : null}
    </div>
  );
}

function RecordPaymentModal({ row, onClose, onSaved }: { row: PayrollRow; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(row.remaining > 0 ? String(row.remaining) : '');
  const [type, setType] = useState<'salary' | 'advance' | 'bonus' | 'deduction'>('salary');
  const [note, setNote] = useState('');
  const [source, setSource] = useState<'' | 'cash' | 'bank'>('');
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // After saving: the payment, so its slip can be printed / sent.
  const [saved, setSaved] = useState<StaffPayment | null>(null);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    void fetchBanks().then((list) => {
      setBanks(list || []);
      if (list && list.length === 1) setBankId(list[0].id);
    }).catch(() => undefined);
  }, []);

  const selectedBank = banks.find((b) => b.id === bankId) || null;
  const value = Number(amount) || 0;
  const remainingAfter = type === 'salary' || type === 'advance' ? row.remaining - value : type === 'deduction' ? row.remaining + value : row.remaining;

  const submit = async () => {
    if (!value || value <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!source && type !== 'deduction') {
      setError('Choose where the money comes from - Cash in Hand or Bank.');
      return;
    }
    if (source === 'bank' && !bankId) {
      setError('Pick the bank.');
      return;
    }
    if (source === 'bank' && selectedBank && type !== 'deduction' && value > selectedBank.balance) {
      setError(`${selectedBank.name} only has ${cs()}${selectedBank.balance.toLocaleString()}.`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payment = await shopApi.recordPayment({
        employeeId: row.employeeId,
        amount: value,
        type,
        note,
        date: new Date(`${date}T12:00:00`).toISOString(),
        paymentSource: source,
        bankId: source === 'bank' ? bankId : undefined,
      });
      onSaved();
      setSaved(payment);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  // Universal Popup-Close Hotkey - see useBackspaceToClose's own comment.
  useBackspaceToClose(onClose);

  if (saved) {
    const info: SalarySlipInfo = {
      payment: saved,
      name: row.name,
      phone: row.phone,
      designation: row.designation,
      monthlySalary: row.monthlySalary,
      paidThisMonth: row.paidThisMonth + (saved.type === 'salary' || saved.type === 'advance' ? saved.amount : saved.type === 'deduction' ? -saved.amount : 0),
      remaining: remainingAfter,
    };
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-[28px] bg-white p-6 text-center shadow-2xl">
          <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
          <h2 className="mt-3 text-xl font-black text-slate-900">{cs()}{saved.amount.toLocaleString()} {saved.type} recorded</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {row.name} · {saved.type === 'deduction' ? 'returned to' : 'paid from'} {paidFromLabel(saved)}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400">
            {remainingAfter > 0 ? `${cs()}${remainingAfter.toLocaleString()} still left this month` : remainingAfter < 0 ? `Overpaid by ${cs()}${Math.abs(remainingAfter).toLocaleString()}` : 'Salary fully paid this month'}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { if (!printSalarySlip(info)) toast.error('Allow pop-ups to print.'); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white hover:bg-slate-800"
            >
              <Printer size={16} /> Print Slip
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={async () => {
                setSending(true);
                try {
                  await sendSalarySlipWhatsapp(info);
                  toast.success('Salary slip sent on WhatsApp.');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not send the slip.');
                } finally {
                  setSending(false);
                }
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-black text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              {sending ? <RefreshCcw size={16} className="animate-spin" /> : <MessageCircle size={16} />} WhatsApp
            </button>
          </div>
          <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl bg-slate-100 py-3 text-sm font-black text-slate-600 hover:bg-slate-200">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Pay Salary</h2>
            <p className="text-xs font-bold text-slate-400">{row.name} · {cs()}{row.remaining.toLocaleString()} remaining this month</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">Type</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['salary', 'advance', 'bonus', 'deduction'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-xl border px-2 py-2 text-[11px] font-black capitalize transition ${type === t ? 'border-purple-600 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">Amount</label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
              <Banknote size={16} className="text-slate-400" />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full outline-none"
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">
              {type === 'deduction' ? 'Money returned to (optional)' : 'Pay from'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSource(source === 'cash' && type === 'deduction' ? '' : 'cash')}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-black transition ${source === 'cash' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                <Wallet size={16} /> Cash in Hand
              </button>
              <button
                type="button"
                onClick={() => setSource(source === 'bank' && type === 'deduction' ? '' : 'bank')}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-black transition ${source === 'bank' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                <Landmark size={16} /> Bank
              </button>
            </div>
            {source === 'bank' ? (
              banks.length === 0 ? (
                <p className="mt-2 text-xs font-bold text-amber-600">No bank added yet - add one on the Bank page first.</p>
              ) : (
                <select
                  value={bankId}
                  onChange={(e) => setBankId(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-sky-400"
                >
                  <option value="">Select a bank</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>{b.name} - {cs()}{b.balance.toLocaleString()}</option>
                  ))}
                </select>
              )
            ) : null}
            <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
              {source === 'cash'
                ? type === 'deduction' ? 'Added back to Cash in Hand.' : 'Taken out of Cash in Hand.'
                : source === 'bank'
                  ? type === 'deduction' ? 'Deposited back into this bank.' : 'Withdrawn from this bank.'
                  : type === 'deduction' ? 'Leave empty if no money changes hands.' : 'The amount is minused from where you pick.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none focus:border-purple-400"
              />
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Left after this</p>
              <p className={`text-sm font-black ${remainingAfter < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {remainingAfter < 0 ? `-${cs()}${Math.abs(remainingAfter).toLocaleString()}` : `${cs()}${remainingAfter.toLocaleString()}`}
              </p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-purple-400"
              placeholder="e.g. mid-month advance"
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm font-bold text-rose-600">{error}</p> : null}

        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="mt-5 w-full rounded-xl bg-purple-600 py-3 text-sm font-black text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Saving...' : type === 'deduction' ? 'Save Deduction' : `Pay ${cs()}${value ? value.toLocaleString() : 0}`}
        </button>
      </div>
    </div>
  );
}

// Employee Salary History: one employee's full picture for the selected
// month - monthly salary, what's actually been paid (salary+advance,
// bonus tracked separately, exactly as the Staff Pay Summary table already
// computes it - see PayrollRow), remaining, the full StaffPayment ledger
// for just this person, AND their Employee Meal expenses for the same
// month shown as a CLEARLY SEPARATE section that is never added into
// "Paid"/"Remaining" - see backend/models/Expense.js's own comment on why
// meals never implicitly deduct from salary. Reuses row.monthlySalary/
// paidThisMonth/bonusThisMonth/remaining computed by shopOwnerController.
// listPayroll rather than re-deriving them here, so this can never drift
// from the same numbers the table it was opened from is showing.
function isDateInMonth(dateStr: string, monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(dateStr);
  return d.getFullYear() === year && d.getMonth() === month - 1;
}

function EmployeeHistoryModal({
  row,
  rows,
  month,
  onClose,
  onLoggedMeal,
}: {
  row: PayrollRow;
  rows: PayrollRow[];
  month: string;
  onClose: () => void;
  onLoggedMeal: () => void;
}) {
  const [payments, setPayments] = useState<StaffPayment[]>([]);
  const [meals, setMeals] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [mealAmount, setMealAmount] = useState('');
  const [mealNote, setMealNote] = useState('');
  const [savingMeal, setSavingMeal] = useState(false);
  // Every payment ever made to this person, not just this month.
  const [allTime, setAllTime] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      shopApi.listPayments(allTime ? { employeeId: row.employeeId } : { employeeId: row.employeeId, month }),
      fetchExpenses({ employeeId: row.employeeId }),
    ])
      .then(([paymentList, expenseList]) => {
        setPayments(paymentList);
        setMeals((expenseList || []).filter((e) => e.category === 'Employee Meal' && isDateInMonth(e.date, month)));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [row.employeeId, month, allTime]);
  const historyTotal = useMemo(
    () => payments.reduce((sum, p) => sum + (p.type === 'deduction' ? -p.amount : p.type === 'bonus' ? 0 : p.amount), 0),
    [payments],
  );

  const mealsTotal = useMemo(() => meals.reduce((sum, m) => sum + m.amount, 0), [meals]);

  useBackspaceToClose(onClose);

  async function logMeal() {
    const amount = Number(mealAmount);
    if (!amount || amount <= 0) return;
    setSavingMeal(true);
    try {
      const created = await createExpense({
        category: 'Employee Meal',
        amount,
        note: mealNote.trim(),
        employeeId: row.employeeId,
      });
      if (created) {
        setMeals((prev) => [created, ...prev]);
        setMealAmount('');
        setMealNote('');
        onLoggedMeal();
      }
    } finally {
      setSavingMeal(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">{row.name}'s Salary History</h2>
            <p className="text-xs font-bold text-slate-400">{monthLabel(month)} · @{row.username}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Monthly Salary</p>
            <p className="text-sm font-black text-slate-900">{cs()}{row.monthlySalary.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Paid This Month</p>
            <p className="text-sm font-black text-slate-900">{cs()}{row.paidThisMonth.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Bonus</p>
            <p className="text-sm font-black text-slate-900">{cs()}{row.bonusThisMonth.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-purple-900 px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-purple-300">Remaining</p>
            <p className="text-sm font-black text-white">{cs()}{Math.abs(row.remaining).toLocaleString()}{row.remaining < 0 ? ' (overpaid)' : ''}</p>
          </div>
        </div>

        <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
            Payment History {allTime ? '- all time' : `- ${monthLabel(month)}`} · {cs()}{historyTotal.toLocaleString()} given
          </h3>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1">
            <button type="button" onClick={() => setAllTime(false)} className={`rounded-full px-3 py-1 text-[11px] font-black ${!allTime ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>This month</button>
            <button type="button" onClick={() => setAllTime(true)} className={`rounded-full px-3 py-1 text-[11px] font-black ${allTime ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>All time</button>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-2xl border border-slate-100">
          {loading ? (
            <p className="p-4 text-sm font-bold text-slate-400">Loading...</p>
          ) : payments.length === 0 ? (
            <p className="p-4 text-sm font-bold text-slate-400">{allTime ? 'No payments recorded yet.' : 'No payments recorded this month.'}</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-slate-50">
                {<Paged items={payments} colSpan={6}>{(pagedRows) => pagedRows.map((p) => (
                  <tr key={p._id}>
                    <td className="px-4 py-2.5 font-bold text-slate-500">{new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td className="px-4 py-2.5"><span className="rounded-full bg-slate-100 px-2 py-1 font-black uppercase text-slate-600">{p.type}</span></td>
                    <td className="px-4 py-2.5 font-black text-slate-900">{cs()}{p.amount.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-500">{paidFromLabel(p)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{p.note || '—'}</td>
                    <td className="px-4 py-2.5"><PaymentActions payment={p} rows={rows} /></td>
                  </tr>
                ))}</Paged>}
              </tbody>
            </table>
          )}
        </div>

        {/* Employee Meal expenses - a CLEARLY SEPARATE section, on purpose:
            this total is informational only and is never subtracted from
            "Remaining" above (see Expense.employeeId's own comment). */}
        <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700">
              <UtensilsCrossed size={14} /> Employee Meals This Month
            </h3>
            <span className="text-sm font-black text-amber-800">{cs()}{mealsTotal.toLocaleString()}</span>
          </div>
          <p className="mt-1 text-[10px] font-bold text-amber-700/70">Shown for reference only - not deducted from this employee's salary.</p>

          {meals.length > 0 ? (
            <div className="mt-3 max-h-28 overflow-y-auto space-y-1.5">
              {meals.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-xs">
                  <span className="font-bold text-amber-900">{new Date(m.date).toLocaleDateString()}{m.note ? ` · ${m.note}` : ''}</span>
                  <span className="font-black text-amber-900">{cs()}{m.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            <input
              type="number"
              value={mealAmount}
              onChange={(e) => setMealAmount(e.target.value)}
              placeholder="Amount"
              className="w-28 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-bold outline-none"
            />
            <input
              type="text"
              value={mealNote}
              onChange={(e) => setMealNote(e.target.value)}
              placeholder="Note (e.g. lunch)"
              className="flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-bold outline-none"
            />
            <button
              type="button"
              disabled={savingMeal}
              onClick={() => void logMeal()}
              className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white transition hover:bg-amber-600 disabled:opacity-60"
            >
              {savingMeal ? 'Saving...' : 'Log Meal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
