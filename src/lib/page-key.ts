// Saving staff / role permission changes needs the clinic's Page Visibility
// Key (set by the Super Admin). The server answers 403 "page_key_required"
// when it is needed; this box then asks for the key, retries the save with
// it (the "x-page-key" header), shows "wrong key" in the box, and closes
// once the save goes through. Clinics with no key set never see the box.
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { api } from '@/lib/api';
import { askPin } from '@/lib/admin-pin';

const LABELS = {
  title: 'Page Visibility Key',
  text: 'Enter the Page Visibility Key (from your software provider) to save these permission changes.',
  placeholder: 'Key',
};

function reasonOf(error: unknown) {
  return (error as AxiosError<{ reason?: string; message?: string }>)?.response?.data?.reason;
}

let installed = false;

export function installPageKeyPrompt() {
  if (installed) return;
  installed = true;
  api.interceptors.response.use(undefined, async (error) => {
    const config = (error as AxiosError)?.config as (InternalAxiosRequestConfig & { _pageKeyAsked?: boolean }) | undefined;
    if (!config || config._pageKeyAsked || reasonOf(error) !== 'page_key_required') return Promise.reject(error);
    let result: AxiosResponse | null = null;
    let finalError: unknown = null;
    const key = await askPin(async (value) => {
      try {
        const headers = { ...(config.headers || {}), 'x-page-key': value } as unknown as InternalAxiosRequestConfig['headers'];
        result = await api.request({ ...config, headers, _pageKeyAsked: true } as InternalAxiosRequestConfig);
        return null;
      } catch (retryError) {
        const reason = reasonOf(retryError);
        if (reason === 'page_key_wrong' || reason === 'page_key_locked') {
          return (retryError as AxiosError<{ message?: string }>).response?.data?.message || 'Wrong key.';
        }
        finalError = retryError; // some other problem - close the box and show it on the page
        return null;
      }
    }, LABELS);
    if (!key) return Promise.reject(new Error('Cancelled - the Page Visibility Key is needed to save permission changes.'));
    if (result) return result;
    return Promise.reject(finalError || error);
  });
}
