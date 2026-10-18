// Per-clinic money sign and slip footer, set by the Super Admin (New /
// Edit Clinic): USD shows "$", PKR shows "Rs". The "Powered by" line goes
// under every slip; empty = nothing printed after the thank-you text.
//
// Filled from the login session, refreshed from the clinic profile on
// every dashboard load (DashboardShell) and from the public menu on the
// patients' page, and cached so it's right from the first paint.
import { getAuthShop } from '@/lib/auth';

export type CurrencyCode = 'USD' | 'PKR';

const CACHE_KEY = 'clinic_money';
const DEFAULT_POWERED_BY = 'www.sunrisereach.com';

interface MoneyState {
  currency: CurrencyCode;
  poweredBy: string;
}

let state: MoneyState | null = null;

function normalize(code?: string | null): CurrencyCode {
  return String(code || '').toUpperCase() === 'PKR' ? 'PKR' : 'USD';
}

function load(): MoneyState {
  if (state) return state;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && typeof cached === 'object') {
      state = { currency: normalize(cached.currency), poweredBy: typeof cached.poweredBy === 'string' ? cached.poweredBy : DEFAULT_POWERED_BY };
      return state;
    }
  } catch {
    // no storage
  }
  const shop = (() => {
    try {
      return getAuthShop();
    } catch {
      return null;
    }
  })();
  state = {
    currency: normalize(shop?.currency),
    poweredBy: typeof shop?.poweredBy === 'string' ? shop.poweredBy : DEFAULT_POWERED_BY,
  };
  return state;
}

// Returns true when something changed (so the caller can re-render).
export function setClinicMoney(currency?: string | null, poweredBy?: string | null, remember = true) {
  const before = load();
  const next: MoneyState = {
    currency: normalize(currency),
    poweredBy: typeof poweredBy === 'string' ? poweredBy : before.poweredBy,
  };
  const changed = next.currency !== before.currency || next.poweredBy !== before.poweredBy;
  state = next;
  if (remember) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return changed;
}

// "$" or "Rs " - put straight in front of a number.
export function cs() {
  return load().currency === 'PKR' ? 'Rs ' : '$';
}

// "USD" / "PKR" - for input placeholders and labels.
export function currencyCode(): CurrencyCode {
  return load().currency;
}

// Excel number format for money cells.
export function xlsxMoneyFormat() {
  return load().currency === 'PKR' ? '"Rs "#,##0.00' : '"$"#,##0.00';
}

// The slip footer line ("" = print nothing).
export function poweredByLine() {
  const text = load().poweredBy.trim();
  if (!text) return '';
  return /^powered by/i.test(text) ? text : `Powered by ${text}`;
}
