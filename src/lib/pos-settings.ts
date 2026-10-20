import { getIpcRenderer } from './electron-bridge';
import { getAuthUser, getAuthShop } from './auth';

export type StoreSettings = {
  // Computed fresh from the current login session on every getStoreSettings()
  // call, NOT something a shop configures or that gets persisted to
  // localStorage/disk - added specifically so main.js's print handlers
  // (which only ever see whatever object is passed to
  // ipcRenderer.invoke(...), i.e. this one) can reliably tell which shop is
  // printing. businessEmail looked like the obvious field for this but
  // defaults to a placeholder ("admin@vanguard.io") that most shops never
  // touch, so a per-shop print-behavior check keyed on it silently never
  // matched. loginUsername/shopName instead mirror exactly what the person
  // actually typed to log in / their shop's registered name - both are
  // required at signup/login, so unlike businessEmail they can't be blank.
  loginUsername?: string;
  shopName?: string;
  businessEmail: string;
  currency: string;
  timezone: string;
  taxRate: number;
  dualScreenDisplay: boolean;
  autoPrintReceipts: boolean;
  kitchenPrinter?: string;
  counterPrinter?: string;
  businessStartTime: string;
  businessEndTime: string;
  receiptHeader?: string;
  receiptSubHeader?: string;
  receiptAddress?: string;
  receiptContact?: string;
  receiptPaymentInfo?: string;
  receiptFooterMessage?: string;
  // Patient slips (appointment, prescription, dues receipt): social links
  // printed under the slip, and the online-booking QR code.
  receiptFacebook?: string;
  receiptInstagram?: string;
  receiptTiktok?: string;
  receiptYoutube?: string;
  receiptWebsite?: string;
  receiptWhatsapp?: string;
  receiptShowBookingQr?: boolean;
  // Which printed layout to use for each receipt type - see
  // src/pages/dashboard/components/ReceiptRenderer.tsx for how these pick
  // between ThermalReceipt.tsx ("classic", the original template) and the
  // two newer ones modeled on real till printouts the shop provided
  // (ItemizedBillReceipt.tsx / KitchenKotReceipt.tsx).
  cashierReceiptTemplate?: 'classic' | 'itemizedBill';
  kitchenReceiptTemplate?: 'classic' | 'kot';
  // Only used by the "itemizedBill" cashier template's SC (Service Charge)
  // line - left at 0 (hidden) unless the shop sets one.
  serviceChargePercent?: number;
};

export const defaultSettings: StoreSettings = {
  businessEmail: "admin@vanguard.io",
  currency: "USD ($)",
  timezone: "Asia/Karachi",
  // No tax is added by default - the backend always computes tax as 0
  // unless a shop explicitly wants otherwise (see orderController.js's
  // recalculateTotals). This just keeps the POS cart's on-screen total in
  // sync with what actually gets charged.
  taxRate: 0,
  dualScreenDisplay: true,
  autoPrintReceipts: false,
  kitchenPrinter: "",
  counterPrinter: "",
  businessStartTime: "10:00",
  businessEndTime: "02:00",
  // Blank by default - the clinic fills these in once (Settings > Manage
  // Receipt) and they are saved for the whole clinic on the server, so
  // every laptop/phone prints the same slip. An empty header prints the
  // clinic's own name.
  receiptHeader: "",
  receiptSubHeader: "",
  receiptAddress: "",
  receiptContact: "",
  receiptPaymentInfo: "",
  receiptFooterMessage: "Thank You for your Appointment!",
  cashierReceiptTemplate: "classic",
  kitchenReceiptTemplate: "classic",
  serviceChargePercent: 0,
};

// Chromium's localStorage for this app's packaged, file://-loaded
// production build was not reliably surviving an app restart - printer
// selections (kitchenPrinter/counterPrinter) and other settings would
// silently reset every time the app reopened. Settings are mirrored to a
// real file in Electron's userData directory (see main.js's
// save-app-settings / load-app-settings-sync handlers), which - unlike
// browser storage - always survives restarts. This hydration runs once, as
// soon as this module is first imported (very early, before any page calls
// getStoreSettings()), overwriting localStorage with whatever was last
// saved to disk so the two can never drift apart across a restart.
(function hydrateSettingsFromDisk() {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return;
  try {
    const saved = ipcRenderer.sendSync('load-app-settings-sync');
    if (typeof saved === 'string' && saved) {
      localStorage.setItem('pos_store_settings', saved);
    }
  } catch (err) {
    console.error('Failed to hydrate settings from disk:', err);
  }
})();

export function getStoreSettings(): StoreSettings {
  if (typeof window === 'undefined') return defaultSettings;
  // Always computed fresh from the current session, never from whatever's
  // saved in the settings blob below - see the type's own comment for why.
  const sessionOverrides: Pick<StoreSettings, 'loginUsername' | 'shopName'> = {
    loginUsername: getAuthUser()?.username || getAuthUser()?.email || '',
    shopName: getAuthShop()?.name || '',
  };
  try {
    const saved = localStorage.getItem('pos_store_settings');
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<StoreSettings>;
      // The old built-in footer text - swap it for the clinic wording, but
      // leave any footer the clinic typed itself untouched.
      if (parsed.receiptFooterMessage === 'Thank You for your Order!') {
        parsed.receiptFooterMessage = defaultSettings.receiptFooterMessage;
      }
      // Never-edited copies of the old built-in sample receipt (another
      // business's name/address) - treat as empty.
      if (parsed.receiptHeader === 'The Heaven Slice') {
        const OLD_SAMPLE: Partial<StoreSettings> = { receiptSubHeader: 'Est. 2022', receiptAddress: 'Gojra Road Near Ali Merriage Hall', receiptContact: '0300-0310275', receiptPaymentInfo: '0307 - 4798089 Jazzcash/EasyPaisa' };
        parsed.receiptHeader = '';
        (Object.keys(OLD_SAMPLE) as Array<keyof StoreSettings>).forEach((key) => {
          if (parsed[key] === OLD_SAMPLE[key]) (parsed as Record<string, unknown>)[key] = '';
        });
      }
      const merged = { ...defaultSettings, ...parsed, ...sessionOverrides };
      if (!merged.receiptHeader) merged.receiptHeader = sessionOverrides.shopName || '';
      return merged;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  return { ...defaultSettings, receiptHeader: sessionOverrides.shopName || '', ...sessionOverrides };
}

export function saveStoreSettings(settings: StoreSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('pos_store_settings', JSON.stringify(settings));
    window.dispatchEvent(new Event('pos-settings-updated'));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }

  const ipcRenderer = getIpcRenderer();
  if (ipcRenderer) {
    Promise.resolve(ipcRenderer.invoke('save-app-settings', settings)).catch((err: unknown) => {
      console.error('Failed to persist settings to disk:', err);
    });
  }
}

export const TIMEZONES = [
  "Pacific/Midway", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Phoenix",
  "America/Denver", "America/Chicago", "America/New_York", "America/Halifax", "America/St_Johns",
  "America/Buenos_Aires", "America/Sao_Paulo", "Atlantic/South_Georgia", "Atlantic/Azores",
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Rome",
  "Africa/Cairo", "Africa/Johannesburg", "Europe/Kyiv", "Europe/Moscow", "Europe/Istanbul",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Jakarta", "Asia/Bangkok",
  "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul", 
  "Australia/Perth", "Australia/Sydney", "Australia/Melbourne", "Pacific/Noumea", "Pacific/Auckland"
];

export const CURRENCIES = [
  "PKR (₨)", "USD ($)", "EUR (€)", "GBP (£)", "AUD (A$)", "CAD (C$)", 
  "AED (د.إ)", "SAR (﷼)", "INR (₹)", "BDT (৳)", "JPY (¥)", "CNY (¥)", "SGD (S$)"
];
