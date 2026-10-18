// Expense slip (Reports > Log an Expense): printed on the receipt printer
// when an expense is logged, and again from the entries list.
import { buildReceiptShellHtml } from '@/lib/order-receipt-print';
import type { Expense } from '@/lib/pos-types';

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function expensePaidFrom(expense: Pick<Expense, 'paymentSource' | 'bankName'>) {
  if (expense.paymentSource === 'cash') return 'Cash in Hand';
  if (expense.paymentSource === 'bank') return expense.bankName ? `Bank - ${expense.bankName}` : 'Bank';
  return '-';
}

function slipHtml(expense: Expense) {
  const date = new Date(expense.date || Date.now());
  const row = (label: string, value: string) =>
    `<div class="row"><span>${escapeHtml(label)}</span><span style="text-align:right">${escapeHtml(value)}</span></div>`;
  const body = `
    ${row('Date', date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}
    ${row('Time', new Date(expense.createdAt || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}
    ${row('Category', expense.category)}
    ${row('Paid from', expensePaidFrom(expense))}
    ${expense.note ? `<div class="dashed"></div><p><b>NOTE:</b> ${escapeHtml(expense.note)}</p>` : ''}
    <div class="dashed"></div>
    <div class="row bold"><span>AMOUNT</span><span>$${Math.round(Number(expense.amount) || 0).toLocaleString()}</span></div>
    <div class="dashed"></div>
    <p style="margin-top:28px">Approved by: ____________________</p>
  `;
  return buildReceiptShellHtml('Expense Slip', body);
}

// Pass a window opened during the click (before any await) so the
// browser's popup blocker allows it.
export function printExpenseSlip(expense: Expense, target?: Window | null) {
  const printWindow = target && !target.closed ? target : window.open('', '_blank', 'width=420,height=640');
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(slipHtml(expense));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}
