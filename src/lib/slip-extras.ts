// Extras printed on every PATIENT slip (appointment slip, prescription,
// dues receipt - never staff/supplier slips): the clinic's social links
// (Settings > Receipt) and a QR code that opens the online appointment
// page, with "For appointment please scan this".
import QRCode from 'qrcode';
import { getAuthShopId } from '@/lib/auth';
import { getShopOrderingUrl } from '@/lib/public-order-api';
import { getStoreSettings, type StoreSettings } from '@/lib/pos-settings';

export const BOOKING_QR_CAPTION = 'For appointment please scan this';

export const SOCIAL_FIELDS: Array<{ key: keyof StoreSettings; label: string; placeholder: string }> = [
  { key: 'receiptFacebook', label: 'Facebook', placeholder: 'facebook.com/yourclinic' },
  { key: 'receiptInstagram', label: 'Instagram', placeholder: 'instagram.com/yourclinic' },
  { key: 'receiptTiktok', label: 'TikTok', placeholder: 'tiktok.com/@yourclinic' },
  { key: 'receiptYoutube', label: 'YouTube', placeholder: 'youtube.com/@yourclinic' },
  { key: 'receiptWhatsapp', label: 'WhatsApp', placeholder: '0300 1234567' },
  { key: 'receiptWebsite', label: 'Website', placeholder: 'www.yourclinic.com' },
];

export function socialLinks(settings: StoreSettings = getStoreSettings()) {
  return SOCIAL_FIELDS.map((field) => ({ label: field.label, value: String(settings[field.key] ?? '').trim() })).filter((link) => link.value);
}

export function bookingUrl() {
  const shopId = getAuthShopId();
  return shopId ? getShopOrderingUrl(shopId) : '';
}

export function showBookingQr(settings: StoreSettings = getStoreSettings()) {
  return settings.receiptShowBookingQr !== false && Boolean(bookingUrl());
}

// QR as an SVG string - built synchronously, so slips that are written
// and printed in one go can include it.
export function qrSvg(text: string, size = 120) {
  if (!text) return '';
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const margin = 2;
  const total = count + margin * 2;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// PNG data URL of the booking QR (for the PDF slips).
export async function bookingQrPng() {
  const url = bookingUrl();
  if (!url || getStoreSettings().receiptShowBookingQr === false) return null;
  try {
    return await QRCode.toDataURL(url, { width: 240, margin: 1 });
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// HTML block for the printed 80mm slips.
export function patientSlipExtrasHtml() {
  const settings = getStoreSettings();
  const links = socialLinks(settings);
  const qr = showBookingQr(settings) ? qrSvg(bookingUrl(), 120) : '';
  if (!links.length && !qr) return '';
  return `
    <div class="dashed"></div>
    <div class="center" style="margin-top:6px">
      ${links.length ? `<p style="font-weight:800;margin-bottom:3px">FOLLOW US</p>${links.map((l) => `<p style="font-size:11px;word-break:break-all">${escapeHtml(l.label)}: ${escapeHtml(l.value)}</p>`).join('')}` : ''}
      ${qr ? `<div style="margin:8px auto 2px;width:120px;height:120px">${qr}</div><p style="font-weight:800;font-size:12px">${BOOKING_QR_CAPTION}</p>` : ''}
    </div>`;
}
