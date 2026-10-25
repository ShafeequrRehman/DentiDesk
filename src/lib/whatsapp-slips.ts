// WhatsApp slips: the appointment slip (when an appointment is saved or
// completed) and the Dr's prescription, sent to the patient as a PDF.
//
// A patient without a correct phone number gets a clear "add a correct
// number first" error instead of a send that silently goes nowhere; the
// backend (whatsappRoutes.js /send-document) also refuses when WhatsApp
// isn't linked or the number isn't on WhatsApp.
import { cs } from '@/lib/currency';
import { createElement } from 'react';
import { fetchCustomerOutstanding, sendWhatsappDocument, sendWhatsappMessage } from '@/lib/pos-api';
import { getStoreSettings } from '@/lib/pos-settings';
import type { SavedOrder } from '@/lib/pos-types';
import { formatAppointmentDate, formatSlot } from '@/lib/appointments';
import { accountBalanceLines } from '@/lib/order-receipt-print';

const WALKIN_PHONE = '03000000000';

// Same number rules as the backend (whatsappService.normalizePhone).
export function isValidWhatsappNumber(phone?: string | null) {
  const raw = String(phone || '').trim();
  const num = raw.replace(/\D/g, '');
  if (!num || num === WALKIN_PHONE) return false;
  if (raw.startsWith('+')) return num.length >= 8 && num.length <= 15;
  if (num.startsWith('00')) return num.length >= 10 && num.length <= 17;
  return (num.startsWith('0') && num.length === 11) || num.length === 10 || (num.startsWith('92') && num.length === 12) || (!num.startsWith('0') && num.length >= 11 && num.length <= 15);
}

export function slipPhoneProblem(order: Pick<SavedOrder, 'customer'>) {
  if (!isValidWhatsappNumber(order.customer?.phone)) {
    return `${order.customer?.name || 'This patient'} has no correct phone number - add a correct number first, then send again.`;
  }
  return null;
}

function money(value: number | undefined) {
  return `${cs()}${Math.round(Number(value) || 0).toLocaleString()}`;
}

function appointmentNo(order: SavedOrder) {
  return String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0');
}

function bookedWith(order: SavedOrder) {
  if (!order.doctorName) return null;
  return { label: /^dr\.?\s/i.test(order.doctorName) ? 'Dr' : 'Service', value: order.doctorName };
}

function fileSafe(text: string) {
  return text.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'patient';
}

export type SlipKind = 'booked' | 'completed';

// Short WhatsApp text that goes with the slip - like the online-ordering
// confirmation: booked -> confirmation, completed -> thanks + payment.
function slipMessage(order: SavedOrder, kind: SlipKind, previousDues: number, withPdf: boolean) {
  const clinic = getStoreSettings().receiptHeader || 'Clinic';
  const withWhom = bookedWith(order);
  if (kind === 'booked') return bookedMessage(order, clinic, withPdf);
  const lines = [`*${clinic}*`, ''];
  {
    lines.push(`Dear ${order.customer?.name || 'Patient'}, thank you for your visit. Your payment is received.`);
  }
  lines.push(`Appointment No: *${appointmentNo(order)}*`);
  if (withWhom) lines.push(`${withWhom.label}: ${withWhom.value}`);
  if (order.appointmentDate) lines.push(`Date: ${formatAppointmentDate(order.appointmentDate)}`);
  if (order.appointmentTime) lines.push(`Time: ${formatSlot(order.appointmentTime)}`);
  if (kind === 'completed') {
    // Exactly the PAID and REMAINING DUE the slip prints (same maths) -
    // the full payment breakdown is on the attached slip.
    const slip = accountBalanceLines(order, previousDues);
    const paidLine = slip.find((l) => l.label === 'PAID:');
    const balanceLine = slip.find((l) => /^(REMAINING DUE|ADVANCE BALANCE|BALANCE):$/.test(l.label));
    if (paidLine) lines.push(`Paid: *${paidLine.value}*`);
    if (balanceLine) {
      const label = balanceLine.label === 'REMAINING DUE:' ? 'Remaining due' : balanceLine.label === 'ADVANCE BALANCE:' ? 'Advance balance' : 'Balance';
      lines.push(`${label}: *${balanceLine.value.replace(/^-/, '')}*`);
    }
    if (withPdf) lines.push('', 'Full payment details are on the attached slip.');
  } else {
    lines.push('', `Please arrive 10 minutes before your time.${withPdf ? ' Your slip is attached.' : ''}`);
  }
  return lines.join('\n');
}

// Same message the patient gets when the clinic confirms an ONLINE booking
// (backend customerNotificationService) - so clinic and online bookings
// read the same. Booking = NO money talk (no prices, total or payment);
// payment is only mentioned on the "completed" message + slip.
function bookedMessage(order: SavedOrder, clinic: string, withPdf: boolean) {
  const settings = getStoreSettings();
  const withWhom = bookedWith(order);
  const services = (order.items || []).filter((item) => item.name !== order.doctorName);
  const lines: Array<string | null> = [
    '*Your appointment is confirmed* \u2705',
    `Hello ${order.customer?.name || 'there'},`,
    `${clinic} has confirmed your appointment.`,
    '',
    '*Appointment Details*',
    '------------------------',
    `Appointment No: ${order.dailyOrderNumber ?? appointmentNo(order)}`,
    withWhom ? `${withWhom.label}: ${withWhom.value}` : null,
    order.appointmentDate ? `Date: ${formatAppointmentDate(order.appointmentDate)}` : null,
    order.appointmentTime ? `Time: ${formatSlot(order.appointmentTime)}` : null,
    ...(services.length
      ? ['Services:', ...services.map((item) => `- ${item.name}${item.variation && item.variation !== 'Standard' ? ` (${item.variation})` : ''}`)]
      : []),
    '------------------------',
    `Please arrive 10 minutes before your time.${withPdf ? ' Your slip is attached.' : ''}`,
    settings.receiptContact ? String(settings.receiptContact) : null,
    settings.receiptAddress ? String(settings.receiptAddress) : null,
    clinic,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

// Appointment on WhatsApp: a confirmation text, then (on payment, or when
// sent by hand) the same slip the POS prints (receipt-pdf.tsx) as a PDF.
// Saving an appointment sends only the confirmation text.
export async function sendAppointmentSlip(order: SavedOrder, kind: SlipKind, options: { withPdf?: boolean } = {}) {
  const withPdf = options.withPdf ?? kind === 'completed';
  const problem = slipPhoneProblem(order);
  if (problem) throw new Error(problem);
  let previousDues = 0;
  try {
    const result = await fetchCustomerOutstanding(order.customer.phone, order.id);
    previousDues = Number(result?.outstanding ?? 0) || 0;
  } catch {
    // balance is extra - the slip still goes without it
  }
  const res = await sendWhatsappMessage(order.customer.phone, slipMessage(order, kind, previousDues, withPdf));
  if (res && res.success === false) throw new Error(res.error || 'WhatsApp message not sent.');
  if (!withPdf) return;
  const { orderReceiptPdfBase64 } = await import('@/lib/receipt-pdf');
  const base64 = await orderReceiptPdfBase64(order, previousDues);
  const sent = await sendWhatsappDocument(order.customer.phone, base64, `Appointment_${appointmentNo(order)}_${fileSafe(order.customer?.name || '')}.pdf`);
  if (sent && sent.success === false) throw new Error(sent.error || 'Slip PDF not sent.');
}

// The Dr's prescription (disease + medicine details) as a PDF.
export async function sendPrescriptionSlip(order: SavedOrder) {
  const problem = slipPhoneProblem(order);
  if (problem) throw new Error(problem);
  if (!order.prescription?.trim() && !order.diagnosis?.trim()) {
    throw new Error('Write the medicine details first, then send the prescription.');
  }
  // A4 prescription (same layout as the printed one).
  const { pdfDocumentToBase64 } = await import('@/lib/pdf-export');
  const { PrescriptionPdf } = await import('@/lib/prescription-pdf');
  const { bookingQrPng } = await import('@/lib/slip-extras');
  let images: string[] = [];
  if ((order.prescriptionImageCount || 0) > 0) {
    const { fetchPrescriptionImages } = await import('@/lib/pos-api');
    images = ((await fetchPrescriptionImages(order.id).catch(() => [])) || []).map((img) => img.data);
  }
  const { lookupWorkAs } = await import('@/lib/prescription-a4');
  const doc = createElement(PrescriptionPdf, { order, qr: await bookingQrPng(), images, workAs: await lookupWorkAs(order.doctorName) });
  const base64 = await pdfDocumentToBase64(doc);
  await sendWhatsappDocument(order.customer.phone, base64, `Prescription_${appointmentNo(order)}_${fileSafe(order.customer?.name || '')}.pdf`);
}
