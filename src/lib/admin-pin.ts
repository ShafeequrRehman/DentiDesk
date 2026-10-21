// Super Admin verify PIN: before ANY change on the Super Admin panel (new
// clinic, plan, suspend, license, owner password, settings...) a small box
// asks for the PIN. The box checks it with the server first - a wrong PIN
// shows an error in the box; a right one closes it and the change goes
// through (the PIN rides along as the "x-admin-pin" header - checked by
// backend/middleware/requireAdminPin.js). Reads never ask. Not stored.
import { api } from '@/lib/api';

type PinCheck = (pin: string) => Promise<string | null>; // null = ok, else the error to show

function askPin(check: PinCheck): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px)';
    overlay.innerHTML = `
      <form style="width:100%;max-width:360px;background:#fff;border-radius:24px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:inherit">
        <p style="margin:0;font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:#6366f1">Verify</p>
        <h3 style="margin:4px 0 6px;font-size:20px;font-weight:900;color:#0f172a">Super Admin PIN</h3>
        <p style="margin:0 0 14px;font-size:13px;font-weight:600;color:#64748b">Enter the Super Admin verify PIN to make this change.</p>
        <input data-pin type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN"
          style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:14px;padding:12px 14px;font-size:18px;font-weight:800;letter-spacing:.3em;outline:none" />
        <p data-error style="display:none;margin:8px 0 0;font-size:13px;font-weight:800;color:#e11d48"></p>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" data-cancel style="flex:1;border:0;border-radius:14px;padding:12px;font-weight:900;background:#f1f5f9;color:#475569;cursor:pointer">Cancel</button>
          <button type="submit" data-ok style="flex:1;border:0;border-radius:14px;padding:12px;font-weight:900;background:#4f46e5;color:#fff;cursor:pointer">Verify</button>
        </div>
      </form>`;
    const form = overlay.querySelector('form') as HTMLFormElement;
    const input = overlay.querySelector('[data-pin]') as HTMLInputElement;
    const error = overlay.querySelector('[data-error]') as HTMLElement;
    const ok = overlay.querySelector('[data-ok]') as HTMLButtonElement;
    let busy = false;
    const done = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const pin = input.value.trim();
      if (!pin || busy) return;
      busy = true;
      ok.textContent = 'Checking...';
      ok.style.opacity = '.7';
      const problem = await check(pin);
      busy = false;
      ok.textContent = 'Verify';
      ok.style.opacity = '1';
      if (problem) {
        error.textContent = problem;
        error.style.display = 'block';
        input.style.borderColor = '#e11d48';
        input.select();
        return;
      }
      done(pin);
    });
    (overlay.querySelector('[data-cancel]') as HTMLElement).addEventListener('click', () => done(null));
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') done(null);
    });
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 30);
  });
}

// Asks the server whether this PIN is right (the verify-pin route).
async function checkWithServer(pin: string): Promise<string | null> {
  try {
    await api.post('/superadmin/verify-pin', {}, { headers: { 'x-admin-pin': pin } });
    return null;
  } catch (error) {
    const data = (error as { response?: { data?: { message?: string } } })?.response?.data;
    return data?.message || 'Could not check the PIN - check the connection and try again.';
  }
}

function setHeader(config: { headers?: unknown }, name: string, value: string) {
  const headers = config.headers as { set?: (k: string, v: string) => void } & Record<string, string>;
  if (headers && typeof headers.set === 'function') headers.set(name, value);
  else config.headers = { ...(headers || {}), [name]: value };
}

function hasHeader(config: { headers?: unknown }, name: string) {
  const headers = config.headers as { get?: (k: string) => unknown } & Record<string, unknown>;
  if (!headers) return false;
  return Boolean(typeof headers.get === 'function' ? headers.get(name) : headers[name]);
}

let installed = false;

// Called once by the Super Admin pages' API layer.
export function installAdminPinPrompt() {
  if (installed) return;
  installed = true;
  api.interceptors.request.use(async (config) => {
    const method = String(config.method || 'get').toLowerCase();
    const path = String(config.url || '').replace(/^https?:\/\/[^/]+(\/api)?/, '');
    if (method === 'get' || !/^\/?superadmin\//.test(path)) return config;
    // Already has the PIN (the verify call itself, or an automatic retry).
    if (hasHeader(config, 'x-admin-pin')) return config;
    const pin = await askPin(checkWithServer);
    if (!pin) return Promise.reject(new Error('Cancelled - the verify PIN is needed for this change.'));
    setHeader(config, 'x-admin-pin', pin);
    return config;
  });
}
