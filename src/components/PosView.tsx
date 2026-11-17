import React, { useMemo, useRef, useState } from 'react';
import {
  Barcode,
  CheckCircle2,
  Minus,
  Plus,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { formatReadableError } from '../lib/firestoreError';
import { formatCurrency, formatNumber, getExpiryStatus } from '../lib/formatters';
import { createCustomerTx, createSaleTx } from '../services/accountingService';
import { PaymentMethod, Product, Sale } from '../types/accounting';
import { InvoiceModal } from './InvoiceModal';

interface CartItem {
  product: Product;
  quantity: number;
  unitSalePrice: number;
}

export function PosView() {
  const { userAccount } = useAuth();
  const { products, customers, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const [codeQuery, setCodeQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  // Quick Add Customer Modal
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [savingCust, setSavingCust] = useState(false);

  const codeInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = userAccount?.role === 'admin';
  const perms = userAccount?.permissions;
  const canEditPrices = Boolean(isAdmin || perms?.canEditPrices);
  const canDiscount = Boolean(isAdmin || perms?.canDiscount);
  const maxDiscountPct = isAdmin ? 100 : perms?.maxDiscountPercent || 0;

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.isActive && p.category) cats.add(p.category);
    });
    return ['all', ...Array.from(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products
      .filter((p) => p.isActive)
      .filter((p) => selectedCategory === 'all' || p.category === selectedCategory)
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
        );
      })
      .slice(0, 48);
  }, [products, searchQuery, selectedCategory]);

  const addToCart = (product: Product) => {
    setErrorMsg(null);
    if (product.quantity <= 0) {
      setErrorMsg(`الصنف (${product.name}) غير متوفر في المخزون حالياً.`);
      return;
    }
    setCart((prev) => {
      const existingIdx = prev.findIndex((c) => c.product.id === product.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        const nextQty = next[existingIdx].quantity + 1;
        if (nextQty > product.quantity) {
          setErrorMsg(`الكمية المتوفرة من (${product.name}) هي ${product.quantity} فقط.`);
          return prev;
        }
        next[existingIdx] = { ...next[existingIdx], quantity: nextQty };
        return next;
      }
      return [...prev, { product, quantity: 1, unitSalePrice: product.salePrice }];
    });
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = codeQuery.trim().toLowerCase();
    if (!raw) return;

    const match = products.find(
      (p) =>
        p.isActive &&
        (p.code.toLowerCase() === raw || (p.barcode && p.barcode.toLowerCase() === raw))
    );
    if (!match) {
      setErrorMsg(`لم يتم العثور على صنف بالكود أو الباركود: ${codeQuery}`);
      return;
    }
    addToCart(match);
    setCodeQuery('');
    codeInputRef.current?.focus();
  };

  const updateCartQty = (productId: string, nextQty: number) => {
    setErrorMsg(null);
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((c) => c.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) return c;
        if (nextQty > c.product.quantity) {
          setErrorMsg(`الكمية المتوفرة من (${c.product.name}) هي ${c.product.quantity} فقط.`);
          return c;
        }
        return { ...c, quantity: nextQty };
      })
    );
  };

  const updateCartPrice = (productId: string, nextPrice: number) => {
    if (!canEditPrices) return;
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId ? { ...c, unitSalePrice: Math.max(0, nextPrice) } : c
      )
    );
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitSalePrice * item.quantity, 0),
    [cart]
  );

  const clampedDiscountPct = canDiscount
    ? Math.min(maxDiscountPct, Math.max(0, discountPercent))
    : 0;
  const discountAmount = Math.round(((subtotal * clampedDiscountPct) / 100) * 100) / 100;
  const totalAmount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

  const effectivePaid =
    paymentMethod === 'cash'
      ? totalAmount
      : paymentMethod === 'credit'
        ? 0
        : Math.min(totalAmount, Math.max(0, Number(paidAmountInput) || 0));
  const remainingAmount = Math.max(0, Math.round((totalAmount - effectivePaid) * 100) / 100);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  const handleCreateQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !newCustName.trim()) return;
    setSavingCust(true);
    try {
      const created = await createCustomerTx(
        { name: newCustName, phone: newCustPhone, address: newCustAddress },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setSelectedCustomerId(created.id);
      setShowNewCustomer(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingCust(false);
    }
  };

  const handleCheckout = async () => {
    if (!userAccount) return;
    setErrorMsg(null);
    if (cart.length === 0) {
      setErrorMsg('السلة فارغة، يرجى إضافة أصناف للفاتورة.');
      return;
    }
    if (remainingAmount > 0 && !selectedCustomerId) {
      setErrorMsg('يرجى اختيار عميل مسجل أو تسجيل عميل جديد لإتمام البيع الآجل أو الجزئي.');
      return;
    }

    setSubmitting(true);
    try {
      const sale = await createSaleTx(
        {
          customerId: selectedCustomerId || undefined,
          customerName: selectedCustomer?.name || 'عميل نقدي',
          customerPhone: selectedCustomer?.phone,
          items: cart.map((c) => ({
            productId: c.product.id,
            quantity: c.quantity,
            unitSalePrice: c.unitSalePrice,
          })),
          discount: discountAmount,
          paymentMethod,
          paidAmount: effectivePaid,
          notes,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setCart([]);
      setDiscountPercent(0);
      setPaymentMethod('cash');
      setPaidAmountInput('');
      setNotes('');
      setCompletedSale(sale);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Right Column (RTL): Barcode & Product Catalog */}
      <div className="xl:col-span-7 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <form onSubmit={handleBarcodeSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Barcode className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                ref={codeInputRef}
                type="text"
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                placeholder="أدخل كود الصنف أو امسح الباركود ثم اضغط Enter للإضافة السريعة..."
                className="w-full pr-10 pl-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono-num"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              إضافة بالكود
            </button>
          </form>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث سريع باسم الصنف أو الكود..."
                className="w-full pr-10 pl-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            {categories.length > 1 && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cat === 'all' ? 'الكل' : cat}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Product Grid */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            لا توجد أصناف مطابقة للبحث. يمكنك إضافة الأصناف من قسم «الأصناف والأكواد».
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filteredProducts.map((product) => {
              const outOfStock = product.quantity <= 0;
              const lowStock = product.quantity > 0 && product.quantity <= product.minStock;
              const exp = getExpiryStatus(product.expiryDate);
              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => addToCart(product)}
                  className={`text-right bg-white border rounded-xl p-3.5 transition-colors flex flex-col justify-between gap-2 ${
                    outOfStock
                      ? 'border-slate-200 opacity-50 cursor-not-allowed'
                      : exp.status === 'expired'
                        ? 'border-rose-300 hover:border-rose-500 cursor-pointer'
                        : 'border-slate-200 hover:border-emerald-500 cursor-pointer'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1 text-xs font-mono-num text-slate-500">
                      <span>{product.code}</span>
                      {exp.status === 'expired' && (
                        <span className="text-[10px] font-sans font-semibold text-rose-700">
                          منتهي الصلاحية
                        </span>
                      )}
                      {exp.status === 'expiring_soon' && (
                        <span className="text-[10px] font-sans font-semibold text-amber-700">
                          قريب الانتهاء
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-sm text-slate-900 line-clamp-2">
                      {product.name}
                    </div>
                  </div>
                  <div className="flex items-end justify-between pt-2 border-t border-slate-100">
                    <div className="font-mono-num font-bold text-sm text-emerald-700">
                      {formatCurrency(product.salePrice, currency)}
                    </div>
                    <div
                      className={`text-xs font-mono-num ${
                        outOfStock
                          ? 'text-rose-600'
                          : lowStock
                            ? 'text-amber-700'
                            : 'text-slate-500'
                      }`}
                    >
                      {formatNumber(product.quantity)} {product.unit}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Left Column (RTL): Active Invoice / Cart */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden sticky top-20">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="font-bold text-slate-900">الفاتورة الحالية</h2>
          <span className="text-xs text-slate-500 font-mono-num">
            {cart.length} أصناف
          </span>
        </div>

        <div className="p-4 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          {/* Customer Selector */}
          <div className="flex items-center gap-2">
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="flex-1 py-2.5 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">عميل نقدي مباشر (بدون حساب)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}) {c.balanceDue > 0 ? `- عليه: ${c.balanceDue}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewCustomer(true)}
              title="تسجيل عميل جديد"
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <UserPlus className="w-4 h-4" />
            </button>
          </div>

          {/* Cart Items */}
          {cart.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
              اختر الأصناف من القائمة أو امسح الباركود لإضافتها هنا
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
              {cart.map((item) => (
                <div key={item.product.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {item.product.name}
                      </div>
                      <div className="text-xs font-mono-num text-slate-500">
                        {item.product.code} · المتوفر: {item.product.quantity}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateCartQty(item.product.id, 0)}
                      className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateCartQty(item.product.id, item.quantity - 1)}
                        className="w-7 h-7 flex items-center justify-center border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={item.product.quantity}
                        value={item.quantity}
                        onChange={(e) =>
                          updateCartQty(item.product.id, Number(e.target.value) || 0)
                        }
                        className="w-14 text-center py-1 text-xs font-mono-num border border-slate-200 rounded"
                      />
                      <button
                        type="button"
                        onClick={() => updateCartQty(item.product.id, item.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {canEditPrices ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.unitSalePrice}
                          onChange={(e) =>
                            updateCartPrice(item.product.id, Number(e.target.value) || 0)
                          }
                          className="w-20 text-left px-2 py-1 text-xs font-mono-num border border-slate-200 rounded"
                        />
                      ) : (
                        <span className="text-xs font-mono-num text-slate-500">
                          × {formatCurrency(item.unitSalePrice, currency)}
                        </span>
                      )}
                      <span className="text-sm font-bold font-mono-num text-slate-900 min-w-[80px] text-left">
                        {formatCurrency(item.unitSalePrice * item.quantity, currency)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Discount & Payment Method */}
          <div className="space-y-3 pt-2 border-t border-slate-200">
            {canDiscount && (
              <div className="flex items-center justify-between gap-3 text-xs">
                <label className="text-slate-600 font-medium">
                  نسبة الخصم % (الحد الأقصى {maxDiscountPct}%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={maxDiscountPct}
                  step="0.5"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value) || 0)}
                  className="w-24 px-2.5 py-1.5 border border-slate-300 rounded-lg text-left font-mono-num"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-600">طريقة الدفع</div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'cash', label: 'نقدي' },
                    { id: 'partial', label: 'دفع جزئي' },
                    { id: 'credit', label: 'آجل (دين)' },
                  ] as const
                ).map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => setPaymentMethod(pm.id)}
                    className={`py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      paymentMethod === pm.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === 'partial' && (
              <div className="flex items-center justify-between gap-3 text-xs">
                <label className="text-slate-600 font-medium">المبلغ المدفوع الآن</label>
                <input
                  type="number"
                  min={0}
                  max={totalAmount}
                  step="0.01"
                  value={paidAmountInput}
                  onChange={(e) => setPaidAmountInput(e.target.value)}
                  placeholder="0.00"
                  className="w-32 px-3 py-1.5 border border-slate-300 rounded-lg text-left font-mono-num"
                />
              </div>
            )}

            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات على الفاتورة (اختياري)..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
          </div>

          {/* Totals Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600 text-xs">
              <span>الإجمالي الفرعي</span>
              <span className="font-mono-num">{formatCurrency(subtotal, currency)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-amber-700 text-xs">
                <span>الخصم</span>
                <span className="font-mono-num">-{formatCurrency(discountAmount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base text-slate-900 pt-1 border-t border-slate-200">
              <span>الإجمالي المطلوب</span>
              <span className="font-mono-num">{formatCurrency(totalAmount, currency)}</span>
            </div>
            <div className="flex justify-between text-xs text-emerald-700">
              <span>المدفوع</span>
              <span className="font-mono-num font-semibold">
                {formatCurrency(effectivePaid, currency)}
              </span>
            </div>
            {remainingAmount > 0 && (
              <div className="flex justify-between text-xs text-rose-700">
                <span>المتبقي (آجل على العميل)</span>
                <span className="font-mono-num font-semibold">
                  {formatCurrency(remainingAmount, currency)}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={submitting || cart.length === 0}
            onClick={handleCheckout}
            className="w-full py-3.5 px-5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>{submitting ? 'جاري حفظ الفاتورة...' : 'اعتماد وإصدار الفاتورة'}</span>
          </button>
        </div>
      </div>

      {/* Quick Add Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">تسجيل عميل جديد سريع</h3>
              <button
                type="button"
                onClick={() => setShowNewCustomer(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateQuickCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingCust}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  {savingCust ? 'جاري الحفظ...' : 'حفظ العميل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {completedSale && (
        <InvoiceModal
          sale={completedSale}
          shopSettings={shopSettings}
          onClose={() => setCompletedSale(null)}
        />
      )}
    </div>
  );
}
