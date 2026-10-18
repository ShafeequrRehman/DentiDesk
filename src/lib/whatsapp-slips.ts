// WhatsApp slips: the appointment slip (when an appointment is saved or
// completed) and the Dr's prescription, sent to the patient as a PDF.
//
// A patient without a correct phone number gets a clear "add a correct
// number first" error instead of a send that silently goes nowhere; the
// backend (whatsappRoutes.js /send-document) also refuses when WhatsApp
// isn't linked or the number isn't on WhatsApp.
import { cs } from '@/lib/currency';
import { createElement } from 'react';
import { sendWhatsappDocument } from '@/lib/pos-api';
import type { SavedOrder } from '@/lib/pos-types';
import { formatAppointmentDate, formatSlot } from '@/lib/appointments';

const WALKIN_PHONE = '03000000000';

// Same number rules as the backend (whatsappService.normalizePhone).
export function isValidWhatsappNumber(phone?: string | null) {
  const num = String(phone || '').replace(/\D/g, '');
  if (!num || num === WALKIN_PHONE) return false;
  return (num.startsWith('0') && num.length === 11) || num.length === 10 || (num.startsWith('92') && num.length === 12) || num.startsWith('0092');
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

// Appointment slip as a PDF, sent to the patient on WhatsApp.
export async function sendAppointmentSlip(order: SavedOrder, kind: SlipKind) {
  const problem = slipPhoneProblem(order);
  if (problem) throw new Error(problem);
  const { ReportPdfDocument, pdfDocumentToBase64 } = await import('@/lib/pdf-export');
  const withWhom = bookedWith(order);
  const remaining = typeof order.remainingAmount === 'number' ? order.remainingAmount : Math.max(Number(order.total || 0) - Number(order.paidAmount || 0), 0);
  const stats = [
    { label: 'Appointment No', value: `#${appointmentNo(order)}` },
    { label: 'Type', value: order.source === 'customer-qr' ? 'Online' : 'Clinic' },
    { label: 'Patient', value: order.customer?.name || 'Patient' },
    ...(withWhom ? [{ label: withWhom.label, value: withWhom.value }] : []),
    ...(order.appointmentDate ? [{ label: 'Date', value: formatAppointmentDate(order.appointmentDate) }] : []),
    ...(order.appointmentTime ? [{ label: 'Time', value: formatSlot(order.appointmentTime) }] : []),
    { label: 'Total', value: money(order.total) },
    { label: 'Paid', value: money(order.paidAmount) },
    { label: remaining > 0 ? 'Due' : 'Status', value: remaining > 0 ? money(remaining) : 'Fully paid' },
  ];
  const doc = createElement(ReportPdfDocument, {
    title: kind === 'completed' ? 'Appointment Slip - Completed' : 'Appointment Slip - Booked',
    subtitle: kind === 'completed' ? 'Thank you for your visit!' : 'Please arrive 10 minutes before your time.',
    stats,
    tables: [
      {
        title: 'Drs / Services',
        columns: [
          { label: 'Drs / Service', width: 2.4 },
          { label: 'Price', width: 1, align: 'right' as const },
        ],
        rows: (order.items || []).map((item) => [
          `${item.name}${item.variation && item.variation !== 'Standard' ? ` (${item.variation})` : ''}`,
          money(Number(item.price || 0) * Number(item.quantity || 1)),
        ]),
        footer: ['Total', money(order.total)],
        emptyMessage: 'No items.',
      },
    ],
  });
  const base64 = await pdfDocumentToBase64(doc);
  await sendWhatsappDocument(order.customer.phone, base64, `Appointment_${appointmentNo(order)}_${fileSafe(order.customer?.name || '')}.pdf`);
}

// The Dr's prescription (disease + medicine details) as a PDF.
export async function sendPrescriptionSlip(order: SavedOrder) {
  const problem = slipPhoneProblem(order);
  if (problem) throw new Error(problem);
  if (!order.prescription?.trim() && !order.diagnosis?.trim()) {
    throw new Error('Write the medicine details first, then send the prescription.');
  }
  const { ReportPdfDocument, pdfDocumentToBase64 } = await import('@/lib/pdf-export');
  const withWhom = bookedWith(order);
  const doc = createElement(ReportPdfDocument, {
    title: 'Prescription',
    subtitle: order.checkedAt ? `Checked ${new Date(order.checkedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : undefined,
    stats: [
      { label: 'Patient', value: order.customer?.name || 'Patient' },
      ...(withWhom ? [{ label: withWhom.label, value: withWhom.value }] : []),
      ...(order.appointmentDate ? [{ label: 'Date', value: `${formatAppointmentDate(order.appointmentDate)} ${formatSlot(order.appointmentTime)}` }] : []),
      ...(order.diagnosis ? [{ label: 'Disease', value: order.diagnosis }] : []),
    ],
    tables: [
      {
        title: 'Rx - Medicine details',
        columns: [{ label: 'Medicine / instructions', width: 1 }],
        rows: (order.prescription || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => [line]),
        emptyMessage: '-',
      },
    ],
  });
  const base64 = await pdfDocumentToBase64(doc);
  await sendWhatsappDocument(order.customer.phone, base64, `Prescription_${appointmentNo(order)}_${fileSafe(order.customer?.name || '')}.pdf`);
}
