// Clinic appointment helpers - shared by the POS time-slot picker and the
// Drs & Services page.
//
// A slot is one Dr + one date + one time. It stays booked while an
// appointment holds it that isn't cancelled and whose checkup isn't done
// yet. Once the Dr marks the checkup done, the slot is free again. The
// backend enforces the same rule on save (see orderController.js's
// findSlotConflict), so two tills can't book the same slot.
import { useEffect, useState } from 'react';
import { isDesktopApp } from '@/lib/api';
import { fetchAppointments, fetchLeaves, type AppointmentQuery } from '@/lib/pos-api';
import { loadOrdersFromLocalHub } from '@/lib/offline-order-helpers';
import { buildReceiptShellHtml } from '@/lib/order-receipt-print';
import type { SavedOrder } from '@/lib/pos-types';

import { openPrintFrame, printWhenReady } from '@/lib/print-frame';
import { buildPrescriptionA4Html } from '@/lib/prescription-a4';
import { fetchPrescriptionImages } from '@/lib/pos-api';

// Default clinic hours and slot length. The real hours come from Settings
// (Business Start / End Time, saved on the server) - see setClinicHours.
export const SLOT_DAY_START = '09:00';
export const SLOT_DAY_END = '21:00';
export const SLOT_MINUTES = 30;

const HHMM = /^\d{2}:\d{2}$/;
const CLINIC_HOURS_KEY = 'clinic_hours';
const CLINIC_HOURS_EVENT = 'clinic-hours-updated';

function readCachedHours(): { start: string; end: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(CLINIC_HOURS_KEY) || 'null');
    if (saved && HHMM.test(saved.start) && HHMM.test(saved.end)) return saved;
  } catch {
    // no cache / private window
  }
  return { start: SLOT_DAY_START, end: SLOT_DAY_END };
}

let clinicHoursNow = typeof window === 'undefined' ? { start: SLOT_DAY_START, end: SLOT_DAY_END } : readCachedHours();

// Settings' Business Start/End Time. End at or before start (e.g. 02:00
// at night) means the slots run until midnight.
export function setClinicHours(start?: string, end?: string, remember = true) {
  const s = start && HHMM.test(start) ? start : SLOT_DAY_START;
  const e = end && HHMM.test(end) ? end : SLOT_DAY_END;
  const next = { start: s, end: e };
  if (next.start === clinicHoursNow.start && next.end === clinicHoursNow.end) return;
  clinicHoursNow = next;
  if (remember) {
    try {
      localStorage.setItem(CLINIC_HOURS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLINIC_HOURS_EVENT));
}

export function clinicStart() {
  return clinicHoursNow.start;
}

export function clinicEnd() {
  return clinicHoursNow.end <= clinicHoursNow.start ? '24:00' : clinicHoursNow.end;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildTimeSlots(): string[] {
  const slots: string[] = [];
  for (let t = toMinutes(clinicStart()); t < toMinutes(clinicEnd()); t += SLOT_MINUTES) {
    slots.push(fromMinutes(t));
  }
  return slots;
}

// The day's time slots, refreshed when the clinic hours change.
export function useTimeSlots() {
  const [slots, setSlots] = useState(buildTimeSlots);
  useEffect(() => {
    const refresh = () => setSlots(buildTimeSlots());
    window.addEventListener(CLINIC_HOURS_EVENT, refresh);
    return () => window.removeEventListener(CLINIC_HOURS_EVENT, refresh);
  }, []);
  return slots;
}

// "14:30" -> "2:30 PM"
export function formatSlot(hhmm?: string) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [hRaw, m] = hhmm.split(':').map(Number);
  const h = hRaw % 24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// "2026-10-15" -> "15 Oct 2026"
export function formatAppointmentDate(iso?: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Local calendar date (not UTC), so late-evening bookings land on the
// right day in Pakistan time.
export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// True if a slot on this date has already started (can't book the past).
export function isSlotInPast(date: string, hhmm: string, now = new Date()) {
  const today = todayISO(now);
  if (date < today) return true;
  if (date > today) return false;
  return toMinutes(hhmm) <= now.getHours() * 60 + now.getMinutes();
}

// --- Weekly schedule (Manage Appointments) ------------------------------
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface WorkSchedule {
  days: number[]; // empty = every day
  start: string; // '' = clinic opening
  end: string; // '' = clinic closing
}

export function scheduleOf(product?: { workDays?: number[]; workStart?: string; workEnd?: string } | null): WorkSchedule {
  const days = (product?.workDays || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const valid = (t?: string) => (t && /^\d{2}:\d{2}$/.test(t) ? t : '');
  return { days: [...new Set(days)].sort((a, b) => a - b), start: valid(product?.workStart), end: valid(product?.workEnd) };
}

export function weekdayOfISO(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function worksOnDate(schedule: WorkSchedule, iso: string) {
  if (!iso || schedule.days.length === 0) return true;
  return schedule.days.includes(weekdayOfISO(iso));
}

export function slotInHours(schedule: WorkSchedule, hhmm: string) {
  if (schedule.start && hhmm < schedule.start) return false;
  if (schedule.end && hhmm >= schedule.end) return false;
  return true;
}

// "Mon, Tue · 10:00 AM - 2:00 PM" ('' when it's every day, all day)
export function describeSchedule(schedule: WorkSchedule) {
  const days = schedule.days.length === 0 || schedule.days.length === 7 ? '' : schedule.days.map((d) => WEEKDAY_SHORT[d]).join(', ');
  const hours = schedule.start || schedule.end
    ? `${formatSlot(schedule.start || clinicStart())} - ${formatSlot(schedule.end || clinicEnd())}`
    : '';
  return [days, hours].filter(Boolean).join(' · ');
}

// Extra availability for one date (Dr Availability page) - beats the
// weekly routine: the whole day, or just these slots.
export interface ExtraDay {
  fullDay: boolean;
  times: Set<string>;
}

export const NO_EXTRA: ExtraDay = { fullDay: false, times: new Set() };

// Can this Dr/Service be booked at all on this date?
export function dayOpen(schedule: WorkSchedule, iso: string, extra: ExtraDay = NO_EXTRA) {
  return extra.fullDay || extra.times.size > 0 || worksOnDate(schedule, iso);
}

// Is this slot inside the routine, or an extra slot for that date?
export function slotOpen(schedule: WorkSchedule, iso: string, slot: string, extra: ExtraDay = NO_EXTRA) {
  if (extra.fullDay || extra.times.has(slot)) return true;
  return worksOnDate(schedule, iso) && slotInHours(schedule, slot);
}

// A Drs/Services item counts as a Dr when its category is something like
// "Dr", "Drs", "Doctor", "Doctors", or its name starts with "Dr".
export function isDoctorProduct(product: { name?: string; category?: string } | undefined | null) {
  if (!product) return false;
  if (/\b(drs?|doctors?)\b/i.test(product.category || '')) return true;
  return /^dr\.?\s/i.test(product.name || '');
}

type DrLike = { name: string; category?: string; workDays?: number[]; workStart?: string; workEnd?: string; serviceDoctors?: string[]; specialType?: unknown };

// The Drs who can do this Service (Manage Appointments) - every Dr when
// none are picked. One entry per Dr name.
export function drsForService<T extends DrLike>(service: DrLike | null | undefined, catalog: T[]): T[] {
  if (!service || isDoctorProduct(service)) return [];
  const seen = new Set<string>();
  const drs = catalog.filter((p) => {
    if (!isDoctorProduct(p) || seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
  const allowed = service.serviceDoctors || [];
  return allowed.length > 0 ? drs.filter((d) => allowed.includes(d.name)) : drs;
}

// Is this Dr in today? Routine day (Manage Appointments), not on full-day
// leave, or marked extra-available today (Dr Availability).
export function inToday(dr: DrLike, offToday: Set<string>, extraToday: Set<string>, iso = todayISO()) {
  if (extraToday.has(dr.name)) return true;
  if (offToday.has(dr.name)) return false;
  return worksOnDate(scheduleOf(dr), iso);
}

export function isSlotHolding(order: Pick<SavedOrder, 'status' | 'checkupStatus' | 'appointmentTime'>) {
  return !!order.appointmentTime && order.status !== 'cancelled' && order.checkupStatus !== 'done';
}

function matchesQuery(order: SavedOrder, query: AppointmentQuery) {
  if (!order.appointmentTime || !order.appointmentDate || order.status === 'cancelled') return false;
  if (query.doctor && order.doctorName !== query.doctor) return false;
  if (query.date && order.appointmentDate !== query.date) return false;
  if (!query.date && query.from && order.appointmentDate < query.from) return false;
  if (query.status === 'done' && order.checkupStatus !== 'done') return false;
  if (query.status === 'waiting' && order.checkupStatus === 'done') return false;
  return true;
}

function sortAppointments(list: SavedOrder[]) {
  return list.sort((a, b) =>
    `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(`${b.appointmentDate} ${b.appointmentTime}`),
  );
}

// Appointments from the cloud, plus (in the desktop app) any appointment
// still waiting in this till's offline queue. If the cloud can't be
// reached, the till's own cached copy is used instead, so the list still
// works offline.
export async function loadAppointments(query: AppointmentQuery): Promise<{ list: SavedOrder[]; fromCache: boolean; error?: string }> {
  let cloud: SavedOrder[] | null = null;
  let error: string | undefined;
  try {
    cloud = (await fetchAppointments(query)) || [];
  } catch (err) {
    cloud = null;
    error = err instanceof Error ? err.message : 'Could not reach the server.';
  }

  let local: SavedOrder[] = [];
  if (isDesktopApp()) {
    try {
      local = (await loadOrdersFromLocalHub()).filter((order) => matchesQuery(order, query));
    } catch {
      local = [];
    }
  }

  if (cloud === null) {
    return { list: sortAppointments(local), fromCache: true, error };
  }
  const byId = new Map<string, SavedOrder>();
  cloud.forEach((order) => byId.set(order.id, order));
  // Only add local entries the cloud doesn't know about yet (still-queued
  // offline appointments) - the cloud copy wins for everything else.
  local.forEach((order) => {
    if (!byId.has(order.id) && order.id.startsWith('local-')) byId.set(order.id, order);
  });
  return { list: sortAppointments([...byId.values()]), fromCache: false };
}

// Dr/Service leave from today on (Availability page). Empty when offline.
export interface LeaveInfo {
  fullDays: Set<string>;
  // date -> times off that date (part-day leave)
  partTimes: Map<string, Set<string>>;
  // Extra availability outside the weekly routine.
  extraFullDays: Set<string>;
  extraTimes: Map<string, Set<string>>;
}

export const NO_LEAVE: LeaveInfo = { fullDays: new Set(), partTimes: new Map(), extraFullDays: new Set(), extraTimes: new Map() };

export function extraFor(info: LeaveInfo, iso: string): ExtraDay {
  return { fullDay: info.extraFullDays.has(iso), times: info.extraTimes.get(iso) || new Set() };
}

export async function loadLeaveInfo(name: string): Promise<LeaveInfo> {
  try {
    const list = (await fetchLeaves({ name, from: todayISO() })) || [];
    const info: LeaveInfo = { fullDays: new Set(), partTimes: new Map(), extraFullDays: new Set(), extraTimes: new Map() };
    list.forEach((leave) => {
      if (leave.fullDay) info.fullDays.add(leave.date);
      else if (leave.times?.length) info.partTimes.set(leave.date, new Set(leave.times));
      if (leave.extraFullDay) info.extraFullDays.add(leave.date);
      else if (leave.extraTimes?.length) info.extraTimes.set(leave.date, new Set(leave.extraTimes));
    });
    return info;
  } catch {
    return NO_LEAVE;
  }
}

// "18 Oct, 20 Oct (2:00 PM, 2:30 PM)" - next few leave days for a short note.
export function describeUpcomingLeave(info: LeaveInfo, limit = 4) {
  const dates = [...new Set([...info.fullDays, ...info.partTimes.keys()])].sort().slice(0, limit);
  return dates
    .map((date) => {
      const short = formatAppointmentDate(date).replace(/ \d{4}$/, '');
      if (info.fullDays.has(date)) return `${short} (full day)`;
      const times = [...(info.partTimes.get(date) || [])].sort().map(formatSlot);
      return `${short} (${times.length > 2 ? `${times.length} slots` : times.join(', ')})`;
    })
    .join(' · ');
}

// "Sun 25 Oct (4:00 PM - 5:30 PM) · Sat 31 Oct (full day)" - next few
// extra-availability days (outside the weekly routine).
export function describeUpcomingExtra(info: LeaveInfo, limit = 5) {
  const dates = [...new Set([...info.extraFullDays, ...info.extraTimes.keys()])].sort().slice(0, limit);
  return dates
    .map((date) => {
      const short = `${WEEKDAY_SHORT[weekdayOfISO(date)]} ${formatAppointmentDate(date).replace(/ \d{4}$/, '')}`;
      if (info.extraFullDays.has(date)) return `${short} (full day)`;
      const times = [...(info.extraTimes.get(date) || [])].sort();
      return `${short} (${formatSlot(times[0])} - ${formatSlot(times[times.length - 1])})`;
    })
    .join(' · ');
}

// Booked time -> patient name, for one Dr on one date.
export async function loadBookedSlots(doctor: string, date: string): Promise<Map<string, string>> {
  const { list } = await loadAppointments({ doctor, date, status: 'waiting' });
  const booked = new Map<string, string>();
  list.forEach((order) => {
    if (isSlotHolding(order) && order.appointmentTime) {
      // "Ali · Root Canal" - who, and which service the Dr is busy on.
      const services = (order.items || [])
        .filter((item) => item.name !== doctor && !isDoctorProduct({ name: item.name }))
        .map((item) => item.name);
      const who = order.customer?.name || 'Patient';
      booked.set(order.appointmentTime, services.length ? `${who} · ${services.join(', ')}` : who);
    }
  });
  return booked;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Prints the Dr's medicine details for one appointment on a full A4 page
// (letterhead layout - see prescription-a4.ts).
export function printPrescription(order: SavedOrder, images: string[] = []) {
  const printWindow = openPrintFrame();
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(buildPrescriptionA4Html(order, images));
  printWindow.document.close();
  printWhenReady(printWindow);
  return true;
}

// Prints the prescription together with its attached pictures (loaded
// first when there are any).
export async function printPrescriptionWithImages(order: SavedOrder, images?: string[]) {
  let pictures = images;
  if (!pictures && (order.prescriptionImageCount || 0) > 0) {
    try {
      pictures = ((await fetchPrescriptionImages(order.id)) || []).map((img) => img.data);
    } catch {
      pictures = [];
    }
  }
  return printPrescription(order, pictures || []);
}
