// Dr Availability page.
//
// Pick a Dr or Service, pick a date, and mark leave - the whole day, or
// just some time slots. Or the opposite: mark them Available on a date or
// time outside their weekly routine (Manage Appointments' work days and
// hours) - those extra slots can then be booked too. Leave is blocked on the POS time-slot picker and
// on the patients' online appointment page (and by the backend on save -
// see backend/services/leaveService.js), so nobody can book a Dr or
// Service while they're away.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarOff, CheckCircle2, Pencil, RefreshCcw, Save, Search, Trash2, UserRound } from 'lucide-react';
import { deleteLeave, fetchLeaves, fetchProducts, saveLeave, type LeaveEntry } from '@/lib/pos-api';
import type { Product } from '@/lib/pos-types';
import { resolveProductImage } from '@/lib/food-images';
import { describeSchedule, formatAppointmentDate, formatSlot, isDoctorProduct, isSlotInPast, loadBookedSlots, scheduleOf, slotInHours, todayISO, useTimeSlots, WEEKDAY_LONG, WEEKDAY_SHORT, weekdayOfISO, worksOnDate } from '@/lib/appointments';
import { useToast } from '@/lib/toast';

type Tab = 'drs' | 'services';
// What a tap on a time slot marks: leave, or extra availability.
type Mode = 'leave' | 'extra';

function hasLeave(entry: LeaveEntry) {
  return entry.fullDay || entry.times.length > 0;
}

function hasExtra(entry: LeaveEntry) {
  return !!entry.extraFullDay || (entry.extraTimes?.length || 0) > 0;
}

interface Card {
  name: string;
  image: string;
  category: string;
}

export default function AvailabilityPage() {
  const { toast, confirm } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [tab, setTab] = useState<Tab>('drs');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [leaves, setLeaves] = useState<LeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<string | null>(null);
  const [date, setDate] = useState(() => todayISO());
  const [fullDay, setFullDay] = useState(false);
  const [times, setTimes] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('leave');
  const [extraFullDay, setExtraFullDay] = useState(false);
  const [extraTimes, setExtraTimes] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booked, setBooked] = useState<Map<string, string>>(new Map());

  const timeSlots = useTimeSlots();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchProducts(), fetchLeaves({ from: todayISO() })])
      .then(([catalog, list]) => {
        if (cancelled) return;
        setProducts((catalog?.products || []).filter((p) => !p.specialType));
        setLeaves(list || []);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load availability.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const toCards = useCallback((list: Product[]) => {
    const byName = new Map<string, Card>();
    list.forEach((p) => {
      if (!byName.has(p.name)) byName.set(p.name, { name: p.name, image: resolveProductImage(p), category: p.category });
    });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const drs = useMemo(() => toCards(products.filter((p) => isDoctorProduct(p))), [products, toCards]);
  const services = useMemo(() => toCards(products.filter((p) => !isDoctorProduct(p))), [products, toCards]);
  const list = useMemo(() => {
    const source = tab === 'drs' ? drs : services;
    const q = search.trim().toLowerCase();
    return q ? source.filter((c) => c.name.toLowerCase().includes(q)) : source;
  }, [tab, drs, services, search]);

  const leavesByName = useMemo(() => {
    const map = new Map<string, LeaveEntry[]>();
    leaves.forEach((leave) => {
      if (!map.has(leave.name)) map.set(leave.name, []);
      map.get(leave.name)!.push(leave);
    });
    map.forEach((entries) => entries.sort((a, b) => a.date.localeCompare(b.date)));
    return map;
  }, [leaves]);

  const selectedCard = [...drs, ...services].find((c) => c.name === selected) || null;
  const selectedLeaves = selected ? leavesByName.get(selected) || [] : [];
  const savedForDate = selectedLeaves.find((leave) => leave.date === date) || null;
  const kind = tab === 'drs' ? 'Dr' : 'Service';
  // Weekly routine from Manage Appointments.
  const routine = useMemo(() => scheduleOf(products.find((p) => p.name === selected)), [products, selected]);
  const routineText = describeSchedule(routine) || 'Every day, all clinic hours';
  const routineDay = worksOnDate(routine, date);
  const inRoutine = (slot: string) => routineDay && slotInHours(routine, slot);

  // Load what's saved for this Dr/Service + date into the editor.
  const loadEditor = useCallback((name: string | null, forDate: string, source: LeaveEntry[]) => {
    const saved = name ? source.find((leave) => leave.name === name && leave.date === forDate) : null;
    setFullDay(!!saved?.fullDay);
    setTimes(new Set(saved?.times || []));
    setExtraFullDay(!!saved?.extraFullDay);
    setExtraTimes(new Set(saved?.extraTimes || []));
    setNote(saved?.note || '');
    setDirty(false);
  }, []);

  // Patients already booked on that date - shown so staff can see who
  // needs a call if the Dr goes on leave.
  useEffect(() => {
    if (!selected || !date) {
      setBooked(new Map());
      return;
    }
    let cancelled = false;
    void loadBookedSlots(selected, date)
      .then((map) => {
        if (!cancelled) setBooked(map);
      })
      .catch(() => {
        if (!cancelled) setBooked(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [selected, date]);

  async function confirmLeaveUnsaved() {
    if (!dirty) return true;
    return confirm('You have unsaved leave changes. Leave without saving?', { title: 'Unsaved changes', confirmText: 'Leave', tone: 'danger' });
  }

  async function pickCard(name: string) {
    if (name === selected) return;
    if (!(await confirmLeaveUnsaved())) return;
    setSelected(name);
    loadEditor(name, date, leaves);
  }

  async function pickDate(value: string) {
    const next = value || todayISO();
    if (next === date) return;
    if (!(await confirmLeaveUnsaved())) return;
    setDate(next);
    loadEditor(selected, next, leaves);
  }

  async function switchTab(next: Tab) {
    if (next === tab) return;
    if (!(await confirmLeaveUnsaved())) return;
    setTab(next);
    setSelected(null);
    setSearch('');
    setDirty(false);
  }

  // A slot is leave OR extra, never both - marking one clears the other.
  function toggleTime(slot: string) {
    const [mine, other] = mode === 'leave' ? [times, extraTimes] : [extraTimes, times];
    const [setMine, setOther] = mode === 'leave' ? [setTimes, setExtraTimes] : [setExtraTimes, setTimes];
    const nextMine = new Set(mine);
    if (nextMine.has(slot)) nextMine.delete(slot);
    else nextMine.add(slot);
    setMine(nextMine);
    if (other.has(slot)) {
      const nextOther = new Set(other);
      nextOther.delete(slot);
      setOther(nextOther);
    }
    setDirty(true);
  }

  function selectAllAfter(fromSlot: string | null, toSlot: string | null) {
    const picked = timeSlots.filter((slot) => (!fromSlot || slot >= fromSlot) && (!toSlot || slot < toSlot) && !isSlotInPast(date, slot));
    if (mode === 'leave') {
      setTimes(new Set(picked));
      setExtraTimes((previous) => new Set([...previous].filter((slot) => !picked.includes(slot))));
    } else {
      setExtraTimes(new Set(picked));
      setTimes((previous) => new Set([...previous].filter((slot) => !picked.includes(slot))));
    }
    setDirty(true);
  }

  function setModeFullDay(on: boolean) {
    if (mode === 'leave') {
      setFullDay(on);
      if (on) setExtraFullDay(false);
    } else {
      setExtraFullDay(on);
      if (on) setFullDay(false);
    }
    setDirty(true);
  }

  function applySaved(saved: LeaveEntry & { deleted?: boolean }) {
    setLeaves((previous) => {
      const rest = previous.filter((leave) => !(leave.name === saved.name && leave.date === saved.date));
      return saved.deleted ? rest : [...rest, saved];
    });
  }

  async function handleSave() {
    if (!selected) return;
    const extraOn = !fullDay && (extraFullDay || extraTimes.size > 0);
    if (!fullDay && times.size === 0 && !extraOn && !savedForDate) {
      toast.error(`Tap the time slots the ${kind} is away (Leave) or extra available (Available), or turn on Full day.`);
      return;
    }
    const clashes = [...booked.entries()].filter(([slot]) => fullDay || times.has(slot));
    if (clashes.length > 0) {
      const ok = await confirm(
        `${clashes.length} patient${clashes.length === 1 ? ' is' : 's are'} already booked in this leave time: ${clashes
          .map(([slot, name]) => `${name} at ${formatSlot(slot)}`)
          .join(', ')}. Their appointments stay - please call them to move. Save the leave anyway?`,
        { title: 'Patients already booked', confirmText: 'Save leave' },
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const saved = await saveLeave({
        name: selected,
        date,
        fullDay,
        times: fullDay ? [] : [...times].sort(),
        extraFullDay: !fullDay && extraFullDay,
        extraTimes: fullDay || extraFullDay ? [] : [...extraTimes].sort(),
        note: note.trim(),
      });
      if (saved) applySaved(saved);
      setDirty(false);
      const day = formatAppointmentDate(date);
      const parts: string[] = [];
      if (fullDay) parts.push(`on leave all day on ${day} - no bookings that day`);
      else if (times.size) parts.push(`on leave for ${times.size} slot${times.size === 1 ? '' : 's'}`);
      if (!fullDay && extraFullDay) parts.push(`available all day on ${day}`);
      else if (!fullDay && extraTimes.size) parts.push(`extra available for ${extraTimes.size} slot${extraTimes.size === 1 ? '' : 's'}`);
      toast.success(saved?.deleted ? `${selected} follows the normal routine on ${day}.` : `${selected} is ${parts.join(' and ')} on ${day}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the leave.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(leave: LeaveEntry) {
    const ok = await confirm(`Remove ${leave.name}'s leave / extra availability on ${formatAppointmentDate(leave.date)}? That day goes back to the normal routine.`, {
      title: 'Remove',
      confirmText: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteLeave(leave.id);
      setLeaves((previous) => previous.filter((entry) => entry.id !== leave.id));
      if (leave.name === selected && leave.date === date) {
        setFullDay(false);
        setTimes(new Set());
        setExtraFullDay(false);
        setExtraTimes(new Set());
        setNote('');
        setDirty(false);
      }
      toast.success('Removed - back to the normal routine.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the leave.');
    }
  }

  async function editLeave(leave: LeaveEntry) {
    if (!(await confirmLeaveUnsaved())) return;
    setDate(leave.date);
    loadEditor(leave.name, leave.date, leaves);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-gray-900">
            Dr Availability <CalendarOff className="text-[#00B0C7]" size={30} />
          </h1>
          <p className="font-bold text-gray-500">Mark leave (can&apos;t be booked), or extra availability outside the weekly routine (can be booked).</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-gray-600 shadow-sm hover:bg-gray-50"
          >
            <RefreshCcw size={15} /> Refresh
          </button>
          <div className="flex gap-2 rounded-full bg-white p-1.5 shadow-sm">
            <button type="button" onClick={() => void switchTab('drs')} className={`rounded-full px-5 py-2 text-sm font-black ${tab === 'drs' ? 'bg-black text-white' : 'text-gray-500'}`}>
              Drs ({drs.length})
            </button>
            <button type="button" onClick={() => void switchTab('services')} className={`rounded-full px-5 py-2 text-sm font-black ${tab === 'services' ? 'bg-black text-white' : 'text-gray-500'}`}>
              Services ({services.length})
            </button>
          </div>
        </div>
      </div>

      {loadError ? <div className="rounded-[24px] bg-rose-50 p-4 text-sm font-bold text-rose-700">{loadError}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <aside className="rounded-[28px] bg-white p-4 shadow-sm">
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'drs' ? 'Search Drs' : 'Search Services'}
              className="w-full rounded-2xl bg-gray-50 py-2.5 pl-9 pr-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#00B0C7]/40"
            />
          </div>
          <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <p className="p-4 text-sm text-gray-400">Loading...</p>
            ) : list.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">{tab === 'drs' ? 'No Drs yet.' : 'No Services yet.'}</p>
            ) : (
              list.map((card) => {
                const entries = leavesByName.get(card.name) || [];
                const count = entries.length;
                const offToday = entries.some((leave) => leave.date === todayISO() && hasLeave(leave));
                const extraToday = entries.some((leave) => leave.date === todayISO() && hasExtra(leave));
                const active = card.name === selected;
                return (
                  <button
                    key={card.name}
                    type="button"
                    onClick={() => void pickCard(card.name)}
                    className={`flex w-full items-center gap-3 rounded-[20px] p-2.5 text-left transition ${active ? 'bg-[#EBFAFC] ring-2 ring-[#00B0C7]' : 'hover:bg-gray-50'}`}
                  >
                    <img src={card.image} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-2xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-gray-900">{card.name}</p>
                      <p className="truncate text-[11px] font-semibold text-gray-400">{card.category}</p>
                    </div>
                    {offToday ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-700">Leave today</span>
                    ) : extraToday ? (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">Extra today</span>
                    ) : count > 0 ? (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black text-gray-600">{count} date{count === 1 ? '' : 's'}</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">Available</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="rounded-[28px] bg-white p-5 shadow-sm sm:p-6">
          {!selected ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center text-gray-400">
              <UserRound size={48} strokeWidth={1.4} />
              <p className="font-bold text-gray-500">Pick a {kind} on the left</p>
              <p className="max-w-sm text-sm">Then choose a date and mark the full day, or the time slots, they&apos;re away.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {selectedCard ? <img src={selectedCard.image} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" /> : null}
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-black text-gray-900">{selected}</h2>
                    <p className="text-xs font-bold text-gray-400">
                      {savedForDate && hasLeave(savedForDate)
                        ? savedForDate.fullDay ? 'On leave all day' : `On leave ${savedForDate.times.length} slot${savedForDate.times.length === 1 ? '' : 's'}`
                        : savedForDate && hasExtra(savedForDate)
                          ? 'Extra available'
                          : routineDay ? 'Normal routine' : 'Not in routine'}{' '}
                      on {WEEKDAY_SHORT[weekdayOfISO(date)]} {formatAppointmentDate(date)}
                      {savedForDate && hasLeave(savedForDate) && hasExtra(savedForDate) ? ' + extra slots' : ''}
                      {dirty ? <span className="ml-2 text-amber-600">Unsaved changes</span> : null}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={saving || !dirty}
                  onClick={() => void handleSave()}
                  className="flex items-center gap-2 rounded-full bg-[#00B0C7] px-6 py-3 text-sm font-black text-gray-900 shadow-sm transition hover:bg-[#009AAE] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <RefreshCcw size={16} className="animate-spin" /> : dirty ? <Save size={16} /> : <CheckCircle2 size={16} />}
                  {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-[20px] bg-gray-50 p-3">
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">Routine</span>
                <span className="text-sm font-black text-[#007F90]">{routineText}</span>
                <span className="text-[11px] font-semibold text-gray-400">(set in Manage Appointments)</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMode('leave')}
                  className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition ${mode === 'leave' ? 'bg-amber-400 text-white shadow' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-amber-50'}`}
                >
                  <CalendarOff size={16} /> Mark Leave
                </button>
                <button
                  type="button"
                  onClick={() => setMode('extra')}
                  className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition ${mode === 'extra' ? 'bg-emerald-500 text-white shadow' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-emerald-50'}`}
                >
                  <CalendarCheck size={16} /> Mark Available
                </button>
                <p className="self-center text-[11px] font-semibold text-gray-400">
                  {mode === 'leave' ? 'Tap slots the ' + kind + ' is away - they can\'t be booked.' : 'Tap slots outside the routine the ' + kind + ' will be in - they can be booked.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="date"
                    value={date}
                    min={todayISO()}
                    onChange={(e) => void pickDate(e.target.value)}
                    className="rounded-2xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#00B0C7]/40"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-black text-gray-700">
                  <input
                    type="checkbox"
                    checked={mode === 'leave' ? fullDay : extraFullDay}
                    onChange={(e) => setModeFullDay(e.target.checked)}
                    className="h-4 w-4 accent-[#00B0C7]"
                  />
                  {mode === 'leave' ? 'Full day leave' : 'Available full day'}
                </label>
                {!fullDay && !extraFullDay ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => selectAllAfter(null, '13:00')} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-200">Morning</button>
                    <button type="button" onClick={() => selectAllAfter('13:00', '17:00')} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-200">Afternoon</button>
                    <button type="button" onClick={() => selectAllAfter('17:00', null)} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-200">Evening</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (mode === 'leave') setTimes(new Set());
                        else setExtraTimes(new Set());
                        setDirty(true);
                      }}
                      className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-200"
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>

              {fullDay ? (
                <div className="rounded-[20px] border border-amber-300 bg-amber-50 p-5 text-sm font-bold text-amber-800">
                  {selected} won&apos;t be bookable at all on {formatAppointmentDate(date)} - on the POS or online.
                </div>
              ) : extraFullDay ? (
                <div className="rounded-[20px] border border-emerald-300 bg-emerald-50 p-5 text-sm font-bold text-emerald-800">
                  {selected} can be booked all day on {WEEKDAY_LONG[weekdayOfISO(date)]} {formatAppointmentDate(date)} (all clinic hours) - even outside the routine.
                </div>
              ) : (
                <div>
                  {!routineDay ? (
                    <p className="mb-2 rounded-xl bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500">
                      {selected} doesn&apos;t normally work on {WEEKDAY_LONG[weekdayOfISO(date)]}s. Use <span className="text-emerald-700">Mark Available</span> to open some slots for this date.
                    </p>
                  ) : null}
                  <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">
                    {mode === 'leave' ? `Tap the time slots ${selected} is away` : `Tap the extra time slots ${selected} will be in`}
                  </p>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-6">
                    {timeSlots.map((slot) => {
                      const off = times.has(slot);
                      const extra = extraTimes.has(slot);
                      const normal = inRoutine(slot);
                      const patient = booked.get(slot);
                      const past = isSlotInPast(date, slot);
                      return (
                        <button
                          key={slot}
                          type="button"
                          disabled={past}
                          onClick={() => toggleTime(slot)}
                          title={patient ? `Booked: ${patient}` : normal ? formatSlot(slot) : `${formatSlot(slot)} - outside the routine`}
                          className={`rounded-xl border px-1 py-2 text-xs font-black transition ${
                            off
                              ? 'border-amber-400 bg-amber-400 text-white shadow'
                              : extra
                                ? 'border-emerald-500 bg-emerald-500 text-white shadow'
                                : past
                                  ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300'
                                  : !normal
                                    ? `border-dashed border-gray-200 bg-gray-50 text-gray-400 ${mode === 'extra' ? 'hover:border-emerald-300 hover:bg-emerald-50' : ''}`
                                    : `border-gray-200 bg-white text-gray-700 ${mode === 'leave' ? 'hover:border-amber-300 hover:bg-amber-50' : 'hover:border-emerald-300 hover:bg-emerald-50'}`
                          }`}
                        >
                          {formatSlot(slot)}
                          {patient ? (
                            <span className={`block truncate text-[9px] font-bold ${off || extra ? 'text-white/90' : 'text-rose-500'}`}>{patient}</span>
                          ) : !normal && !off && !extra && !past ? (
                            <span className="block text-[9px] font-bold text-gray-400">Off routine</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-gray-400">
                    <span className="text-amber-600">Orange</span> = on leave · <span className="text-emerald-600">Green</span> = extra available · Dashed = outside the routine (not bookable unless marked green). A name under a time means a patient is already booked then.
                  </p>
                </div>
              )}

              <input
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setDirty(true);
                }}
                maxLength={300}
                placeholder="Reason (optional) - e.g. Conference, Personal leave, Extra Saturday clinic"
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#00B0C7]/40"
              />

              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">Upcoming leave &amp; extra days</p>
                {selectedLeaves.length === 0 ? (
                  <p className="rounded-[18px] bg-gray-50 p-4 text-sm text-gray-400">Nothing set - {selected} follows the normal routine on every date.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedLeaves.map((leave) => (
                      <div key={leave.id || leave.date} className={`flex flex-wrap items-center justify-between gap-2 rounded-[18px] border p-3 ${leave.date === date ? 'border-[#00B0C7] bg-[#EBFAFC]' : 'border-gray-100 bg-gray-50'}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-black text-gray-900">{WEEKDAY_SHORT[weekdayOfISO(leave.date)]} {formatAppointmentDate(leave.date)}</p>
                          {hasLeave(leave) ? (
                            <p className="text-xs font-semibold text-amber-700">
                              Leave: {leave.fullDay ? 'Full day' : leave.times.map(formatSlot).join(', ')}
                            </p>
                          ) : null}
                          {hasExtra(leave) ? (
                            <p className="text-xs font-semibold text-emerald-700">
                              Available: {leave.extraFullDay ? 'Full day' : (leave.extraTimes || []).map(formatSlot).join(', ')}
                            </p>
                          ) : null}
                          {leave.note ? <p className="text-xs font-semibold text-gray-500">{leave.note}</p> : null}
                        </div>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => void editLeave(leave)} title="Edit" className="rounded-xl bg-white p-2 text-gray-600 shadow-sm hover:bg-gray-100">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => void handleDelete(leave)} title="Remove" className="rounded-xl bg-white p-2 text-rose-500 shadow-sm hover:bg-rose-50">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
