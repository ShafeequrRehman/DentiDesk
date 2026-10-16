// Clinic appointment helpers - shared by the POS time-slot picker and the
// Drs & Services page.
//
// A slot is one Dr + one date + one time. It stays booked while an
// appointment holds it that isn't cancelled and whose checkup isn't done
// yet. Once the Dr marks the checkup done, the slot is free again. The
// backend enforces the same rule on save (see orderController.js's
// findSlotConflict), so two tills can't book the same slot.
import { isDesktopApp } from '@/lib/api';
import { fetchAppointments, type AppointmentQuery } from '@/lib/pos-api';
import { loadOrdersFromLocalHub } from '@/lib/offline-order-helpers';
import { buildReceiptShellHtml } from '@/lib/order-receipt-print';
import type { SavedOrder } from '@/lib/pos-types';

// Clinic hours and slot length. Change these three to fit the clinic.
export const SLOT_DAY_START = '09:00';
export const SLOT_DAY_END = '21:00';
export const SLOT_MINUTES = 30;

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
  for (let t = toMinutes(SLOT_DAY_START); t < toMinutes(SLOT_DAY_END); t += SLOT_MINUTES) {
    slots.push(fromMinutes(t));
  }
  return slots;
}

// "14:30" -> "2:30 PM"
export function formatSlot(hhmm?: string) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
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

// A Drs/Services item counts as a Dr when its category is something like
// "Dr", "Drs", "Doctor", "Doctors", or its name starts with "Dr".
export function isDoctorProduct(product: { name?: string; category?: string } | undefined | null) {
  if (!product) return false;
  if (/\b(drs?|doctors?)\b/i.test(product.category || '')) return true;
  return /^dr\.?\s/i.test(product.name || '');
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

// Booked time -> patient name, for one Dr on one date.
export async function loadBookedSlots(doctor: string, date: string): Promise<Map<string, string>> {
  const { list } = await loadAppointments({ doctor, date, status: 'waiting' });
  const booked = new Map<string, string>();
  list.forEach((order) => {
    if (isSlotHolding(order) && order.appointmentTime) {
      booked.set(order.appointmentTime, order.customer?.name || 'Patient');
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

// Prints the Dr's medicine details for one appointment on the receipt
// printer (same 80mm layout and clinic header as the patient receipt).
export function printPrescription(order: SavedOrder) {
  const printWindow = window.open('', '_blank', 'width=420,height=640');
  if (!printWindow) return false;
  const appointmentNo = String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0');
  const patientName = order.customer?.name || 'Patient';
  const phone = order.customer?.phone && order.customer.phone !== '03000000000' ? order.customer.phone : '';
  const services = order.items
    .filter((item) => item.name !== order.doctorName)
    .map((item) => `<p>- ${escapeHtml(item.name)}${item.variation && item.variation !== 'Standard' ? ` (${escapeHtml(item.variation)})` : ''}</p>`)
    .join('');
  const prescription = escapeHtml(order.prescription || '').replace(/\n/g, '<br/>');
  const checkedDate = order.checkedAt ? new Date(order.checkedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const bodyHtml = `
    <p><b>${/^dr\.?\s/i.test(order.doctorName || '') ? 'DR' : 'SERVICE'}:</b> ${escapeHtml(order.doctorName || '')}</p>
    <p><b>PATIENT:</b> ${escapeHtml(patientName.toUpperCase())}</p>
    ${phone ? `<p><b>PHONE:</b> ${escapeHtml(phone)}</p>` : ''}
    <p><b>DATE:</b> ${formatAppointmentDate(order.appointmentDate)} ${formatSlot(order.appointmentTime)}</p>
    ${checkedDate ? `<p><b>CHECKED:</b> ${checkedDate}</p>` : ''}
    ${services ? `<div class="dashed"></div><p><b>SERVICES:</b></p>${services}` : ''}
    ${order.diagnosis ? `<div class="dashed"></div><p><b>DISEASE:</b> ${escapeHtml(order.diagnosis)}</p>` : ''}
    <div class="dashed"></div>
    <p style="font-size:16px;font-weight:900">Rx</p>
    <div style="font-size:13px;line-height:18px;white-space:normal">${prescription || '-'}</div>
    <div class="dashed"></div>
    <p style="margin-top:28px">Signature: ____________________</p>
  `;
  printWindow.document.open();
  printWindow.document.write(buildReceiptShellHtml('Prescription', bodyHtml, appointmentNo));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}
