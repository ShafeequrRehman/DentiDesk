// The Dr's prescription on a full A4 page (letterhead style) - printed from
// Drs & Services. The WhatsApp PDF (prescription-pdf.tsx) has the same
// layout. Clinic header/logo/footer come from Settings > Receipt.
import type { SavedOrder } from '@/lib/pos-types';
import { getStoreSettings } from '@/lib/pos-settings';
import { PRINT_LOGO_STORAGE_KEY } from '@/lib/print-logo';
import { poweredByLine } from '@/lib/currency';
import { formatAppointmentDate, formatSlot } from '@/lib/appointments';
import { BOOKING_QR_CAPTION, CALL_CAPTION, PHONE_ICON_SVG, bookingUrl, callNumbers, qrSvg, showBookingQr, socialLinks } from '@/lib/slip-extras';

export function escapeHtml(value: string) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Everything the prescription shows, in one place (HTML + PDF use it).
export function prescriptionData(order: SavedOrder) {
  const isDr = /^dr\.?\s/i.test(order.doctorName || '');
  return {
    appointmentNo: String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0'),
    withLabel: isDr ? 'Dr' : 'Service',
    withName: order.doctorName || '',
    patient: order.customer?.name || 'Patient',
    phone: order.customer?.phone && order.customer.phone !== '03000000000' ? order.customer.phone : '',
    date: order.appointmentDate ? `${formatAppointmentDate(order.appointmentDate)}${order.appointmentTime ? ` · ${formatSlot(order.appointmentTime)}` : ''}` : new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    checked: order.checkedAt ? new Date(order.checkedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    services: (order.items || [])
      .filter((item) => item.name !== order.doctorName)
      .map((item) => `${item.name}${item.variation && item.variation !== 'Standard' ? ` (${item.variation})` : ''}`),
    diagnosis: (order.diagnosis || '').trim(),
    rxLines: (order.prescription || '').split('\n').map((line) => line.trim()).filter(Boolean),
  };
}

// images: pictures the Dr attached (data URLs) - printed under the medicines.
// workAs: the Dr's "Work As" lines (Manage Appointments) - degrees,
// speciality, PMDC no. - printed under the Dr's name.
export function buildPrescriptionA4Html(order: SavedOrder, images: string[] = [], workAs = '') {
  const settings = getStoreSettings();
  const data = prescriptionData(order);
  const logo = typeof window === 'undefined' ? null : window.localStorage.getItem(PRINT_LOGO_STORAGE_KEY);
  const links = socialLinks(settings);
  const qr = showBookingQr(settings) ? qrSvg(bookingUrl(), 110) : '';
  const call = callNumbers(settings);
  const contact = [settings.receiptAddress, settings.receiptContact].filter(Boolean).map((v) => escapeHtml(String(v)));
  const info = (label: string, value: string) => (value ? `<div class="info"><span>${label}</span><b>${escapeHtml(value)}</b></div>` : '');

  return `<!DOCTYPE html><html><head><title>Prescription ${data.appointmentNo}</title>
  <style>
    /* margin 0 = the browser prints no date/title/link at the page edges */
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111827; font-family: 'Segoe UI', Arial, sans-serif; }
    .page { width: 210mm; min-height: 285mm; padding: 14mm 14mm 10mm; display: flex; flex-direction: column; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding-bottom: 12px; border-bottom: 3px solid #0e7490; }
    .brand { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
    .brand img { max-height: 80px; max-width: 140px; object-fit: contain; }
    .clinic { font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: #0e7490; margin: 0; }
    .sub { font-size: 12px; color: #4b5563; margin: 2px 0 0; }
    /* Vertical separator between the clinic and the Dr */
    .doc { text-align: right; flex-shrink: 0; max-width: 42%; align-self: stretch; border-left: 2px solid #0e7490; padding-left: 16px; }
    .doc .label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #6b7280; }
    .doc .name { font-size: 22px; line-height: 1.1; font-weight: 800; color: #0f172a; }
    .doc .work { margin-top: 4px; font-size: 11.5px; line-height: 1.45; color: #374151; white-space: pre-line; }
    .doc .work b { color: #0e7490; }
    .doc .no { font-size: 11px; color: #6b7280; margin-top: 6px; }
    .patient { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0; padding: 10px 12px; background: #f0fdff; border: 1px solid #cffafe; border-radius: 10px; }
    .info span { display: block; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: #6b7280; }
    .info b { font-size: 13px; }
    .section { margin-top: 10px; }
    .section h3 { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #0e7490; margin: 0 0 4px; }
    .section p { margin: 2px 0; font-size: 13px; }
    .rx { flex: 1; margin-top: 16px; }
    .rx .sym { font-family: Georgia, 'Times New Roman', serif; font-size: 44px; font-weight: 700; color: #0e7490; line-height: 1; }
    .rx ol { margin: 10px 0 0 6px; padding-left: 20px; font-size: 15px; line-height: 1.9; }
    .attach { margin-top: 14px; }
    .attach h3 { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #0e7490; margin: 0 0 6px; }
    .attach .grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .attach img { max-width: calc(50% - 4px); max-height: 95mm; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 6px; page-break-inside: avoid; }
    .sign { display: flex; justify-content: flex-end; margin-top: 30px; }
    .sign div { width: 220px; border-top: 1px solid #111827; text-align: center; padding-top: 4px; font-size: 12px; color: #374151; }
    .foot { margin-top: 18px; padding-top: 10px; border-top: 1px dashed #9ca3af; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .foot .links p { margin: 1px 0; font-size: 11px; color: #374151; }
    .foot .links .t { font-weight: 800; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; }
    .qr { text-align: center; }
    .qr p { margin: 2px 0 0; font-size: 10px; font-weight: 700; }
    .bottom { text-align: center; margin-top: 8px; font-size: 11px; color: #6b7280; }
    .bottom b { color: #111827; }
  </style></head><body>
  <div class="page">
    <div class="head">
      <div class="brand">
        ${logo ? `<img src="${logo}" alt="" />` : ''}
        <div>
          <p class="clinic">${escapeHtml(settings.receiptHeader || 'Clinic')}</p>
          ${settings.receiptSubHeader ? `<p class="sub">${escapeHtml(settings.receiptSubHeader)}</p>` : ''}
          ${contact.length ? `<p class="sub">${contact.join(' · ')}</p>` : ''}
        </div>
      </div>
      <div class="doc">
        ${data.withLabel === 'Dr' ? '' : `<div class="label">${data.withLabel}</div>`}
        <div class="name">${escapeHtml(data.withName || '-')}</div>
        ${workAs.trim() ? `<div class="work">${workAsHtml(workAs)}</div>` : ''}
        <div class="no">Appointment #${data.appointmentNo}</div>
      </div>
    </div>

    <div class="patient">
      ${info('Patient', data.patient)}
      ${info('Phone', data.phone)}
      ${info('Date', data.date)}
      ${info('Checked', data.checked)}
    </div>

    ${data.services.length ? `<div class="section"><h3>Services</h3><p>${data.services.map(escapeHtml).join(', ')}</p></div>` : ''}
    ${data.diagnosis ? `<div class="section"><h3>Diagnosis / Disease</h3><p>${escapeHtml(data.diagnosis)}</p></div>` : ''}

    <div class="rx">
      <div class="sym">&#8478;</div>
      ${data.rxLines.length ? `<ol>${data.rxLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>` : '<p style="font-size:14px;color:#6b7280">-</p>'}
    </div>

    ${images.length ? `<div class="attach"><h3>Attachments</h3><div class="grid">${images.map((src) => `<img src="${src}" alt="" />`).join('')}</div></div>` : ''}

    <div class="sign"><div>Doctor's Signature</div></div>

    ${links.length || qr || call ? `<div class="foot">
      <div class="links">${links.length ? `<p class="t">Follow us</p>${links.map((l) => `<p>${escapeHtml(l.label)}: ${escapeHtml(l.value)}</p>`).join('')}` : ''}</div>
      ${qr || call ? `<div class="qr">${qr ? `${qr}<p>${BOOKING_QR_CAPTION}</p>` : ''}${call ? `<p style="margin-top:6px">${PHONE_ICON_SVG} ${CALL_CAPTION}</p><p style="font-weight:400">${escapeHtml(call)}</p>` : ''}</div>` : ''}
    </div>` : ''}
    <div class="bottom">
      ${settings.receiptFooterMessage ? `<b>${escapeHtml(settings.receiptFooterMessage)}</b><br/>` : ''}
      ${poweredByLine() ? escapeHtml(poweredByLine()) : ''}
    </div>
  </div>
  </body></html>`;
}

// "Work As" text -> safe HTML: line breaks kept, **bold** supported.
export function workAsHtml(text: string) {
  return escapeHtml(text.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// The Dr's "Work As" from the catalog (cached for a few minutes).
let workAsCache: { at: number; map: Map<string, string> } | null = null;
export async function lookupWorkAs(name?: string) {
  if (!name) return '';
  try {
    if (!workAsCache || Date.now() - workAsCache.at > 5 * 60 * 1000) {
      const { fetchProducts } = await import('@/lib/pos-api');
      const data = await fetchProducts();
      workAsCache = { at: Date.now(), map: new Map((data?.products || []).map((p) => [p.name, p.workAs || ''])) };
    }
    return workAsCache.map.get(name) || '';
  } catch {
    return '';
  }
}
