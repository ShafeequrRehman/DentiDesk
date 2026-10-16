// Drs & Services page.
//
// Drs tab: every Dr (a Drs/Services item whose category is "Dr"/"Drs"/
// "Doctor" or whose name starts with "Dr."). Clicking a Dr shows that Dr's
// appointments - time, patient, phone, note, services - and the checkup
// status. "Check up" opens a pad where the Dr writes the medicine details;
// completing it marks the checkup done, which frees that time slot on the
// POS screen again, with an option to print the prescription.
//
// Services tab: every other Drs/Services item, with its price.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, Globe, Wallet, ClipboardList, Clock, Phone, Printer, RefreshCcw, RotateCcw, Search, Stethoscope, Undo2, UserRound, X } from 'lucide-react';
import { fetchProducts, saveCheckup } from '@/lib/pos-api';
import type { Product, SavedOrder } from '@/lib/pos-types';
import { getReferenceData } from '@/lib/local-hub-api';
import { isDesktopApp } from '@/lib/api';
import { resolveProductImage } from '@/lib/food-images';
import { useToast } from '@/lib/toast';
import { formatAppointmentDate, formatSlot, isDoctorProduct, loadAppointments, printPrescription, todayISO } from '@/lib/appointments';
import { useBackspaceToClose } from '@/lib/keyboard-shortcuts';

type Tab = 'drs' | 'services';
type StatusFilter = 'all' | 'waiting' | 'done';

interface DoctorCard {
  name: string;
  image: string;
  category: string;
  price: number;
}

function money(amount: number) {
  return `$${Math.round(amount || 0).toLocaleString()}`;
}

async function loadCatalog(): Promise<Product[]> {
  try {
    const result = await fetchProducts();
    return result.products || [];
  } catch (error) {
    if (!isDesktopApp()) throw error;
    // Offline in the desktop app - use this till's cached catalog.
    const snapshot = await getReferenceData();
    return (snapshot.products || []) as Product[];
  }
}

export default function DoctorsPage() {
  const { toast } = useToast();
  // toast is a fresh object every render - kept in a ref so the loaders
  // below don't re-run (and loop) every time a toast shows.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [tab, setTab] = useState<Tab>('drs');
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const [doctorSearch, setDoctorSearch] = useState('');

  const [date, setDate] = useState(() => todayISO());
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [appointments, setAppointments] = useState<SavedOrder[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [todayCounts, setTodayCounts] = useState<Record<string, number>>({});
  const [checkupTarget, setCheckupTarget] = useState<SavedOrder | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    loadCatalog()
      .then((list) => {
        if (!cancelled) setProducts(list);
      })
      .catch((error) => {
        if (!cancelled) setCatalogError(error instanceof Error ? error.message : 'Could not load Drs/Services.');
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const doctors = useMemo<DoctorCard[]>(() => {
    const byName = new Map<string, DoctorCard>();
    products.filter((p) => isDoctorProduct(p)).forEach((p) => {
      if (!byName.has(p.name)) {
        byName.set(p.name, { name: p.name, image: resolveProductImage(p), category: p.category, price: p.price });
      }
    });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const services = useMemo(() => products.filter((p) => !isDoctorProduct(p)).sort((a, b) => a.name.localeCompare(b.name)), [products]);

  const visibleDoctors = useMemo(() => {
    const q = doctorSearch.trim().toLowerCase();
    return q ? doctors.filter((d) => d.name.toLowerCase().includes(q)) : doctors;
  }, [doctors, doctorSearch]);

  // Today's waiting count per Dr, shown on each Dr card.
  const loadTodayCounts = useCallback(async () => {
    try {
      const { list } = await loadAppointments({ date: todayISO(), status: 'waiting' });
      const counts: Record<string, number> = {};
      list.forEach((order) => {
        if (order.doctorName) counts[order.doctorName] = (counts[order.doctorName] || 0) + 1;
      });
      setTodayCounts(counts);
    } catch {
      setTodayCounts({});
    }
  }, []);

  useEffect(() => {
    void loadTodayCounts();
  }, [loadTodayCounts]);

  const loadDoctorAppointments = useCallback(async () => {
    if (!selectedDoctor) return;
    setAppointmentsLoading(true);
    try {
      const { list, fromCache: cached, error } = await loadAppointments(
        showUpcoming ? { doctor: selectedDoctor, from: todayISO() } : { doctor: selectedDoctor, date },
      );
      setAppointments(list);
      setFromCache(cached);
      setLoadError(cached ? error || null : null);
    } catch (error) {
      toastRef.current.error(error instanceof Error ? error.message : 'Could not load appointments.');
    } finally {
      setAppointmentsLoading(false);
    }
  }, [selectedDoctor, showUpcoming, date]);

  useEffect(() => {
    void loadDoctorAppointments();
  }, [loadDoctorAppointments]);

  // Keep the list fresh while the Dr has it open (new bookings from POS).
  useEffect(() => {
    if (!selectedDoctor) return;
    const id = setInterval(() => void loadDoctorAppointments(), 30000);
    return () => clearInterval(id);
  }, [selectedDoctor, loadDoctorAppointments]);

  const filteredAppointments = useMemo(() => {
    if (statusFilter === 'all') return appointments;
    if (statusFilter === 'done') return appointments.filter((a) => a.checkupStatus === 'done');
    return appointments.filter((a) => a.checkupStatus !== 'done');
  }, [appointments, statusFilter]);

  const waitingCount = appointments.filter((a) => a.checkupStatus !== 'done').length;
  const doneCount = appointments.length - waitingCount;
  const onlineCount = appointments.filter((a) => a.source === 'customer-qr').length;
  const unpaidCount = appointments.filter((a) => paymentState(a).label !== 'Paid').length;

  function handleSaved(updated: SavedOrder) {
    setAppointments((previous) => previous.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
    setCheckupTarget(null);
    void loadTodayCounts();
  }

  async function handleReopen(order: SavedOrder) {
    try {
      const updated = await saveCheckup(order.id, order.prescription || '', false);
      if (updated) {
        handleSaved(updated);
        toast.info(`${order.customer?.name || 'Patient'} marked as not checked - the ${formatSlot(order.appointmentTime)} slot is booked again.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update this appointment.');
    }
  }

  const selectedDoctorCard = doctors.find((d) => d.name === selectedDoctor) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-gray-900">
            Drs &amp; Services <Stethoscope className="text-indigo-600" size={30} />
          </h1>
          <p className="font-bold text-gray-500">Each Dr&apos;s appointments, checkups and prescriptions - and every service the clinic offers.</p>
        </div>
        <div className="flex gap-2 rounded-full bg-white p-1.5 shadow-sm">
          <button type="button" onClick={() => setTab('drs')} className={`rounded-full px-5 py-2 text-sm font-black ${tab === 'drs' ? 'bg-black text-white' : 'text-gray-500'}`}>
            Drs ({doctors.length})
          </button>
          <button type="button" onClick={() => setTab('services')} className={`rounded-full px-5 py-2 text-sm font-black ${tab === 'services' ? 'bg-black text-white' : 'text-gray-500'}`}>
            Services ({services.length})
          </button>
        </div>
      </div>

      {catalogError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{catalogError}</div> : null}

      {tab === 'services' ? (
        <ServicesList services={services} loading={catalogLoading} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          {/* Drs list */}
          <aside className="space-y-3 rounded-[32px] bg-white p-5 shadow-sm">
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={doctorSearch}
                onChange={(event) => setDoctorSearch(event.target.value)}
                placeholder="Search Drs..."
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm font-semibold outline-none focus:border-indigo-400"
              />
            </div>
            {catalogLoading ? (
              <p className="py-6 text-center text-sm font-bold text-gray-400">Loading Drs...</p>
            ) : visibleDoctors.length === 0 ? (
              <p className="rounded-2xl bg-gray-50 p-4 text-sm font-semibold text-gray-500">
                No Drs found. Add a Dr from Settings &gt; Manage Appointments with the category <b>Drs</b>.
              </p>
            ) : (
              <div className="space-y-2">
                {visibleDoctors.map((doctor) => {
                  const active = doctor.name === selectedDoctor;
                  const count = todayCounts[doctor.name] || 0;
                  return (
                    <button
                      key={doctor.name}
                      type="button"
                      onClick={() => {
                        setSelectedDoctor(doctor.name);
                        setStatusFilter('all');
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition ${active ? 'border-indigo-400 bg-indigo-50 shadow-sm' : 'border-transparent hover:bg-gray-50'}`}
                    >
                      <img src={doctor.image} alt={doctor.name} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-gray-900">{doctor.name}</p>
                        <p className="text-[11px] font-bold text-gray-400">{money(doctor.price)}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`} title="Waiting today">
                        {count} today
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Selected Dr's appointments */}
          <section className="rounded-[32px] bg-white p-6 shadow-sm">
            {!selectedDoctor ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center text-gray-400">
                <UserRound size={42} />
                <p className="text-sm font-bold">Click a Dr to see their appointments and patients.</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {selectedDoctorCard ? <img src={selectedDoctorCard.image} alt="" className="h-14 w-14 rounded-2xl object-cover" /> : null}
                    <div>
                      <h2 className="text-2xl font-black text-gray-900">{selectedDoctor}</h2>
                      <p className="text-xs font-bold text-gray-500">
                        {waitingCount} waiting · {doneCount} checked · {onlineCount} online · {unpaidCount} unpaid
                        {showUpcoming ? ' · today and later' : ` · ${formatAppointmentDate(date)}`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadDoctorAppointments()}
                    disabled={appointmentsLoading}
                    className="flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-2.5 text-xs font-black text-gray-700 hover:bg-gray-200 disabled:opacity-60"
                  >
                    <RefreshCcw size={14} className={appointmentsLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="date"
                      value={date}
                      disabled={showUpcoming}
                      onChange={(event) => setDate(event.target.value || todayISO())}
                      className="rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm font-bold outline-none disabled:opacity-50"
                    />
                  </div>
                  <button type="button" onClick={() => { setShowUpcoming(false); setDate(todayISO()); }} className={`rounded-xl px-3 py-2 text-xs font-black ${!showUpcoming && date === todayISO() ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'}`}>
                    Today
                  </button>
                  <button type="button" onClick={() => setShowUpcoming((value) => !value)} className={`rounded-xl px-3 py-2 text-xs font-black ${showUpcoming ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'}`}>
                    All upcoming
                  </button>
                  <span className="mx-1 h-6 w-px bg-gray-200" />
                  {(['all', 'waiting', 'done'] as StatusFilter[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setStatusFilter(value)}
                      className={`rounded-xl px-3 py-2 text-xs font-black ${statusFilter === value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {value === 'all' ? 'All' : value === 'waiting' ? 'Waiting' : 'Checked'}
                    </button>
                  ))}
                </div>

                {fromCache ? (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                    {typeof navigator !== 'undefined' && navigator.onLine
                      ? `Couldn't load appointments from the server${loadError ? ` (${loadError})` : ''}. If the app was just updated, close it and start it again (restart the backend) - then press Refresh.`
                      : "Offline - showing this till's saved copy. Checkups can be completed once back online."}
                  </p>
                ) : null}

                {appointmentsLoading && appointments.length === 0 ? (
                  <p className="py-10 text-center text-sm font-bold text-gray-400">Loading appointments...</p>
                ) : filteredAppointments.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-2xl bg-gray-50 py-10 text-center text-gray-400">
                    <ClipboardList size={32} />
                    <p className="text-sm font-bold">No appointments here.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredAppointments.map((order) => (
                      <AppointmentRow
                        key={order.id}
                        order={order}
                        showDate={showUpcoming}
                        offline={fromCache || order.id.startsWith('local-')}
                        onCheckup={() => setCheckupTarget(order)}
                        onReopen={() => void handleReopen(order)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {checkupTarget ? <CheckupModal order={checkupTarget} onClose={() => setCheckupTarget(null)} onSaved={handleSaved} /> : null}
    </div>
  );
}

// Online = booked by the patient from the QR / online page; Clinic = booked
// by staff at the POS.
function SourceTag({ order }: { order: SavedOrder }) {
  const online = order.source === 'customer-qr';
  return (
    <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${online ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>
      {online ? <Globe size={11} /> : <Building2 size={11} />}
      {online ? 'Online' : 'Clinic'}
    </span>
  );
}

function paymentState(order: SavedOrder): { label: string; tone: string } {
  const total = Number(order.total || 0);
  const paid = Number(order.paidAmount || 0);
  const remaining = typeof order.remainingAmount === 'number' ? order.remainingAmount : Math.max(total - paid, 0);
  if (order.status !== 'pending' && remaining <= 0) return { label: 'Paid', tone: 'bg-emerald-100 text-emerald-700' };
  if (total > 0 && remaining <= 0) return { label: 'Paid', tone: 'bg-emerald-100 text-emerald-700' };
  if (order.paymentStatus === 'awaiting_confirmation') return { label: 'Payment pending', tone: 'bg-amber-100 text-amber-700' };
  if (paid > 0) return { label: `Partly paid · ${money(remaining)} due`, tone: 'bg-orange-100 text-orange-700' };
  return { label: `Unpaid · ${money(remaining || total)}`, tone: 'bg-rose-100 text-rose-700' };
}

function PaymentTag({ order }: { order: SavedOrder }) {
  const state = paymentState(order);
  return (
    <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${state.tone}`}>
      <Wallet size={11} />
      {state.label}
    </span>
  );
}

function AppointmentRow({ order, showDate, offline, onCheckup, onReopen }: { order: SavedOrder; showDate: boolean; offline: boolean; onCheckup: () => void; onReopen: () => void }) {
  const done = order.checkupStatus === 'done';
  const phone = order.customer?.phone && order.customer.phone !== '03000000000' ? order.customer.phone : '';
  const services = order.items.filter((item) => item.name !== order.doctorName);
  return (
    <div className={`flex flex-wrap items-center gap-4 rounded-2xl border p-4 ${done ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-white'}`}>
      <div className="w-24 shrink-0 text-center">
        <p className="flex items-center justify-center gap-1 text-lg font-black text-gray-900"><Clock size={15} className="text-gray-400" />{formatSlot(order.appointmentTime)}</p>
        {showDate ? <p className="text-[11px] font-bold text-gray-500">{formatAppointmentDate(order.appointmentDate)}</p> : null}
        <p className="text-[10px] font-bold uppercase text-gray-400">#{String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0')}</p>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-base font-black text-gray-900">{order.customer?.name || 'Patient'}</p>
          <SourceTag order={order} />
          <PaymentTag order={order} />
        </div>
        {phone ? <p className="flex items-center gap-1 text-xs font-bold text-gray-500"><Phone size={12} />{phone}</p> : null}
        {services.length > 0 ? <p className="truncate text-xs font-semibold text-gray-500">Services: {services.map((s) => s.name).join(', ')}</p> : null}
        {order.note ? <p className="truncate text-xs font-semibold text-indigo-600">Note: {order.note}</p> : null}
        {done && order.diagnosis ? <p className="truncate text-xs font-semibold text-rose-700">Disease: {order.diagnosis}</p> : null}
        {done && order.prescription ? <p className="line-clamp-2 whitespace-pre-line text-xs font-semibold text-emerald-700">Rx: {order.prescription}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {done ? (
          <>
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black text-emerald-700"><CheckCircle2 size={13} />Checked</span>
            <button type="button" onClick={onCheckup} disabled={offline} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-200 disabled:opacity-50">View / Edit</button>
            <button type="button" onClick={() => printPrescription(order)} className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-200"><Printer size={13} />Print</button>
            <button type="button" onClick={onReopen} disabled={offline} title="Mark as not checked - books this time slot again" className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-500 hover:bg-gray-200 disabled:opacity-50"><Undo2 size={13} />Uncheck</button>
          </>
        ) : (
          <>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-700">Waiting</span>
            <button
              type="button"
              onClick={onCheckup}
              disabled={offline}
              title={offline ? 'Needs internet - this appointment has not synced yet' : 'Write medicine details and complete the checkup'}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow hover:bg-indigo-700 disabled:opacity-50"
            >
              <Stethoscope size={14} /> Check up
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CheckupModal({ order, onClose, onSaved }: { order: SavedOrder; onClose: () => void; onSaved: (updated: SavedOrder) => void }) {
  const { toast } = useToast();
  const [prescription, setPrescription] = useState(order.prescription || '');
  const [diagnosis, setDiagnosis] = useState(order.diagnosis || '');
  const [saving, setSaving] = useState(false);
  const alreadyDone = order.checkupStatus === 'done';
  useBackspaceToClose(onClose);

  async function submit(print: boolean) {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await saveCheckup(order.id, prescription.trim(), true, diagnosis.trim());
      if (!updated) throw new Error('Could not save this checkup.');
      const merged = { ...order, ...updated };
      if (print && !printPrescription(merged)) {
        toast.error('The print window was blocked - allow pop-ups for this app, then use Print.');
      }
      toast.success(alreadyDone
        ? 'Medicine details updated.'
        : `Checkup complete - the ${formatSlot(order.appointmentTime)} slot is free again. Its set medicines were taken off Medicine Stock.`);
      if (updated.stockWarning) toast.error(updated.stockWarning);
      onSaved(merged);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this checkup.');
    } finally {
      setSaving(false);
    }
  }

  const phone = order.customer?.phone && order.customer.phone !== '03000000000' ? order.customer.phone : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[32px] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-indigo-500">{alreadyDone ? 'Checkup done' : 'Checkup'} · {order.doctorName}</p>
            <h2 className="text-2xl font-black text-gray-900">{order.customer?.name || 'Patient'}</h2>
            <p className="text-xs font-bold text-gray-500">
              {formatAppointmentDate(order.appointmentDate)} · {formatSlot(order.appointmentTime)}
              {phone ? ` · ${phone}` : ''} · #{String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-gray-100 p-2 text-gray-500 hover:bg-gray-200"><X size={16} /></button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          <SourceTag order={order} />
          <PaymentTag order={order} />
        </div>

        {order.note ? <p className="mb-3 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">Appointment note: {order.note}</p> : null}

        <label className="mb-1 block text-xs font-black uppercase tracking-widest text-gray-400">Disease / Diagnosis</label>
        <input
          autoFocus
          value={diagnosis}
          onChange={(event) => setDiagnosis(event.target.value)}
          maxLength={1000}
          placeholder="e.g. Tooth decay (lower left molar), Gum infection, Sensitivity"
          className="mb-3 w-full rounded-2xl border border-gray-200 bg-[#FFFDF5] px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:border-indigo-400"
        />

        <label className="mb-1 block text-xs font-black uppercase tracking-widest text-gray-400">Medicine details / Prescription</label>
        <textarea
          value={prescription}
          onChange={(event) => setPrescription(event.target.value)}
          rows={10}
          placeholder={'e.g.\nAmoxicillin 500mg - 1 tab 3 times a day - 5 days\nPanadol 500mg - when needed for pain\nWarm salt water rinse twice a day'}
          className="w-full resize-y rounded-2xl border border-gray-200 bg-[#FFFDF5] p-4 font-mono text-sm leading-6 text-gray-800 outline-none focus:border-indigo-400"
        />

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-2xl bg-gray-100 px-4 py-3 text-sm font-black text-gray-600 hover:bg-gray-200">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void submit(false)} className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60">
            {alreadyDone ? <RotateCcw size={16} /> : <CheckCircle2 size={16} />} {alreadyDone ? 'Save' : 'Complete Checkup'}
          </button>
          <button type="button" disabled={saving} onClick={() => void submit(true)} className="flex items-center gap-2 rounded-2xl bg-black px-4 py-3 text-sm font-black text-white hover:bg-gray-800 disabled:opacity-60">
            <Printer size={16} /> {alreadyDone ? 'Save & Print' : 'Complete & Print'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServicesList({ services, loading }: { services: Product[]; loading: boolean }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? services.filter((s) => `${s.name} ${s.category} ${s.variation}`.toLowerCase().includes(q)) : services;
  }, [services, query]);

  return (
    <section className="space-y-4 rounded-[32px] bg-white p-6 shadow-sm">
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services..." className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm font-semibold outline-none focus:border-indigo-400" />
      </div>
      {loading ? (
        <p className="py-6 text-center text-sm font-bold text-gray-400">Loading services...</p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl bg-gray-50 p-4 text-sm font-semibold text-gray-500">No services yet. Add them from Settings &gt; Manage Appointments with any category other than Drs.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((service) => (
            <div key={String(service.id)} className="flex items-center gap-3 rounded-2xl border border-gray-200 p-3">
              <img src={resolveProductImage(service)} alt="" className="h-12 w-12 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-gray-900">{service.name}</p>
                <p className="truncate text-[11px] font-bold text-gray-400">{service.category}{service.variation && service.variation !== 'Standard' ? ` · ${service.variation}` : ''}</p>
              </div>
              <p className="text-sm font-black text-gray-900">{money(service.price)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
