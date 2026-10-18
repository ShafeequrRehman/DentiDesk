// Salary slip for one Payroll payment: printed on the receipt printer, or
// sent to the staff member on WhatsApp as a PDF.
import { createElement } from 'react';
import { sendWhatsappDocument } from '@/lib/pos-api';
import { buildReceiptShellHtml } from '@/lib/order-receipt-print';
import { isValidWhatsappNumber } from '@/lib/whatsapp-slips';
import type { StaffPayment } from '@/lib/shop-api';

export interface SalarySlipInfo {
  payment: StaffPayment;
  name: string;
  phone?: string;
  designation?: string;
  // The staff member's month at the time of printing.
  monthlySalary?: number;
  paidThisMonth?: number;
  remaining?: number;
}

function money(value: number | undefined) {
  return `$${Math.round(Number(value) || 0).toLocaleString()}`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TYPE_LABEL: Record<string, string> = { salary: 'Salary', advance: 'Advance', bonus: 'Bonus', deduction: 'Deduction' };

export function paidFromLabel(payment: Pick<StaffPayment, 'paymentSource' | 'bankName'>) {
  if (payment.paymentSource === 'cash') return 'Cash in Hand';
  if (payment.paymentSource === 'bank') return payment.bankName ? `Bank - ${payment.bankName}` : 'Bank';
  return '-';
}

function slipRows(info: SalarySlipInfo): Array<[string, string]> {
  const { payment } = info;
  const date = new Date(payment.date);
  return [
    ['Staff member', info.name],
    ...(info.designation ? [['Designation', info.designation] as [string, string]] : []),
    ['Month', date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })],
    ['Date', date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
    ['Type', TYPE_LABEL[payment.type] || payment.type],
    [payment.type === 'deduction' ? 'Amount deducted' : 'Amount paid', money(payment.amount)],
    [payment.type === 'deduction' ? 'Returned to' : 'Paid from', paidFromLabel(payment)],
    ...(payment.note ? [['Note', payment.note] as [string, string]] : []),
    ...(typeof info.monthlySalary === 'number' ? [['Monthly salary', money(info.monthlySalary)] as [string, string]] : []),
    ...(typeof info.paidThisMonth === 'number' ? [['Paid this month', money(info.paidThisMonth)] as [string, string]] : []),
    ...(typeof info.remaining === 'number'
      ? [[info.remaining < 0 ? 'Overpaid' : 'Remaining', money(Math.abs(info.remaining))] as [string, string]]
      : []),
  ];
}

export function printSalarySlip(info: SalarySlipInfo) {
  const printWindow = window.open('', '_blank', 'width=420,height=640');
  if (!printWindow) return false;
  const rows = slipRows(info)
    .map(([label, value]) => `<div class="row"><span>${escapeHtml(label)}</span><span style="text-align:right">${escapeHtml(value)}</span></div>`)
    .join('');
  const bodyHtml = `
    ${rows}
    <div class="dashed"></div>
    <div class="row bold"><span>${info.payment.type === 'deduction' ? 'DEDUCTED' : 'PAID'}</span><span>${money(info.payment.amount)}</span></div>
    <div class="dashed"></div>
    <p style="margin-top:28px">Received by: ____________________</p>
    <p style="margin-top:18px">Signature: ______________________</p>
  `;
  printWindow.document.open();
  printWindow.document.write(buildReceiptShellHtml(`${TYPE_LABEL[info.payment.type] || 'Salary'} Slip`, bodyHtml));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}

function fileSafe(text: string) {
  return text.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'staff';
}

export async function sendSalarySlipWhatsapp(info: SalarySlipInfo) {
  if (!isValidWhatsappNumber(info.phone)) {
    throw new Error(`${info.name} has no correct phone number - add it in Manage Staff first, then send again.`);
  }
  const { ReportPdfDocument, pdfDocumentToBase64 } = await import('@/lib/pdf-export');
  const { payment } = info;
  const doc = createElement(ReportPdfDocument, {
    title: `${TYPE_LABEL[payment.type] || 'Salary'} Slip`,
    subtitle: `${info.name} - ${new Date(payment.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    stats: [
      { label: payment.type === 'deduction' ? 'Deducted' : 'Paid', value: money(payment.amount) },
      { label: payment.type === 'deduction' ? 'Returned to' : 'Paid from', value: paidFromLabel(payment) },
      ...(typeof info.remaining === 'number' ? [{ label: info.remaining < 0 ? 'Overpaid' : 'Remaining', value: money(Math.abs(info.remaining)) }] : []),
    ],
    tables: [
      {
        title: 'Details',
        columns: [
          { label: 'Item', width: 1.2 },
          { label: 'Value', width: 1.6, align: 'right' as const },
        ],
        rows: slipRows(info),
        emptyMessage: '-',
      },
    ],
  });
  const base64 = await pdfDocumentToBase64(doc);
  await sendWhatsappDocument(info.phone || '', base64, `Salary_Slip_${fileSafe(info.name)}_${String(payment.date).slice(0, 10)}.pdf`);
}
