// Settings > Manage Receipt is saved for the whole CLINIC on the server
// (Shop.receiptSettings + Shop.printLogo), so a second laptop or phone that
// logs in prints exactly the same slips - no setting up again per device.
// Each device keeps a local copy (pos-settings / print-logo) for printing
// offline; this file keeps that copy in step with the server.
import { getStoreSettings, saveStoreSettings, type StoreSettings } from '@/lib/pos-settings';
import { PRINT_LOGO_STORAGE_KEY, persistPrintLogoToDisk } from '@/lib/print-logo';
import type { ShopProfile } from '@/lib/pos-api';

export const RECEIPT_KEYS = [
  'receiptHeader',
  'receiptSubHeader',
  'receiptAddress',
  'receiptContact',
  'receiptPaymentInfo',
  'receiptFooterMessage',
  'receiptFacebook',
  'receiptInstagram',
  'receiptTiktok',
  'receiptYoutube',
  'receiptWebsite',
  'receiptWhatsapp',
  'receiptShowBookingQr',
  'cashierReceiptTemplate',
  'serviceChargePercent',
] as const satisfies ReadonlyArray<keyof StoreSettings>;

export function receiptSettingsPayload(settings: StoreSettings = getStoreSettings()) {
  const out: Record<string, unknown> = {};
  RECEIPT_KEYS.forEach((key) => {
    out[key] = settings[key] ?? '';
  });
  return out;
}

export function localPrintLogo() {
  try {
    return window.localStorage.getItem(PRINT_LOGO_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setLocalLogo(logo: string) {
  try {
    if (logo) window.localStorage.setItem(PRINT_LOGO_STORAGE_KEY, logo);
    else window.localStorage.removeItem(PRINT_LOGO_STORAGE_KEY);
    persistPrintLogoToDisk(logo || null);
    window.dispatchEvent(new Event('print-logo-updated'));
  } catch {
    // storage blocked - printing just uses what it has
  }
}

// This device has a receipt someone actually filled in (not the blank
// default) - used once, to copy an already set-up laptop's receipt to the
// server for a clinic that never saved one there.
function hasLocalReceipt(settings: StoreSettings) {
  return Boolean(settings.receiptAddress || settings.receiptContact || settings.receiptSubHeader || localPrintLogo());
}

// Called with the clinic profile right after login / page load.
// Returns the payload to upload when the server has no receipt yet but this
// device does (first laptop seeds the server); otherwise null.
export function applyServerReceipt(profile: ShopProfile | undefined | null) {
  if (!profile) return null;
  const local = getStoreSettings();
  const server = profile.receiptSettings;
  if (server && typeof server === 'object') {
    const next = { ...local } as Record<string, unknown>;
    RECEIPT_KEYS.forEach((key) => {
      if (server[key] !== undefined) next[key] = server[key];
    });
    saveStoreSettings(next as StoreSettings);
    if ((profile.printLogo || '') !== localPrintLogo()) setLocalLogo(profile.printLogo || '');
    return null;
  }
  if (hasLocalReceipt(local)) {
    return { receiptSettings: receiptSettingsPayload(local), printLogo: localPrintLogo() };
  }
  return null;
}
