// Set Medicine page.
//
// For every Dr and every Service, the clinic sets which medicines and
// disposables from Medicine Stock one appointment uses - e.g. a Dr's
// basic kit (gloves, mask, bib, cup, suction tip, cotton rolls) or a Root
// Canal's materials (LA cartridge, NaOCl 10 ml, GP points...). When an
// appointment is finished - the Dr marks the checkup done, or the
// appointment is completed - those amounts come off Medicine Stock
// automatically (backend: orderController.js's applyStockOnFinish ->
// stockService.js's deductStockForItems). A cancelled appointment gives
// them back.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FlaskConical, Info, PackagePlus, Plus, RefreshCcw, Save, Search, Sparkles, Stethoscope, Trash2 } from 'lucide-react';
import { createIngredient, fetchIngredients, fetchProducts, fetchRecipes, saveRecipeForProduct } from '@/lib/pos-api';
import { getRecipeUnitOptions, type Ingredient, type IngredientUnit, type Product, type Recipe } from '@/lib/pos-types';
import { resolveProductImage } from '@/lib/food-images';
import { isDoctorProduct } from '@/lib/appointments';
import { useToast } from '@/lib/toast';

type Tab = 'drs' | 'services';

interface DraftLine {
  key: string;
  ingredientId: string;
  quantity: string;
  unit: IngredientUnit;
}

interface TemplateLine {
  name: string;
  unit: IngredientUnit;
  quantity: number;
}

interface Template {
  id: string;
  label: string;
  hint: string;
  lines: TemplateLine[];
}

// Standard dental lists. Quantities are per appointment and can be changed
// after adding. Items missing from Medicine Stock are created there (with
// 0 stock) when a list is added.
const TEMPLATES: Template[] = [
  {
    id: 'basic',
    label: 'Basic Kit',
    hint: 'Used at every appointment - set it on each Dr',
    lines: [
      { name: 'Disposable Gloves (pair)', unit: 'pcs', quantity: 1 },
      { name: 'Face Mask', unit: 'pcs', quantity: 1 },
      { name: 'Patient Bib', unit: 'pcs', quantity: 1 },
      { name: 'Disposable Cup', unit: 'pcs', quantity: 1 },
      { name: 'Saliva Ejector Tip', unit: 'pcs', quantity: 1 },
      { name: 'Cotton Rolls', unit: 'pcs', quantity: 2 },
      { name: 'Gauze Pads', unit: 'pcs', quantity: 2 },
      { name: 'Three-Way Syringe Tip', unit: 'pcs', quantity: 1 },
    ],
  },
  {
    id: 'rct',
    label: 'Root Canal (RCT)',
    hint: 'Medicines, filling materials and files',
    lines: [
      { name: 'Local Anesthesia Cartridge', unit: 'pcs', quantity: 1 },
      { name: 'Disposable Syringe / Needle', unit: 'pcs', quantity: 1 },
      { name: 'Sodium Hypochlorite (NaOCl)', unit: 'ml', quantity: 10 },
      { name: 'EDTA Gel', unit: 'g', quantity: 1 },
      { name: 'Calcium Hydroxide Paste', unit: 'g', quantity: 1 },
      { name: 'Paper Points', unit: 'pcs', quantity: 4 },
      { name: 'Gutta Percha Points', unit: 'pcs', quantity: 3 },
      { name: 'Endodontic Sealer', unit: 'g', quantity: 0.5 },
      { name: 'Composite Filling', unit: 'g', quantity: 1 },
      // A file is thrown away after about 4 patients -> 1/4 per appointment.
      { name: 'Endo Files (K-Files)', unit: 'pcs', quantity: 0.25 },
    ],
  },
  {
    id: 'scaling',
    label: 'Scaling & Polishing',
    hint: 'Paste, cup and mouthwash',
    lines: [
      { name: 'Prophy Paste', unit: 'g', quantity: 3 },
      { name: 'Polishing Rubber Cup', unit: 'pcs', quantity: 1 },
      { name: 'Chlorhexidine Mouthwash', unit: 'ml', quantity: 15 },
    ],
  },
];

let lineCounter = 0;
function newKey() {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

function nameKey(name: string) {
  return name.trim().toLowerCase();
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

function linesFromRecipe(recipe: Recipe | undefined): DraftLine[] {
  return (recipe?.ingredients || []).map((line) => ({
    key: newKey(),
    ingredientId: String(line.ingredientId),
    quantity: formatQty(Number(line.quantity) || 0),
    unit: line.unit,
  }));
}

function productId(product: Product) {
  return String(product.id);
}

function productLabel(product: Product) {
  return product.variation && product.variation !== 'Standard' ? `${product.name} (${product.variation})` : product.name;
}

export default function MedicineSetupPage() {
  const { toast, confirm } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [tab, setTab] = useState<Tab>('drs');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchProducts(), fetchIngredients(), fetchRecipes()])
      .then(([catalog, stock, recipeList]) => {
        if (cancelled) return;
        setProducts((catalog?.products || []).filter((p) => !p.specialType));
        setIngredients((stock || []).filter((i) => i.isActive !== false));
        setRecipes(recipeList || []);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load Set Medicine.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const recipeByProduct = useMemo(() => {
    const map = new Map<string, Recipe>();
    recipes.forEach((recipe) => map.set(String(recipe.productId), recipe));
    return map;
  }, [recipes]);

  // Older Drs/Services got a Medicine Stock entry with their own name when
  // they were created - those aren't medicines, so they're left out here.
  const productNames = useMemo(() => new Set(products.map((p) => nameKey(p.name))), [products]);
  const medicineOptions = useMemo(
    () => ingredients.filter((i) => !productNames.has(nameKey(i.name))).sort((a, b) => a.name.localeCompare(b.name)),
    [ingredients, productNames],
  );
  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [String(i.id), i])), [ingredients]);

  const drs = useMemo(() => products.filter((p) => isDoctorProduct(p)), [products]);
  const services = useMemo(() => products.filter((p) => !isDoctorProduct(p)), [products]);
  const list = useMemo(() => {
    const source = tab === 'drs' ? drs : services;
    const q = search.trim().toLowerCase();
    return source
      .filter((p) => !q || productLabel(p).toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
      .sort((a, b) => productLabel(a).localeCompare(productLabel(b)));
  }, [tab, drs, services, search]);

  const selected = products.find((p) => productId(p) === selectedId) || null;
  const setCount = (tab === 'drs' ? drs : services).filter((p) => (recipeByProduct.get(productId(p))?.ingredients.length || 0) > 0).length;

  async function selectProduct(product: Product) {
    if (productId(product) === selectedId) return;
    if (dirty) {
      const leave = await confirm('You have unsaved changes for this Dr/Service. Leave without saving?', {
        title: 'Unsaved changes',
        confirmText: 'Leave',
        tone: 'danger',
      });
      if (!leave) return;
    }
    setSelectedId(productId(product));
    setLines(linesFromRecipe(recipeByProduct.get(productId(product))));
    setDirty(false);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((previous) => previous.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setDirty(true);
  }

  function addLine() {
    setLines((previous) => [...previous, { key: newKey(), ingredientId: '', quantity: '1', unit: 'pcs' }]);
    setDirty(true);
  }

  function removeLine(key: string) {
    setLines((previous) => previous.filter((line) => line.key !== key));
    setDirty(true);
  }

  function pickIngredient(key: string, ingredientId: string) {
    const ingredient = ingredientById.get(ingredientId);
    updateLine(key, { ingredientId, unit: ingredient ? ingredient.unit : 'pcs' });
  }

  async function applyTemplate(template: Template) {
    if (!selected) return;
    const byName = new Map(ingredients.map((i) => [nameKey(i.name), i]));
    const missing = template.lines.filter((line) => !byName.has(nameKey(line.name)));
    if (missing.length > 0) {
      const ok = await confirm(
        `${missing.length} of these are not in Medicine Stock yet: ${missing.map((m) => m.name).join(', ')}. Add them to Medicine Stock with 0 stock?`,
        { title: `Add ${template.label}`, confirmText: 'Add them' },
      );
      if (!ok) return;
    }
    setApplyingTemplate(template.id);
    try {
      const created: Ingredient[] = [];
      for (const line of missing) {
        const ingredient = await createIngredient({ name: line.name, unit: line.unit, currentStock: 0 });
        if (ingredient) {
          created.push(ingredient);
          byName.set(nameKey(ingredient.name), ingredient);
        }
      }
      if (created.length > 0) setIngredients((previous) => [...previous, ...created]);

      setLines((previous) => {
        const next = [...previous];
        for (const line of template.lines) {
          const ingredient = byName.get(nameKey(line.name));
          if (!ingredient) continue;
          const id = String(ingredient.id);
          const unit = getRecipeUnitOptions(ingredient.unit).includes(line.unit) ? line.unit : ingredient.unit;
          // Already on the list -> leave the amount the clinic set.
          if (next.some((existing) => existing.ingredientId === id)) continue;
          next.push({ key: newKey(), ingredientId: id, quantity: formatQty(line.quantity), unit });
        }
        return next;
      });
      setDirty(true);
      toast.success(
        created.length > 0
          ? `${template.label} added. ${created.length} new item${created.length === 1 ? '' : 's'} added to Medicine Stock with 0 stock - add their stock on the Medicine Stock page. Press Save to keep this list.`
          : `${template.label} added. Check the amounts, then press Save.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add this list.');
    } finally {
      setApplyingTemplate(null);
    }
  }

  async function handleSave() {
    if (!selected) return;
    const payload: Array<{ ingredientId: string; quantity: number; unit: IngredientUnit }> = [];
    for (const line of lines) {
      if (!line.ingredientId) {
        toast.error('Pick a medicine on every row, or remove the empty row.');
        return;
      }
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        const name = ingredientById.get(line.ingredientId)?.name || 'each medicine';
        toast.error(`Enter how much ${name} is used (more than 0).`);
        return;
      }
      payload.push({ ingredientId: line.ingredientId, quantity, unit: line.unit });
    }
    setSaving(true);
    try {
      const saved = await saveRecipeForProduct(productId(selected), payload);
      const id = productId(selected);
      setRecipes((previous) => {
        const rest = previous.filter((recipe) => String(recipe.productId) !== id);
        return saved && saved.ingredients.length > 0 ? [...rest, { ...saved, productId: id }] : rest;
      });
      if (saved) setLines(linesFromRecipe(saved));
      setDirty(false);
      toast.success(
        payload.length > 0
          ? `Saved. ${productLabel(selected)}'s medicines will come off Medicine Stock when each appointment is finished.`
          : `Saved. ${productLabel(selected)} no longer takes anything off Medicine Stock.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-gray-900">
            Set Medicine <FlaskConical className="text-[#00B0C7]" size={30} />
          </h1>
          <p className="font-bold text-gray-500">Which medicines and disposables each Dr and Service uses per appointment.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-gray-600 shadow-sm hover:bg-gray-50"
          >
            <RefreshCcw size={15} /> Refresh
          </button>
          <div className="flex gap-2 rounded-full bg-white p-1.5 shadow-sm">
            <button type="button" onClick={() => setTab('drs')} className={`rounded-full px-5 py-2 text-sm font-black ${tab === 'drs' ? 'bg-black text-white' : 'text-gray-500'}`}>
              Drs ({drs.length})
            </button>
            <button type="button" onClick={() => setTab('services')} className={`rounded-full px-5 py-2 text-sm font-black ${tab === 'services' ? 'bg-black text-white' : 'text-gray-500'}`}>
              Services ({services.length})
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-[24px] border border-[#00B0C7]/30 bg-[#EBFAFC] p-4 text-sm text-gray-700">
        <Info size={18} className="mt-0.5 shrink-0 text-[#009AAE]" />
        <p>
          These amounts come off <b>Medicine Stock</b> automatically when the Dr marks the <b>checkup done</b> on Drs &amp; Services. Booking or
          payment alone takes nothing off. <b>Uncheck</b> or cancelling the appointment puts everything back. A Dr&apos;s list and its Services&apos;
          lists are both taken off.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-[24px] bg-rose-50 p-4 text-sm font-bold text-rose-700">{loadError}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <div className="rounded-[28px] bg-white p-4 shadow-sm">
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'drs' ? 'Search Drs' : 'Search Services'}
              className="w-full rounded-2xl bg-gray-50 py-2.5 pl-9 pr-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#00B0C7]/40"
            />
          </div>
          <p className="mb-2 px-1 text-xs font-bold text-gray-400">
            {setCount} of {(tab === 'drs' ? drs : services).length} set
          </p>
          <div className="max-h-[calc(100vh-22rem)] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <p className="p-4 text-sm text-gray-400">Loading...</p>
            ) : list.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">
                {tab === 'drs'
                  ? 'No Drs yet. A Drs/Service counts as a Dr when its category is "Dr" or its name starts with "Dr."'
                  : 'No Services yet.'}
              </p>
            ) : (
              list.map((product) => {
                const count = recipeByProduct.get(productId(product))?.ingredients.length || 0;
                const active = productId(product) === selectedId;
                return (
                  <button
                    key={productId(product)}
                    type="button"
                    onClick={() => void selectProduct(product)}
                    className={`flex w-full items-center gap-3 rounded-[20px] p-2.5 text-left transition ${
                      active ? 'bg-[#EBFAFC] ring-2 ring-[#00B0C7]' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                      <img src={resolveProductImage(product)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-gray-900">{productLabel(product)}</p>
                      <p className="truncate text-[11px] font-semibold text-gray-400">{product.category}</p>
                    </div>
                    {count > 0 ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">{count} set</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700">Not set</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-[28px] bg-white p-5 shadow-sm sm:p-6">
          {!selected ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center text-gray-400">
              <Stethoscope size={48} strokeWidth={1.4} />
              <p className="font-bold text-gray-500">Pick a {tab === 'drs' ? 'Dr' : 'Service'} on the left</p>
              <p className="max-w-sm text-sm">Then add the medicines and disposables one appointment uses.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                    <img src={resolveProductImage(selected)} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-black text-gray-900">{productLabel(selected)}</h2>
                    <p className="text-xs font-bold text-gray-400">
                      Per appointment · {lines.length} item{lines.length === 1 ? '' : 's'}
                      {dirty ? <span className="ml-2 text-amber-600">Unsaved changes</span> : null}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={saving || !dirty}
                  onClick={() => void handleSave()}
                  className="flex items-center gap-2 rounded-full bg-[#00B0C7] px-6 py-3 text-sm font-black text-gray-900 shadow-sm transition hover:bg-[#009AAE] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <RefreshCcw size={16} className="animate-spin" /> : dirty ? <Save size={16} /> : <CheckCircle2 size={16} />}
                  {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
                </button>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">
                  <Sparkles size={13} /> Quick add a standard list
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      disabled={!!applyingTemplate}
                      onClick={() => void applyTemplate(template)}
                      className="rounded-[18px] border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-[#00B0C7]/50 hover:bg-[#EBFAFC] disabled:opacity-50"
                    >
                      <p className="flex items-center gap-1.5 text-sm font-black text-gray-900">
                        {applyingTemplate === template.id ? <RefreshCcw size={13} className="animate-spin" /> : <PackagePlus size={14} className="text-[#009AAE]" />}
                        {template.label}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-gray-500">{template.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {lines.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    Nothing set yet - this {tab === 'drs' ? 'Dr' : 'Service'} takes nothing off Medicine Stock. Add medicines below or quick add a list above.
                  </div>
                ) : (
                  <>
                    <div className="hidden grid-cols-[1fr_110px_90px_40px] gap-2 px-2 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400 sm:grid">
                      <span>Medicine / material</span>
                      <span>Amount</span>
                      <span>Unit</span>
                      <span />
                    </div>
                    {lines.map((line) => {
                      const ingredient = ingredientById.get(line.ingredientId);
                      const unitOptions = ingredient ? getRecipeUnitOptions(ingredient.unit) : [line.unit];
                      const lowStock = ingredient && Number(ingredient.currentStock) <= Number(ingredient.lowStockThreshold || 0);
                      return (
                        <div key={line.key} className="rounded-[20px] bg-gray-50 p-2.5">
                          <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_110px_90px_40px]">
                            <select
                              value={line.ingredientId}
                              onChange={(e) => pickIngredient(line.key, e.target.value)}
                              className="col-span-2 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-[#00B0C7]/40 sm:col-span-1"
                            >
                              <option value="">Pick a medicine...</option>
                              {medicineOptions.map((option) => (
                                <option
                                  key={option.id}
                                  value={option.id}
                                  disabled={option.id !== line.ingredientId && lines.some((other) => other.ingredientId === String(option.id))}
                                >
                                  {option.name} ({formatQty(Number(option.currentStock) || 0)} {option.unit} in stock)
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={line.quantity}
                              onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                              className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-[#00B0C7]/40"
                            />
                            <select
                              value={line.unit}
                              onChange={(e) => updateLine(line.key, { unit: e.target.value as IngredientUnit })}
                              disabled={unitOptions.length <= 1}
                              className="min-w-0 rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm font-bold text-gray-800 outline-none disabled:bg-gray-50"
                            >
                              {unitOptions.map((unit) => (
                                <option key={unit} value={unit}>{unit}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeLine(line.key)}
                              title="Remove"
                              className="flex items-center justify-center rounded-xl text-rose-500 hover:bg-rose-50"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          {ingredient ? (
                            <p className={`mt-1.5 px-1 text-[11px] font-semibold ${lowStock ? 'text-rose-600' : 'text-gray-400'}`}>
                              {formatQty(Number(ingredient.currentStock) || 0)} {ingredient.unit} in Medicine Stock
                              {lowStock ? ' - low, restock soon' : ''}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={addLine}
                  disabled={medicineOptions.length === 0}
                  className="flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-black text-white disabled:opacity-50"
                >
                  <Plus size={16} /> Add medicine
                </button>
                {medicineOptions.length === 0 ? (
                  <p className="text-xs font-bold text-gray-400">Medicine Stock is empty - add items there first, or quick add a list above.</p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
