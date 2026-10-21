// Super Admin verify PIN: before ANY change on the Super Admin panel (new
// clinic, plan, suspend, license, owner password, settings...) a small box
// asks for the PIN; it goes to the server with that request only (the
// "x-admin-pin" header - checked by backend/middleware/requireAdminPin.js).
// Reads never ask. The PIN is never stored.
import { api } from '@/lib/api';

function askPin(message = 'Enter the Super Admin verify PIN to make this change.'): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px)';
    overlay.innerHTML = `
      <form style="width:100%;max-width:360px;background:#fff;border-radius:24px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:inherit">
        <p style="margin:0;font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:#6366f1">Verify</p>
        <h3 style="margin:4px 0 6px;font-size:20px;font-weight:900;color:#0f172a">Super Admin PIN</h3>
        <p data-msg style="margin:0 0 14px;font-size:13px;font-weight:600;color:#64748b"></p>
        <input data-pin type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN"
          style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:14px;padding:12px 14px;font-size:18px;font-weight:800;letter-spacing:.3em;outline:none" />
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" data-cancel style="flex:1;border:0;border-radius:14px;padding:12px;font-weight:900;background:#f1f5f9;color:#475569;cursor:pointer">Cancel</button>
          <button type="submit" style="flex:1;border:0;border-radius:14px;padding:12px;font-weight:900;background:#4f46e5;color:#fff;cursor:pointer">Verify</button>
        </div>
      </form>`;
    const form = overlay.querySelector('form') as HTMLFormElement;
    const input = overlay.querySelector('[data-pin]') as HTMLInputElement;
    (overlay.querySelector('[data-msg]') as HTMLElement).textContent = message;
    const done = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (input.value.trim()) done(input.value.trim());
    });
    (overlay.querySelector('[data-cancel]') as HTMLElement).addEventListener('click', () => done(null));
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') done(null);
    });
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 30);
  });
}

let installed = false;

// Called once by the Super Admin pages' API layer.
export function installAdminPinPrompt() {
  if (installed) return;
  installed = true;
  api.interceptors.request.use(async (config) => {
    const method = String(config.method || 'get').toLowerCase();
    const url = String(config.url || '');
    if (method === 'get' || !/^\/?superadmin\//.test(url.replace(/^https?:\/\/[^/]+(\/api)?/, ''))) return config;
    const pin = await askPin();
    if (!pin) return Promise.reject(new Error('Cancelled - the verify PIN is needed for this change.'));
    config.headers = config.headers || {};
    (config.headers as Record<string, string>)['x-admin-pin'] = pin;
    return config;
  });
}
