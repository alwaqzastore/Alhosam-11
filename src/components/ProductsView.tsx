import React, { useMemo, useState } from 'react';
import { Edit2, Plus, Search, X, AlertTriangle, Trash2, CalendarClock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { formatReadableError } from '../lib/firestoreError';
import { formatCurrency, formatNumber, getExpiryStatus } from '../lib/formatters';
import {
  createProductTx,
  deleteProductTx,
  updateProductTx,
} from '../services/accountingService';
import { Product } from '../types/accounting';

export function ProductsView() {
  const { userAccount } = useAuth();
  const { products, warehouses, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const isAdmin = userAccount?.role === 'admin';
  const canManageInventory = Boolean(isAdmin || userAccount?.permissions.canManageInventory);
  const canEditPrices = Boolean(isAdmin || userAccount?.permissions.canEditPrices);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'low' | 'out' | 'expiring'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [code, setCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [purchasePrice, setPurchasePrice] = useState('0');
  const [salePrice, setSalePrice] = useState('0');
  const [quantity, setQuantity] = useState('0');
  const [minStock, setMinStock] = useState(String(shopSettings?.lowStockDefault ?? 5));
  const [expiryDate, setExpiryDate] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const defaultWarehouse = warehouses.find((w) => w.isDefault) || warehouses[0];

  const expiringCount = useMemo(
    () =>
      products.filter((p) => {
        const s = getExpiryStatus(p.expiryDate).status;
        return s === 'expired' || s === 'expiring_soon';
      }).length,
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => {
        if (filterMode === 'low') return p.quantity > 0 && p.quantity <= p.minStock;
        if (filterMode === 'out') return p.quantity <= 0;
        if (filterMode === 'expiring') {
          const st = getExpiryStatus(p.expiryDate).status;
          return st === 'expired' || st === 'expiring_soon';
        }
        return true;
      })
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          (p.category && p.category.toLowerCase().includes(q)) ||
          (p.warehouseName && p.warehouseName.toLowerCase().includes(q))
        );
      });
  }, [products, search, filterMode]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setCode('');
    setBarcode('');
    setName('');
    setCategory('');
    setDescription('');
    setUnit('قطعة');
    setPurchasePrice('0');
    setSalePrice('0');
    setQuantity('0');
    setMinStock(String(shopSettings?.lowStockDefault ?? 5));
    setExpiryDate('');
    setWarehouseId(defaultWarehouse?.id || '');
    setIsActive(true);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setCode(p.code);
    setBarcode(p.barcode || '');
    setName(p.name);
    setCategory(p.category || '');
    setDescription(p.description || '');
    setUnit(p.unit);
    setPurchasePrice(String(p.purchasePrice));
    setSalePrice(String(p.salePrice));
    setQuantity(String(p.quantity));
    setMinStock(String(p.minStock));
    setExpiryDate(p.expiryDate || '');
    setWarehouseId(p.warehouseId || defaultWarehouse?.id || '');
    setIsActive(p.isActive);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      const actor = {
        uid: userAccount.uid,
        displayName: userAccount.displayName,
        role: userAccount.role,
      };
      const selectedWh = warehouses.find((w) => w.id === warehouseId);

      if (editingProduct) {
        await updateProductTx(
          editingProduct,
          {
            code: code.trim(),
            barcode: barcode.trim(),
            name: name.trim(),
            category: category.trim(),
            description: description.trim(),
            unit: unit.trim(),
            purchasePrice: canEditPrices
              ? Number(purchasePrice) || 0
              : editingProduct.purchasePrice,
            salePrice: canEditPrices ? Number(salePrice) || 0 : editingProduct.salePrice,
            minStock: Number(minStock) || 0,
            expiryDate: expiryDate.trim(),
            warehouseId: selectedWh?.id || warehouseId || undefined,
            warehouseName: selectedWh?.name || editingProduct.warehouseName,
            isActive,
          },
          actor
        );
      } else {
        await createProductTx(
          {
            code: code.trim() || undefined,
            barcode: barcode.trim(),
            name: name.trim(),
            category: category.trim(),
            description: description.trim(),
            unit: unit.trim(),
            purchasePrice: Number(purchasePrice) || 0,
            salePrice: Number(salePrice) || 0,
            quantity: Number(quantity) || 0,
            minStock: Number(minStock) || 0,
            expiryDate: expiryDate.trim() || undefined,
            warehouseId: selectedWh?.id || undefined,
            warehouseName: selectedWh?.name || 'المستودع الرئيسي',
            isActive,
          },
          actor
        );
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!userAccount || !deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await deleteProductTx(deleteTarget, {
        uid: userAccount.uid,
        displayName: userAccount.displayName,
        role: userAccount.role,
      });
      setDeleteTarget(null);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالكود، الباركود، اسم الصنف، أو المستودع..."
              className="w-full pr-10 pl-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: `الكل (${products.length})` },
                { id: 'low', label: 'منخفض' },
                { id: 'out', label: 'نافد' },
                { id: 'expiring', label: `الصلاحية (${expiringCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  filterMode === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {canManageInventory && (
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة منتج جديد</span>
          </button>
        )}
      </div>

      {errorMsg && !modalOpen && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
          {errorMsg}
        </div>
      )}

      {/* Products Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm text-slate-500">لا توجد منتجات مسجلة مطابقة للبحث.</p>
            {canManageInventory && products.length === 0 && (
              <button
                type="button"
                onClick={openCreateModal}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg"
              >
                إضافة أول منتج
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">الكود</th>
                  <th className="py-3 px-4 font-semibold">الباركود</th>
                  <th className="py-3 px-4 font-semibold">المنتج</th>
                  <th className="py-3 px-4 font-semibold">المستودع</th>
                  <th className="py-3 px-4 font-semibold">الصلاحية</th>
                  {isAdmin && <th className="py-3 px-4 font-semibold text-left">الشراء</th>}
                  <th className="py-3 px-4 font-semibold text-left">البيع</th>
                  <th className="py-3 px-4 font-semibold text-left">الصالح للبيع</th>
                  {(canManageInventory || isAdmin) && <th className="py-3 px-4 font-semibold">إجراء</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const isLow = p.quantity <= p.minStock;
                  const exp = getExpiryStatus(p.expiryDate);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono-num font-semibold text-slate-900">
                        {p.code}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-500">
                        {p.barcode || '—'}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        <div>{p.name}</div>
                        <div className="text-slate-400">
                          {p.category || 'عام'}
                          {(p.damagedQuantity || 0) > 0 && (
                            <span className="text-rose-600 font-semibold mr-2">
                              · تالف: {formatNumber(p.damagedQuantity || 0)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {p.warehouseName || 'المستودع الرئيسي'}
                      </td>
                      <td className="py-3 px-4 font-mono-num">
                        {p.expiryDate ? (
                          <div
                            className={`inline-flex items-center gap-1 font-medium ${
                              exp.status === 'expired'
                                ? 'text-rose-700 font-bold'
                                : exp.status === 'expiring_soon'
                                  ? 'text-amber-700 font-semibold'
                                  : 'text-slate-600'
                            }`}
                          >
                            {(exp.status === 'expired' || exp.status === 'expiring_soon') && (
                              <CalendarClock className="w-3.5 h-3.5" />
                            )}
                            <span>{p.expiryDate}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4 text-left font-mono-num text-slate-600">
                          {formatCurrency(p.purchasePrice, currency)}
                        </td>
                      )}
                      <td className="py-3 px-4 text-left font-mono-num font-semibold text-emerald-700">
                        {formatCurrency(p.salePrice, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            p.quantity === 0
                              ? 'text-rose-700'
                              : isLow
                                ? 'text-amber-700'
                                : 'text-slate-900'
                          }`}
                        >
                          {isLow && <AlertTriangle className="w-3.5 h-3.5" />}
                          {formatNumber(p.quantity)} {p.unit}
                        </span>
                      </td>
                      {(canManageInventory || isAdmin) && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            {canManageInventory && (
                              <button
                                type="button"
                                onClick={() => openEditModal(p)}
                                className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                                title="تعديل المنتج"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                                title="حذف المنتج"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Product Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                {editingProduct ? `تعديل المنتج (${editingProduct.code})` : 'إضافة منتج جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    كود الصنف (اتركه فارغاً للإنشاء التلقائي)
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="مثال: ITM-1001"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    الباركود (اختياري)
                  </label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="628100000000"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم الصنف *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: أرز بسمتي 5 كجم"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">التصنيف</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="مواد غذائية / مشروبات / منظفات..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الوحدة *</label>
                  <input
                    type="text"
                    required
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="قطعة / كرتون / كجم / علبة"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    تاريخ الصلاحية (للمواد الغذائية)
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    المستودع
                  </label>
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {warehouses.length === 0 && (
                      <option value="">المستودع الرئيسي</option>
                    )}
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">سعر الشراء *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    disabled={Boolean(editingProduct && !canEditPrices)}
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">سعر البيع *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    disabled={Boolean(editingProduct && !canEditPrices)}
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num disabled:bg-slate-100"
                  />
                </div>
                {!editingProduct && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">الكمية الحالية</label>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الحد الأدنى</label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الوصف</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span>المنتج نشط ومتاح للبيع</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 cursor-pointer"
                >
                  {saving ? 'جاري الحفظ...' : editingProduct ? 'حفظ التعديلات' : 'حفظ المنتج'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Product Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-900">تأكيد حذف المنتج</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              هل أنت متأكد من حذف الصنف <strong>{deleteTarget.name}</strong> ({deleteTarget.code})؟
              سيتم توثيق عملية الحذف في سجل التدقيق ولن تتأثر الفواتير السابقة.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg cursor-pointer"
              >
                {deleting ? 'جاري الحذف...' : 'حذف نهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
