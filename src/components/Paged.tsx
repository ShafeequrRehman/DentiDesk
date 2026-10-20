// "Show 10, then Load more" for long lists (ledgers, histories, popups):
// only the first rows are drawn, so a list with hundreds of records stays
// fast. Wrap the .map: <Paged items={rows}>{(page) => page.map(...)}</Paged>.
// Inside a <tbody> the button comes as its own row (rows start with <tr>).
import { useState, type ReactNode } from 'react';
import { useLanguage } from '@/i18n';

export const PAGE_STEP = 10;

export function Paged<T>({ items, step = PAGE_STEP, colSpan, children }: { items: T[]; step?: number; colSpan?: number; children: (rows: T[]) => ReactNode }) {
  const { t } = useLanguage();
  const [count, setCount] = useState(step);
  const list = Array.isArray(items) ? items : [];
  const rows = list.length > count ? list.slice(0, count) : list;
  const remaining = list.length - rows.length;
  const button = remaining > 0 ? (
    <button
      type="button"
      onClick={() => setCount((c) => c + step)}
      className="rounded-full bg-white px-5 py-2 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
    >
      {t('dues.loadMore', { count: remaining })}
    </button>
  ) : null;
  return (
    <>
      {children(rows)}
      {button ? (
        colSpan ? (
          <tr>
            <td colSpan={colSpan} className="py-3 text-center">{button}</td>
          </tr>
        ) : (
          <div className="flex justify-center py-2">{button}</div>
        )
      ) : null}
    </>
  );
}
