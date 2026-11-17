import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Search,
  Trash2,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { formatReadableError } from '../lib/firestoreError';
import { formatCurrency, formatDateTime, formatNumber, getExpiryStatus } from '../lib/formatters';
import {
  adjustStockTx,
  createWarehouseTx,
  submitStocktakeTx,
  transferProductWarehouseTx,
  writeOffDamagedStockTx,
} from '../services/accountingService';
import { Product, StockMovementType } from '../types/accounting';

export function InventoryView() {
  const { userAccount } = useAuth();
  const { products, warehouses, stockMovements, stocktakes, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const [subTab, setSubTab] = useState<
    'overview' | 'warehouses' | 'expiry_damaged' | 'adjust' | 'stocktake' | 'movements'
  >('overview');
  const [codeFilter, setCodeFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');

  // New Warehouse Form
  const [whName, setWhName] = useState('');
  const [whCode, setWhCode] = useState('');
  const [whLocation, setWhLocation] = useState('');
  const [savingWh, setSavingWh] = useState(false);

  // Transfer Warehouse Form
  const [trProductId, setTrProductId] = useState('');
  const [trWarehouseId, setTrWarehouseId] = useState('');
  const [trNotes, setTrNotes] = useState('');
  const [savingTr, setSavingTr] = useState(false);

  // Manual Adjustment Form
  const [adjProductId, setAdjProductId] = useState('');
  const [adjDirection, setAdjDirection] = useState<'in' | 'out'>('in');
  const [adjQty, setAdjQty] = useState('1');
  const [adjReason, setAdjReason] = useState('');
  const [savingAdj, setSavingAdj] = useState(false);

  // Write-off Damaged Form
  const [writeOffTarget, setWriteOffTarget] = useState<Product | null>(null);
  const [writeOffQty, setWriteOffQty] = useState('1');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [savingWriteOff, setSavingWriteOff] = useState(false);

  // Stocktake Form
  const [actualQtys, setActualQtys] = useState<Record<string, string>>({});
  const [stocktakeReasons, setStocktakeReasons] = useState<Record<string, string>>({});
  const [stocktakeNotes, setStocktakeNotes] = useState('');
  const [savingStocktake, setSavingStocktake] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const actor = userAccount
    ? { uid: userAccount.uid, displayName: userAccount.displayName, role: userAccount.role }
    : null;

  const filteredOverviewProducts = useMemo(() => {
    if (warehouseFilter === 'all') return products;
    return products.filter(
      (p) => (p.warehouseId || 'WH_MAIN') === warehouseFilter
    );
  }, [products, warehouseFilter]);

  const expiryAlerts = useMemo(
    () =>
      products
        .map((p) => ({ product: p, exp: getExpiryStatus(p.expiryDate) }))
        .filter((item) => item.exp.status === 'expired' || item.exp.status === 'expiring_soon')
        .sort((a, b) => (a.exp.daysLeft ?? 999) - (b.exp.daysLeft ?? 999)),
    [products]
  );

  const damagedProducts = useMemo(
    () => products.filter((p) => (p.damagedQuantity || 0) > 0),
    [products]
  );

  const filteredMovements = useMemo(() => {
    const q = codeFilter.trim().toLowerCase();
    if (!q) return stockMovements;
    return stockMovements.filter(
      (m) =>
        m.productCode.toLowerCase().includes(q) ||
        m.productName.toLowerCase().includes(q) ||
        (m.referenceNumber && m.referenceNumber.toLowerCase().includes(q))
    );
  }, [stockMovements, codeFilter]);

  const movementLabel = (t: StockMovementType) => {
    switch (t) {
      case 'sale':
        return 'بيع';
      case 'purchase':
        return 'شراء';
      case 'return':
        return 'مرتجع مبيعات';
      case 'purchase_return':
        return 'مرتجع مشتريات';
      case 'adjustment_in':
        return 'وارد يدوي';
      case 'adjustment_out':
        return 'منصرف يدوي';
      case 'stocktake':
        return 'جرد فعلي';
      case 'opening':
        return 'رصيد افتتاحي';
      case 'warehouse_transfer':
        return 'نقل مستودع';
    }
  };

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingWh(true);
    try {
      const created = await createWarehouseTx(
        { name: whName, code: whCode || undefined, location: whLocation },
        actor
      );
      setSuccessMsg(`تمت إضافة المستودع "${created.name}" (${created.code}) بنجاح.`);
      setWhName('');
      setWhCode('');
      setWhLocation('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingWh(false);
    }
  };

  const handleTransferWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !trProductId || !trWarehouseId) return;
    const prod = products.find((p) => p.id === trProductId);
    const wh = warehouses.find((w) => w.id === trWarehouseId);
    if (!prod || !wh) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingTr(true);
    try {
      await transferProductWarehouseTx(prod, wh, trNotes, actor);
      setSuccessMsg(`تم نقل الصنف "${prod.name}" إلى مستودع "${wh.name}".`);
      setTrProductId('');
      setTrNotes('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingTr(false);
    }
  };

  const handleWriteOffDamaged = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !writeOffTarget) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingWriteOff(true);
    try {
      await writeOffDamagedStockTx(
        writeOffTarget,
        Number(writeOffQty) || 0,
        writeOffReason,
        actor
      );
      setSuccessMsg(`تم إعدام وشطب الكمية التالفة من (${writeOffTarget.name}) وترحيل الخسارة محاسبياً.`);
      setWriteOffTarget(null);
      setWriteOffQty('1');
      setWriteOffReason('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingWriteOff(false);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !adjProductId) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingAdj(true);
    try {
      await adjustStockTx(adjProductId, adjDirection, Number(adjQty) || 0, adjReason, actor);
      setSuccessMsg('تم تسجيل حركة المخزون وتحديث الرصيد والقيد المحاسبي بنجاح.');
      setAdjQty('1');
      setAdjReason('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingAdj(false);
    }
  };

  const handleStocktakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || products.length === 0) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingStocktake(true);
    try {
      const entries = products.map((p) => {
        const raw = actualQtys[p.id];
        const actual = raw === undefined || raw === '' ? p.quantity : Number(raw);
        return {
          productId: p.id,
          actualQty: Math.max(0, Number.isFinite(actual) ? actual : p.quantity),
          reason: stocktakeReasons[p.id] || '',
        };
      });
      const created = await submitStocktakeTx(entries, stocktakeNotes, actor);
      setSuccessMsg(`تم اعتماد الجرد الفعلي رقم ${created.stocktakeNumber} وتحديث الأرصدة.`);
      setActualQtys({});
      setStocktakeReasons({});
      setStocktakeNotes('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingStocktake(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setSubTab('overview')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            أرصدة المخزون ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('warehouses')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'warehouses' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            المستودعات ({warehouses.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('expiry_damaged')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'expiry_damaged' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            الصلاحية والتالف ({expiryAlerts.length + damagedProducts.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('adjust')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'adjust' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            وارد ومنصرف يدوي
          </button>
          <button
            type="button"
            onClick={() => setSubTab('stocktake')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'stocktake' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            الجرد الفعلي
          </button>
          <button
            type="button"
            onClick={() => setSubTab('movements')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'movements' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            سجل الحركة
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
          {successMsg}
        </div>
      )}

      {subTab === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
            <span className="text-xs font-semibold text-slate-700">تصفية حسب المستودع:</span>
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">جميع المستودعات</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">الكود</th>
                  <th className="py-3 px-4 font-semibold">الصنف</th>
                  <th className="py-3 px-4 font-semibold">المستودع</th>
                  <th className="py-3 px-4 font-semibold text-left">الصالح للبيع</th>
                  <th className="py-3 px-4 font-semibold text-left">التالف</th>
                  <th className="py-3 px-4 font-semibold text-left">قيمة المخزون</th>
                  <th className="py-3 px-4 font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOverviewProducts.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 px-4 font-mono-num font-semibold text-slate-800">
                      {p.code}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">{p.name}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {p.warehouseName || 'المستودع الرئيسي'}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num font-bold">
                      {formatNumber(p.quantity)} {p.unit}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num text-rose-700">
                      {formatNumber(p.damagedQuantity || 0)}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num">
                      {formatCurrency(p.quantity * p.purchasePrice, currency)}
                    </td>
                    <td className="py-3 px-4">
                      {p.quantity === 0 ? (
                        <span className="text-rose-700 font-semibold">نافد</span>
                      ) : p.quantity <= p.minStock ? (
                        <span className="text-amber-700 font-semibold">منخفض</span>
                      ) : (
                        <span className="text-emerald-700 font-medium">متوفر</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'warehouses' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900 flex items-center gap-2">
              <WarehouseIcon className="w-4 h-4 text-emerald-600" />
              <span>قائمة المستودعات والفروع المخزنية</span>
            </div>
            <div className="divide-y divide-slate-100">
              {warehouses.map((w) => {
                const count = products.filter((p) => (p.warehouseId || 'WH_MAIN') === w.id).length;
                const val = products
                  .filter((p) => (p.warehouseId || 'WH_MAIN') === w.id)
                  .reduce((s, p) => s + p.quantity * p.purchasePrice, 0);
                return (
                  <div key={w.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <div className="font-bold text-slate-900">
                        {w.name} <span className="font-mono-num text-slate-400">({w.code})</span>
                        {w.isDefault && (
                          <span className="mr-2 text-emerald-700 font-semibold">[رئيسي]</span>
                        )}
                      </div>
                      <div className="text-slate-500 mt-0.5">{w.location || 'بدون موقع محدد'}</div>
                    </div>
                    <div className="text-left">
                      <div className="font-mono-num font-bold text-slate-900">
                        {formatCurrency(val, currency)}
                      </div>
                      <div className="text-slate-500">{count} صنف مسجل</div>
                    </div>
                  </div>
                );
              })}
              {warehouses.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-500">لا توجد مستودعات بعد.</div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <form
              onSubmit={handleCreateWarehouse}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                <Plus className="w-4 h-4 text-emerald-600" />
                <span>إضافة مستودع جديد</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم المستودع *</label>
                <input
                  type="text"
                  required
                  value={whName}
                  onChange={(e) => setWhName(e.target.value)}
                  placeholder="مثال: مستودع المشروبات / المخزن الخلفي"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">كود (اختياري)</label>
                  <input
                    type="text"
                    value={whCode}
                    onChange={(e) => setWhCode(e.target.value)}
                    placeholder="WH-02"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الموقع</label>
                  <input
                    type="text"
                    value={whLocation}
                    onChange={(e) => setWhLocation(e.target.value)}
                    placeholder="الدور الأرضي..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingWh}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                {savingWh ? 'جاري الحفظ...' : 'حفظ المستودع'}
              </button>
            </form>

            <form
              onSubmit={handleTransferWarehouse}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
            >
              <div className="font-bold text-sm text-slate-900">نقل صنف إلى مستودع آخر</div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الصنف *</label>
                <select
                  required
                  value={trProductId}
                  onChange={(e) => setTrProductId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">اختر الصنف...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.code}] {p.name} ({p.warehouseName || 'المستودع الرئيسي'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">المستودع المستهدف *</label>
                <select
                  required
                  value={trWarehouseId}
                  onChange={(e) => setTrWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">اختر المستودع...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={trNotes}
                onChange={(e) => setTrNotes(e.target.value)}
                placeholder="سبب النقل أو ملاحظات..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                disabled={savingTr || warehouses.length === 0}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                {savingTr ? 'جاري النقل...' : 'تأكيد نقل المستودع'}
              </button>
            </form>
          </div>
        </div>
      )}

      {subTab === 'expiry_damaged' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Expiry Alerts */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber-600" />
              <span>تنبيهات انتهاء الصلاحية ({expiryAlerts.length})</span>
            </div>
            {expiryAlerts.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                لا توجد منتجات منتهية أو قريبة من انتهاء الصلاحية (خلال 30 يوماً).
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {expiryAlerts.map(({ product: p, exp }) => (
                  <div key={p.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {p.name} <span className="font-mono-num text-slate-400">({p.code})</span>
                      </div>
                      <div className="text-slate-500 mt-0.5 font-mono-num">
                        تاريخ الانتهاء: {p.expiryDate} · الكمية: {p.quantity} {p.unit}
                      </div>
                    </div>
                    <span
                      className={`font-bold ${
                        exp.status === 'expired' ? 'text-rose-700' : 'text-amber-700'
                      }`}
                    >
                      {exp.status === 'expired'
                        ? `منتهي منذ ${Math.abs(exp.daysLeft || 0)} يوم`
                        : `متبقي ${exp.daysLeft} يوم`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Damaged Inventory */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900">
              المخزون التالف (معزول عن المخزون القابل للبيع)
            </div>
            {damagedProducts.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                لا توجد كميات تالفة مسجلة حالياً.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {damagedProducts.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {p.name} <span className="font-mono-num text-slate-400">({p.code})</span>
                      </div>
                      <div className="text-rose-700 font-semibold mt-0.5 font-mono-num">
                        تالف: {formatNumber(p.damagedQuantity || 0)} {p.unit} · التكلفة:{' '}
                        {formatCurrency((p.damagedQuantity || 0) * p.purchasePrice, currency)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setWriteOffTarget(p);
                        setWriteOffQty(String(p.damagedQuantity || 1));
                        setWriteOffReason('إعدام بضاعة تالفة');
                      }}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>شطب وإعدام</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'adjust' && (
        <form
          onSubmit={handleAdjustSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-xl space-y-4"
        >
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <ArrowDownUp className="w-4 h-4 text-emerald-600" />
            <h3>تسجيل وارد أو منصرف يدوي (هدايا / تسوية / عجز)</h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">اختر الصنف *</label>
            <select
              required
              value={adjProductId}
              onChange={(e) => setAdjProductId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="">اختر الصنف...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.code}] {p.name} — الرصيد الحالي: {p.quantity}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">نوع الحركة</label>
              <select
                value={adjDirection}
                onChange={(e) => setAdjDirection(e.target.value as 'in' | 'out')}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="in">وارد (+) زيادة مخزون</option>
                <option value="out">منصرف (-) خصم مخزون</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الكمية *</label>
              <input
                type="number"
                required
                min={1}
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg font-mono-num"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">سبب التسوية *</label>
            <input
              type="text"
              required
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="مثال: بضاعة تالفة، عينة مجانية، تصحيح رصيد..."
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={savingAdj}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            {savingAdj ? 'جاري التنفيذ...' : 'اعتماد الحركة'}
          </button>
        </form>
      )}

      {subTab === 'stocktake' && (
        <div className="space-y-6">
          <form
            onSubmit={handleStocktakeSubmit}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-sm">
                  جلسة جرد فعلي ومطابقة الكميات
                </h3>
              </div>
              <button
                type="submit"
                disabled={savingStocktake || products.length === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{savingStocktake ? 'جاري الاعتماد...' : 'اعتماد نتائج الجرد'}</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4">الكود</th>
                    <th className="py-2.5 px-4">الصنف</th>
                    <th className="py-2.5 px-4 text-left">الكمية بالنظام</th>
                    <th className="py-2.5 px-4">الكمية الفعلية</th>
                    <th className="py-2.5 px-4 text-left">الفرق</th>
                    <th className="py-2.5 px-4">سبب الزيادة / العجز</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => {
                    const actualVal =
                      actualQtys[p.id] === undefined || actualQtys[p.id] === ''
                        ? p.quantity
                        : Number(actualQtys[p.id]);
                    const variance = actualVal - p.quantity;
                    return (
                      <tr key={p.id}>
                        <td className="py-2.5 px-4 font-mono-num text-slate-600">{p.code}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{p.name}</td>
                        <td className="py-2.5 px-4 text-left font-mono-num">{p.quantity}</td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min={0}
                            placeholder={String(p.quantity)}
                            value={actualQtys[p.id] ?? ''}
                            onChange={(e) =>
                              setActualQtys((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            className="w-24 px-2 py-1 border border-slate-300 rounded font-mono-num"
                          />
                        </td>
                        <td
                          className={`py-2.5 px-4 text-left font-mono-num font-bold ${
                            variance > 0
                              ? 'text-emerald-700'
                              : variance < 0
                                ? 'text-rose-700'
                                : 'text-slate-400'
                          }`}
                        >
                          {variance > 0 ? `+${variance}` : variance}
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="text"
                            value={stocktakeReasons[p.id] || ''}
                            onChange={(e) =>
                              setStocktakeReasons((prev) => ({
                                ...prev,
                                [p.id]: e.target.value,
                              }))
                            }
                            placeholder={variance !== 0 ? 'اذكر السبب...' : 'مطابق'}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-200">
              <input
                type="text"
                value={stocktakeNotes}
                onChange={(e) => setStocktakeNotes(e.target.value)}
                placeholder="ملاحظات عامة على جلسة الجرد..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </form>

          {stocktakes.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
                سجل جلسات الجرد السابقة
              </div>
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">رقم الجرد</th>
                    <th className="py-2.5 px-4">الموظف</th>
                    <th className="py-2.5 px-4 text-left">الأصناف</th>
                    <th className="py-2.5 px-4 text-left">قيمة الفروقات</th>
                    <th className="py-2.5 px-4">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stocktakes.map((st) => (
                    <tr key={st.id}>
                      <td className="py-2.5 px-4 font-mono-num font-semibold">
                        {st.stocktakeNumber}
                      </td>
                      <td className="py-2.5 px-4">{st.employeeName}</td>
                      <td className="py-2.5 px-4 text-left font-mono-num">{st.items.length}</td>
                      <td className="py-2.5 px-4 text-left font-mono-num font-semibold">
                        {formatCurrency(st.totalVarianceValue, currency)}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-500">
                        {formatDateTime(st.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'movements' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={codeFilter}
                onChange={(e) => setCodeFilter(e.target.value)}
                placeholder="تتبع حركة صنف محدد بالكود أو الاسم أو رقم الفاتورة..."
                className="w-full pr-10 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">التاريخ</th>
                  <th className="py-2.5 px-4">كود الصنف</th>
                  <th className="py-2.5 px-4">الصنف</th>
                  <th className="py-2.5 px-4">النوع</th>
                  <th className="py-2.5 px-4 text-left">التغير</th>
                  <th className="py-2.5 px-4 text-left">السابق</th>
                  <th className="py-2.5 px-4 text-left">الجديد</th>
                  <th className="py-2.5 px-4">المرجع / السبب</th>
                  <th className="py-2.5 px-4">الموظف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                      {formatDateTime(m.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-800">
                      {m.productCode}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{m.productName}</td>
                    <td className="py-2.5 px-4">{movementLabel(m.type)}</td>
                    <td
                      className={`py-2.5 px-4 text-left font-mono-num font-bold ${
                        m.quantityChange >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
                    </td>
                    <td className="py-2.5 px-4 text-left font-mono-num text-slate-500">
                      {m.previousQty}
                    </td>
                    <td className="py-2.5 px-4 text-left font-mono-num font-semibold">
                      {m.newQty}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate">
                      {m.referenceNumber ? `${m.referenceNumber} · ` : ''}
                      {m.reason || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{m.employeeName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Write Off Damaged Modal */}
      {writeOffTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-900">
              شطب وإعدام بضاعة تالفة — {writeOffTarget.name}
            </h3>
            <form onSubmit={handleWriteOffDamaged} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  الكمية المراد إعدامها (المسجل تالفاً: {writeOffTarget.damagedQuantity || 0})
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={writeOffTarget.damagedQuantity || 1}
                  value={writeOffQty}
                  onChange={(e) => setWriteOffQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">السبب *</label>
                <input
                  type="text"
                  required
                  value={writeOffReason}
                  onChange={(e) => setWriteOffReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWriteOffTarget(null)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingWriteOff}
                  className="px-4 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg cursor-pointer"
                >
                  {savingWriteOff ? 'جاري التنفيذ...' : 'اعتماد الشطب والخسارة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
