// Shared "print an order receipt straight into a plain window" builder -
// used by DuesPage.tsx's History "Print" button and RecordPage.tsx's row
// Print icon, so reprinting an old order's slip doesn't have to navigate
// to the full in-app Manual Print Center page (PrintOrderPage.tsx) in a
// brand new tab. That route works, but a fresh tab means the WHOLE app
// boots from scratch in it first (Redux store, auth, HashRouter, the
// "Starting POS System" splash) before the receipt itself ever renders -
// slow, and not what "click Print, get a slip" should feel like. This
// builds the same information directly as one plain HTML document
// (same document.write + window.print() technique already proven for the
// Dues Entry/Purchase receipts), so the print happens the instant the
// order's own data has loaded - no app boot involved.
//
// This is deliberately NOT a pixel-identical copy of ThermalReceipt.tsx
// (the POS's own live receipt component) - it's a simpler, static render
// of the same underlying fields for the "reprint an old order later"
// case, not the primary at-checkout receipt path (which keeps using
// ThermalReceipt/PrintOrderPage as before, unchanged).
import { cs, poweredByLine } from '@/lib/currency';
import { SavedOrder, DuesHistoryEntry } from '@/lib/pos-types';
import { getStoreSettings } from '@/lib/pos-settings';
import { PRINT_LOGO_STORAGE_KEY } from '@/lib/print-logo';
import { patientSlipExtrasHtml } from '@/lib/slip-extras';
import { fetchCustomerOutstanding } from '@/lib/pos-api';

const WALKIN_PHONE = '03000000000';

function money(value: number) {
  return `${cs()}${Math.round(Math.abs(value)).toLocaleString()}`;
}

// The bill for this slip, the way the clinic explains it to a patient:
//   fee - advance used (+ any old due) = total bill; paid; what's left
//   (remaining due) or the advance still left over.
// `other` = the rest of the patient's account right now, without this
// appointment (other appointments + older dues; negative = advance).
// order.advanceApplied / order.duesCollected come from the backend
// (advanceService.js / completeAndSettle).
export function accountBalanceLines(
  order: Pick<SavedOrder, 'remainingAmount' | 'customer' | 'total' | 'paidAmount' | 'advanceApplied' | 'duesCollected' | 'setoffApplied'>,
  other: number,
) {
  const realPatient = !!order.customer?.phone && order.customer.phone !== WALKIN_PHONE;
  const fee = Number(order.total || 0);
  const adv = Number(order.advanceApplied || 0);
  const setoff = Number(order.setoffApplied || 0);
  const remainingThis = Math.max(Number(order.remainingAmount || 0), 0);
  const otherNow = realPatient ? Number(other || 0) : 0;
  const collectedOthers = Number(order.duesCollected || 0);
  const prevBefore = otherNow + collectedOthers;
  const creditUsed = prevBefore < 0 ? Math.min(-prevBefore, remainingThis) : 0;
  const advanceShown = adv + creditUsed;
  const oldDue = Math.max(prevBefore, 0);
  const paidNow = Math.max(Number(order.paidAmount || 0) - adv - setoff, 0) + collectedOthers;
  const left = remainingThis + otherNow;

  const lines: Array<{ label: string; value: string; bold?: boolean }> = [];
  lines.push({ label: 'APPOINTMENT FEE:', value: money(fee) });
  if (advanceShown > 0) lines.push({ label: 'ADVANCE ADJUSTED:', value: `-${money(advanceShown)}` });
  // Settled against a purchase the clinic owed the patient - not paid now.
  if (setoff > 0) lines.push({ label: 'PURCHASE ADJUSTED:', value: `-${money(setoff)}` });
  if (oldDue > 0) lines.push({ label: 'PREVIOUS DUE:', value: money(oldDue) });
  lines.push({ label: 'TOTAL BILL:', value: money(fee - advanceShown - setoff + oldDue), bold: true });
  lines.push({ label: 'PAID:', value: money(paidNow) });
  if (left > 0) lines.push({ label: 'REMAINING DUE:', value: money(left), bold: true });
  else if (left < 0) lines.push({ label: 'ADVANCE BALANCE:', value: money(left), bold: true });
  else lines.push({ label: 'BALANCE:', value: 'CLEAR', bold: true });
  return lines;
}

function balanceHtml(order: SavedOrder, previousDues: number) {
  const lines = accountBalanceLines(order, previousDues);
  if (lines.length === 0) return '';
  return `<div class="dashed"></div>${lines
    .map((l) => `<div class="row${l.bold ? ' bold' : ''}"><span>${l.label}</span><span>${l.value}</span></div>`)
    .join('')}`;
}

// Same shop-header/bordered-title-block/footer shell DuesPage.tsx's own
// Dues Entry and Purchase receipts use (buildReceiptHtml there) - kept
// here too so an order receipt printed from either page looks like it
// belongs to the same till. `titleSub`, when given, renders as a large
// bold line under the title (e.g. the order number) - the same "ORDER
// NO. / 018" look the live Complete Order receipt already uses.
//
// Logo: same uploaded print logo (Settings > Receipt Management) and the
// same localStorage key (PRINT_LOGO_STORAGE_KEY) the live POS receipt
// (ThermalReceipt.tsx's cashier copy) already prints centered above the
// shop name - reading it directly here, rather than threading a logoSrc
// prop through every one of this shell's callers, so a Dues Entry/
// Purchase/reprinted-order slip built through this shared shell always
// matches the live checkout slip's branding without each caller having
// to remember to pass it.
// options.patient: a patient's slip - adds the clinic's social links and
// the online-booking QR (lib/slip-extras.ts) above the footer.
export function buildReceiptShellHtml(title: string, bodyHtml: string, titleSub?: string, options: { patient?: boolean } = {}) {
  const settings = getStoreSettings();
  const logoSrc = typeof window === 'undefined' ? null : window.localStorage.getItem(PRINT_LOGO_STORAGE_KEY);
  return `<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      @page { margin: 0; }
      html, body { width: 80mm; margin: 0; padding: 0; height: auto; min-height: 0; background: #fff; }
      .receipt { width: 70mm; margin: 0 auto; padding: 6px 8px 12px; box-sizing: border-box; font-family: 'Courier New', Courier, monospace; color: #000; font-size: 12px; line-height: 15px; }
      .receipt * { box-sizing: border-box; }
      .center { text-align: center; }
      .logo { max-height: 100px; width: auto; max-width: 220px; object-fit: contain; margin: 0 auto 6px; display: block; }
      .clinic-name { font-size: 18px; line-height: 20px; font-weight: 800; text-transform: uppercase; margin: 0 0 5px; }
      .title-block { border-top: 4px solid #000; border-bottom: 4px solid #000; padding: 8px 0; margin: 10px 0; text-align: center; }
      .title-block h2 { font-size: 16px; font-weight: 800; text-transform: uppercase; margin: 0; }
      .title-block .title-sub { font-size: 40px; line-height: 40px; font-weight: 900; margin-top: 4px; }
      .dashed { border-top: 1px dashed #000; margin: 8px 0; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      .row.bold { font-weight: 800; font-size: 13px; }
      p { margin: 2px 0; }
    </style>
    </head><body>
    <div class="receipt">
      <div class="center">
        ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="" />` : ''}
        <p class="clinic-name">${settings.receiptHeader || 'Store Name'}</p>
        ${settings.receiptSubHeader ? `<p>${settings.receiptSubHeader}</p>` : ''}
        ${settings.receiptAddress ? `<p>${settings.receiptAddress}</p>` : ''}
        ${settings.receiptContact ? `<p>${settings.receiptContact}</p>` : ''}
        ${settings.receiptPaymentInfo ? `<p>${settings.receiptPaymentInfo}</p>` : ''}
      </div>
      <div class="title-block"><h2>${title}</h2>${titleSub ? `<div class="title-sub">${titleSub}</div>` : ''}</div>
      ${bodyHtml}
      ${options.patient ? patientSlipExtrasHtml() : ''}
      <div class="center" style="margin-top:16px">
        ${settings.receiptFooterMessage ? `<p style="font-weight:800">${settings.receiptFooterMessage}</p>` : ''}
        ${poweredByLine() ? `<p>${poweredByLine()}</p>` : ''}
      </div>
    </div>
    </body></html>`;
}

// Same field set/order as ThermalReceipt.tsx's cashier copy (items,
// discount, total, paid/tendered/change) - see that component's own
// comments for why each one is computed the way it is; this mirrors it
// rather than re-deriving its own rules.
//
// Deliberately NOT showing any remaining/outstanding balance figure (no
// DUE, no arrears, no overall account balance) - the shop owner asked for
// this slip to show only the payment actually made against THIS bill
// (AMOUNT TENDERED / CASH TENDERED-RECEIVED / CHANGE RETURNED below),
// never a running total. See ThermalReceipt.tsx's matching comment - the
// live checkout receipt got the identical change for the same reason.
// "2026-10-16" + "15:30" -> "16 OCT 2026 · 3:30 PM" for the slip.
function appointmentSlotLabel(date?: string, time?: string) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return '';
  const [h, m] = time.split(':').map(Number);
  const timeText = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  let dateText = '';
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, mo, d] = date.split('-').map(Number);
    dateText = new Date(y, mo - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  return dateText ? `${dateText} · ${timeText}` : timeText;
}

// The payment mode picked at checkout (Cash / Card / E-Wallet / Bank).
function paymentModeLabel(order: SavedOrder) {
  const method = order.paymentMethod || 'Cash';
  if (method === 'Bank' && order.bankName) return `BANK (${order.bankName.toUpperCase()})`;
  return method.toUpperCase();
}

// The slip's content as plain lines - one source for the printed slip
// (HTML below) and the WhatsApp PDF (receipt-pdf.tsx), so both always
// look and read the same.
export type ReceiptLine =
  | { kind: 'text'; text: string; small?: boolean; indent?: boolean; spaceBefore?: boolean }
  | { kind: 'row'; left: string; right: string; bold?: boolean }
  | { kind: 'dashed' };

export function buildOrderReceiptLines(order: SavedOrder, previousDues = 0): ReceiptLine[] {
  const itemsTotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const billTotal = order.total ?? itemsTotal;
  const discountAmount = order.discount?.amount || 0;
  const amountTendered = order.paidAmount !== undefined ? Math.min(order.paidAmount, billTotal) : undefined;
  const cashReceived = order.cashReceived || 0;
  const changeReturned = Math.max(cashReceived - billTotal, 0);
  const date = order.createdAt ? new Date(order.createdAt) : null;
  const dateString = date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '--';
  const timeString = date ? date.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
  const hasRealCustomer = order.customer && order.customer.name && !['Walk-in Customer', 'Walk-in Patient'].includes(order.customer.name);
  const hasRealPhone = hasRealCustomer && order.customer.phone && order.customer.phone !== '03000000000';

  const lines: ReceiptLine[] = [];
  const text = (t: string, extra: Partial<{ small: boolean; indent: boolean; spaceBefore: boolean }> = {}) => lines.push({ kind: 'text', text: t, ...extra });
  const row = (left: string, right: string, bold = false) => lines.push({ kind: 'row', left, right, bold });
  text(`DATE: ${dateString}`);
  text(`TIME: ${timeString}`);
  if (order.appointmentTime) text(`APPOINTMENT: ${appointmentSlotLabel(order.appointmentDate, order.appointmentTime)}`);
  text(`TYPE: ${order.source === 'customer-qr' ? 'ONLINE' : 'CLINIC'}`);
  if (order.doctorName) text(`${/^dr\.?\s/i.test(order.doctorName) ? 'DR' : 'SERVICE'}: ${order.doctorName.toUpperCase()}`);
  if (hasRealCustomer) text(`PATIENT: ${order.customer.name.toUpperCase()}`);
  if (hasRealPhone) text(`PHONE: ${order.customer.phone}`);
  if (order.customer?.address) text(`ADDRESS: ${order.customer.address}`);
  if (order.billTid) text(`TID: ${order.billTid}`);
  if (order.billName) text(`BILL NAME: ${order.billName}`);
  if (order.cashRecipientName) text(`CASH GIVEN TO: ${order.cashRecipientName}`);
  lines.push({ kind: 'dashed' });
  text('Items:');
  order.items.forEach((item) => {
    row(`${item.quantity}x ${item.name.toUpperCase()} @ ${cs()}${item.price.toFixed(2)}`, `${cs()}${(item.price * item.quantity).toFixed(2)}`);
    if (item.variation) text(`- ${item.variation}`, { small: true, indent: true });
  });
  lines.push({ kind: 'dashed' });
  row('Items Total:', `${cs()}${itemsTotal.toFixed(2)}`);
  if (discountAmount > 0) row('Discount:', `-${cs()}${discountAmount.toFixed(2)}`);
  row('TOTAL:', `${cs()}${billTotal.toFixed(2)}`, true);
  text(`PAYMENT MODE: ${paymentModeLabel(order)}`, { spaceBefore: true });
  if (cashReceived > 0) {
    row('TOTAL BILL:', `${cs()}${billTotal.toFixed(2)}`, true);
    row('CASH TENDERED/RECEIVED:', `${cs()}${cashReceived.toFixed(2)}`);
    row('CHANGE RETURNED:', `${cs()}${changeReturned.toFixed(2)}`, true);
  } else if (amountTendered !== undefined) {
    text(`AMOUNT TENDERED: ${cs()}${amountTendered.toFixed(2)}`);
  }
  const balance = accountBalanceLines(order, previousDues);
  if (balance.length > 0) {
    lines.push({ kind: 'dashed' });
    balance.forEach((l) => row(l.label, l.value, !!l.bold));
  }
  return lines;
}

function escapeReceiptHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildOrderReceiptBodyHtml(order: SavedOrder, previousDues = 0) {
  return buildOrderReceiptLines(order, previousDues)
    .map((line) => {
      if (line.kind === 'dashed') return '<div class="dashed"></div>';
      if (line.kind === 'row') return `<div class="row${line.bold ? ' bold' : ''}"><span>${escapeReceiptHtml(line.left)}</span><span>${escapeReceiptHtml(line.right)}</span></div>`;
      const style = [line.small ? 'font-size:10px;color:#444' : '', line.indent ? 'margin-left:12px' : '', line.spaceBefore ? 'margin-top:8px' : ''].filter(Boolean).join(';');
      return `<p${style ? ` style="${style}"` : ''}>${escapeReceiptHtml(line.text)}</p>`;
    })
    .join('');
}

// Same shell/print technique, for a manual Dues Entry ("+ Paid Amount"/
// "- Received Amount"/"Clear") - pulled out of DuesPage.tsx so the
// auto-print that fires right after the API call succeeds (driven from
// DuesPage's own top-level handlers, which never unmount - see those
// handlers' own comment on why a per-card ref+effect wasn't reliable)
// and the manual "Print" button in History both render from one
// definition.
//
// Deliberately shows ONLY the payment itself - the amount and which
// method it moved through (Cash/Bank) - and never a
// balance total. This used to also print a "BALANCE AFTER" line (first
// entry.balanceAfter, the raw previousDues-only ledger figure, then
// later the customer's real netBalance once that mismatch was found and
// fixed) - the shop owner then asked for no balance figure here at all,
// only the transaction, so that line is gone entirely rather than fixed
// again.
// `balance` = the patient's total due after this entry (negative =
// advance) - printed under the payment.
export function writeDuesEntryReceiptToWindow(printWindow: Window, customerName: string, entry: DuesHistoryEntry, balance?: number) {
  const date = new Date(entry.createdAt).toLocaleString('en-PK', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  // Same "+ $X paid"/"- $X received" wording DuesPage.tsx's own
  // History row uses for this exact entry.type.
  const actionLabel = entry.type === 'add' ? 'PAID' : 'RECEIVED';
  const paymentMethodLabel = entry.paymentMethod === 'bank' && entry.bankName
    ? `Bank - ${entry.bankName}`
    : 'Cash';
  const bodyHtml = `
    <p>DATE: ${date}</p>
    <p>PATIENT: ${customerName.toUpperCase()}</p>
    <div class="dashed"></div>
    <div class="row bold"><span>${actionLabel}:</span><span>${cs()}${entry.amount}</span></div>
    <p>VIA: ${paymentMethodLabel}</p>
    <div class="dashed"></div>
    <p>NOTE: ${entry.note || 'No note'}</p>
    <p>BY: ${entry.createdBy || '—'}</p>
    ${typeof balance === 'number' ? `<div class="dashed"></div><div class="row bold"><span>${balance > 0 ? 'REMAINING DUE:' : balance < 0 ? 'ADVANCE BALANCE:' : 'BALANCE:'}</span><span>${balance === 0 ? 'CLEAR' : money(balance)}</span></div>` : ''}
  `;
  printWindow.document.open();
  printWindow.document.write(buildReceiptShellHtml('Dues Receipt', bodyHtml, undefined, { patient: true }));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

// Same shell/print technique, for an ingredient purchase batch (Log
// Purchase on the Stock page, or a reprint of one from Customer Dues'
// History) - a minimal duck-typed shape since callers pass either an
// IngredientPurchase or a LedgerPurchase, which already share every field
// this needs.
interface PurchaseReceiptData {
  purchaseOrderNumber: string;
  purchaseDate: string;
  status?: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  paidAmount?: number;
  remainingAmount?: number;
  totalAmount: number;
}

export function writePurchaseReceiptToWindow(printWindow: Window, purchase: PurchaseReceiptData, supplierName: string) {
  const purchaseDate = new Date(purchase.purchaseDate).toLocaleString('en-PK', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const bodyHtml = `
    <p>DATE: ${purchaseDate}</p>
    <p>ORDER NO: ${purchase.purchaseOrderNumber}</p>
    ${supplierName ? `<p>SUPPLIER: ${supplierName.toUpperCase()}</p>` : ''}
    ${purchase.status === 'cancelled' ? '<p style="font-weight:800">CANCELLED PURCHASE</p>' : ''}
    <div class="dashed"></div>
    <div class="row"><span>INGREDIENT:</span><span>${purchase.ingredientName}</span></div>
    <div class="row"><span>QUANTITY:</span><span>${purchase.quantity} ${purchase.unit}</span></div>
    <div class="row"><span>PAID:</span><span>${cs()}${purchase.paidAmount ?? 0}</span></div>
    <div class="dashed"></div>
    <div class="row bold"><span>TOTAL:</span><span>${cs()}${purchase.totalAmount}</span></div>
  `;
  printWindow.document.open();
  printWindow.document.write(buildReceiptShellHtml('Purchase Receipt', bodyHtml));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

// Writes a full order receipt into an already-open window and prints it.
// Callers open the window THEMSELVES, synchronously at click time (see
// each call site's own comment) so the popup blocker never gets a chance
// to kill it while the order/previousDues data is still being fetched.
//
// `_previousDues` is intentionally unused now - see
// buildOrderReceiptBodyHtml's own comment on why this slip no longer
// shows any balance figure. Kept as a parameter (not removed) purely so
// every existing call site (DuesPage.tsx/RecordPage.tsx/
// CompleteOrderModal.tsx, which still fetch it for other reasons) keeps
// working unchanged - only its name changed, to satisfy the unused-var
// lint rule.
// The patient's balance is looked up fresh (after the payment) so the
// slip shows the real due / advance; `previousDues` is the fallback when
// offline.
export function writeOrderReceiptToWindow(printWindow: Window, order: SavedOrder, previousDues: number) {
  const orderNumber = String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0');
  const write = (prev: number) => {
    if (printWindow.closed) return;
    const bodyHtml = buildOrderReceiptBodyHtml(order, prev);
    printWindow.document.open();
    printWindow.document.write(buildReceiptShellHtml('Appointment No.', bodyHtml, orderNumber, { patient: true }));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  const phone = order.customer?.phone;
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!phone || phone === WALKIN_PHONE || !online || !order.id || order.id.startsWith('local')) {
    write(previousDues || 0);
    return;
  }
  void fetchCustomerOutstanding(phone, order.id)
    .then((result) => write(typeof result?.outstanding === 'number' ? result.outstanding : previousDues || 0))
    .catch(() => write(previousDues || 0));
}
