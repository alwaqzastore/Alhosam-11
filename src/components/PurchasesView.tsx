import React, { useMemo, useState } from 'react';
import { FileText, Plus, Search, Trash2, Wallet, X, Printer, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { triggerPrint } from '../lib/exportUtils';
import { formatReadableError } from '../lib/firestoreError';
import { formatCurrency, formatDateTime } from '../lib/formatters';
import {
  createPurchaseReturnTx,
  createPurchaseTx,
  createSupplierTx,
  createVoucherTx,
} from '../services/accountingService';
import { PaymentMethod, Purchase, Supplier } from '../types/accounting';

interface PurchaseDraftItem {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitCost: number;
}

export function PurchasesView() {
  const { userAccount } = useAuth();
  const { products, suppliers, purchases, purchaseReturns, vouchers, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const [subTab, setSubTab] = useState<'new' | 'history' | 'returns' | 'suppliers'>('new');
  const [supplierId, setSupplierId] = useState('');
  const [productLookup, setProductLookup] = useState('');
  const [draftItems, setDraftItems] = useState<PurchaseDraftItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  const [notes, setNotes] = useState('');
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Supplier Modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [savingSup, setSavingSup] = useState(false);

  // Pay Supplier Modal
  const [paySupplier, setPaySupplier] = useState<Supplier | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payingSup, setPayingSup] = useState(false);

  // Statement / Purchase Detail / Purchase Return Modals
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);
  const [viewPurchase, setViewPurchase] = useState<Purchase | null>(null);
  const [returnPurchase, setReturnPurchase] = useState<Purchase | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [fromDamagedFlags, setFromDamagedFlags] = useState<Record<string, boolean>>({});
  const [returnReason, setReturnReason] = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const matchingProducts = useMemo(() => {
    const q = productLookup.trim().toLowerCase();
    if (!q) return products.slice(0, 12);
    return products
      .filter(
        (p) =>
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [products, productLookup]);

  const addDraftProduct = (productId: string) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    setDraftItems((prev) => {
      if (prev.some((i) => i.productId === prod.id)) {
        return prev.map((i) =>
          i.productId === prod.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          quantity: 1,
          unitCost: prod.purchasePrice,
        },
      ];
    });
  };

  const totalPurchaseAmount = useMemo(
    () => draftItems.reduce((sum, i) => sum + i.quantity * i.unitCost, 0),
    [draftItems]
  );

  const effectivePaid =
    paymentMethod === 'cash'
      ? totalPurchaseAmount
      : paymentMethod === 'credit'
        ? 0
        : Math.min(totalPurchaseAmount, Math.max(0, Number(paidAmountInput) || 0));

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingPurchase(true);
    try {
      const created = await createPurchaseTx(
        {
          supplierId,
          items: draftItems.map((d) => ({
            productId: d.productId,
            quantity: d.quantity,
            unitCost: d.unitCost,
          })),
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
      setDraftItems([]);
      setNotes('');
      setPaidAmountInput('');
      setSuccessMsg(`تم اعتماد فاتورة الشراء ${created.invoiceNumber} وزيادة المخزون بنجاح.`);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingPurchase(false);
    }
  };

  const openPurchaseReturnModal = (p: Purchase) => {
    setReturnPurchase(p);
    setReturnReason('');
    setReturnError(null);
    const qtyMap: Record<string, number> = {};
    const dmgMap: Record<string, boolean> = {};
    for (const it of p.items) {
      qtyMap[it.productId] = 0;
      dmgMap[it.productId] = false;
    }
    setReturnQtys(qtyMap);
    setFromDamagedFlags(dmgMap);
  };

  const handleSubmitPurchaseReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !returnPurchase) return;
    setReturnError(null);
    setSubmittingReturn(true);
    try {
      const created = await createPurchaseReturnTx(
        {
          purchase: returnPurchase,
          items: returnPurchase.items.map((it) => ({
            productId: it.productId,
            quantity: returnQtys[it.productId] || 0,
            fromDamaged: Boolean(fromDamagedFlags[it.productId]),
          })),
          reason: returnReason,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setReturnPurchase(null);
      setSuccessMsg(`تم تسجيل مرتجع المشتريات ${created.returnNumber} وخصم المخزون بنجاح.`);
    } catch (err) {
      setReturnError(formatReadableError(err));
    } finally {
      setSubmittingReturn(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setSavingSup(true);
    try {
      const created = await createSupplierTx(
        { name: supName, phone: supPhone, address: supAddress },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setSupplierId(created.id);
      setShowSupplierModal(false);
      setSupName('');
      setSupPhone('');
      setSupAddress('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingSup(false);
    }
  };

  const handlePaySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !paySupplier) return;
    setPayingSup(true);
    try {
      await createVoucherTx(
        {
          type: 'payment',
          category: 'سداد مستحقات مورد',
          partyType: 'supplier',
          partyId: paySupplier.id,
          partyName: paySupplier.name,
          amount: Number(payAmt) || 0,
          notes: payNotes || `دفعة للمورد ${paySupplier.name}`,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setPaySupplier(null);
      setPayAmt('');
      setPayNotes('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setPayingSup(false);
    }
  };

  const supplierStatementRows = useMemo(() => {
    if (!statementSupplier) return [];
    const pRows = purchases
      .filter((p) => p.supplierId === statementSupplier.id)
      .map((p) => ({
        id: p.id,
        date: p.createdAt,
        ref: p.invoiceNumber,
        desc: `فاتورة مشتريات (${p.items.length} أصناف)`,
        credit: p.totalAmount,
        debit: p.paidAmount,
      }));
    const prRows = purchaseReturns
      .filter((pr) => pr.supplierId === statementSupplier.id)
      .map((pr) => ({
        id: pr.id,
        date: pr.createdAt,
        ref: pr.returnNumber,
        desc: `مرتجع مشتريات (${pr.invoiceNumber}): ${pr.reason}`,
        credit: 0,
        debit: pr.debtReduced,
      }));
    const vRows = vouchers
      .filter((v) => v.partyType === 'supplier' && v.partyId === statementSupplier.id)
      .map((v) => ({
        id: v.id,
        date: v.createdAt,
        ref: v.voucherNumber,
        desc: `${v.category}${v.notes ? ` - ${v.notes}` : ''}`,
        credit: 0,
        debit: v.amount,
      }));
    return [...pRows, ...prRows, ...vRows].sort(
      (a, b) => (b.date?.toMillis?.() || 0) - (a.date?.toMillis?.() || 0)
    );
  }, [statementSupplier, purchases, purchaseReturns, vouchers]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setSubTab('new')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'new' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            فاتورة شراء جديدة
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            فواتير المشتريات ({purchases.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('returns')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'returns' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            مرتجعات المشتريات ({purchaseReturns.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('suppliers')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'suppliers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            الموردون ({suppliers.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowSupplierModal(true)}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مورد جديد</span>
        </button>
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

      {subTab === 'new' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <h3 className="font-bold text-sm text-slate-900">اختيار الأصناف بالكود أو الاسم</h3>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={productLookup}
                onChange={(e) => setProductLookup(e.target.value)}
                placeholder="ابحث بكود الصنف أو اسمه..."
                className="w-full pr-10 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
              {matchingProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addDraftProduct(p.id)}
                  className="w-full px-3.5 py-2.5 text-right hover:bg-slate-50 flex items-center justify-between text-xs cursor-pointer"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{p.name}</div>
                    <div className="font-mono-num text-slate-500">
                      {p.code} · الرصيد الحالي: {p.quantity}
                    </div>
                  </div>
                  <span className="font-mono-num text-emerald-700 font-semibold">+ إضافة</span>
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleSubmitPurchase}
            className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">المورد *</label>
                <select
                  required
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">اختر المورد...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:w-48">
                <label className="block text-xs font-medium text-slate-700 mb-1">طريقة السداد</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="cash">نقدي</option>
                  <option value="partial">دفع جزئي</option>
                  <option value="credit">آجل</option>
                </select>
              </div>
            </div>

            {draftItems.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
                اختر الأصناف من القائمة لإدخال كميات وأسعار الشراء
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">الكود</th>
                      <th className="py-2.5 px-3">الصنف</th>
                      <th className="py-2.5 px-3">الكمية</th>
                      <th className="py-2.5 px-3">سعر الشراء</th>
                      <th className="py-2.5 px-3 text-left">الإجمالي</th>
                      <th className="py-2.5 px-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftItems.map((it) => (
                      <tr key={it.productId}>
                        <td className="py-2 px-3 font-mono-num text-slate-600">{it.productCode}</td>
                        <td className="py-2 px-3 font-medium text-slate-900">{it.productName}</td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min={1}
                            value={it.quantity}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((x) =>
                                  x.productId === it.productId
                                    ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) }
                                    : x
                                )
                              )
                            }
                            className="w-20 px-2 py-1 border border-slate-300 rounded font-mono-num"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={it.unitCost}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((x) =>
                                  x.productId === it.productId
                                    ? { ...x, unitCost: Math.max(0, Number(e.target.value) || 0) }
                                    : x
                                )
                              )
                            }
                            className="w-24 px-2 py-1 border border-slate-300 rounded font-mono-num"
                          />
                        </td>
                        <td className="py-2 px-3 text-left font-mono-num font-semibold">
                          {formatCurrency(it.quantity * it.unitCost, currency)}
                        </td>
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftItems((prev) =>
                                prev.filter((x) => x.productId !== it.productId)
                              )
                            }
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {paymentMethod === 'partial' && (
              <div className="flex items-center justify-between gap-4 text-xs">
                <label className="font-medium text-slate-700">المبلغ المدفوع للمورد الآن</label>
                <input
                  type="number"
                  min={0}
                  max={totalPurchaseAmount}
                  step="0.01"
                  value={paidAmountInput}
                  onChange={(e) => setPaidAmountInput(e.target.value)}
                  className="w-36 px-3 py-2 border border-slate-300 rounded-lg font-mono-num text-left"
                />
              </div>
            )}

            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات فاتورة الشراء (اختياري)..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 text-sm">
              <div>
                <div className="text-xs text-slate-500">إجمالي الفاتورة</div>
                <div className="font-bold font-mono-num text-slate-900">
                  {formatCurrency(totalPurchaseAmount, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">المدفوع</div>
                <div className="font-bold font-mono-num text-emerald-700">
                  {formatCurrency(effectivePaid, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">المتبقي للمورد</div>
                <div className="font-bold font-mono-num text-rose-700">
                  {formatCurrency(Math.max(0, totalPurchaseAmount - effectivePaid), currency)}
                </div>
              </div>
              <button
                type="submit"
                disabled={savingPurchase || draftItems.length === 0}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                {savingPurchase ? 'جاري الاعتماد...' : 'اعتماد وتوريد للمخزون'}
              </button>
            </div>
          </form>
        </div>
      )}

      {subTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {purchases.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">لا توجد فواتير شراء مسجلة.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">رقم الفاتورة</th>
                    <th className="py-3 px-4 font-semibold">المورد</th>
                    <th className="py-3 px-4 font-semibold">الحالة</th>
                    <th className="py-3 px-4 font-semibold text-left">الإجمالي</th>
                    <th className="py-3 px-4 font-semibold text-left">المدفوع</th>
                    <th className="py-3 px-4 font-semibold text-left">المتبقي</th>
                    <th className="py-3 px-4 font-semibold">التاريخ</th>
                    <th className="py-3 px-4 font-semibold">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td
                        onClick={() => setViewPurchase(p)}
                        className="py-3 px-4 font-mono-num font-bold text-slate-900 cursor-pointer underline decoration-slate-300"
                      >
                        {p.invoiceNumber}
                      </td>
                      <td className="py-3 px-4 font-medium">{p.supplierName}</td>
                      <td className="py-3 px-4">
                        <span
                          className={
                            p.status === 'received'
                              ? 'text-emerald-700'
                              : p.status === 'returned'
                                ? 'text-rose-700'
                                : 'text-amber-700'
                          }
                        >
                          {p.status === 'received'
                            ? 'مستلمة'
                            : p.status === 'partially_returned'
                              ? 'مرتجع جزئي'
                              : p.status === 'returned'
                                ? 'مرتجعة للمورد'
                                : 'ملغاة'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num font-semibold">
                        {formatCurrency(p.totalAmount, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                        {formatCurrency(p.paidAmount, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-rose-700">
                        {formatCurrency(p.remainingAmount, currency)}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-500">
                        {formatDateTime(p.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        {p.status !== 'returned' && p.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() => openPurchaseReturnModal(p)}
                            title="مرتجع مشتريات للمورد"
                            className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded cursor-pointer flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>إرجاع</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'returns' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {purchaseReturns.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا توجد مرتجعات مشتريات مسجلة للموردين.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">رقم المرتجع</th>
                    <th className="py-3 px-4 font-semibold">فاتورة الشراء</th>
                    <th className="py-3 px-4 font-semibold">المورد</th>
                    <th className="py-3 px-4 font-semibold text-left">قيمة المرتجع</th>
                    <th className="py-3 px-4 font-semibold text-left">مسترد للصندوق</th>
                    <th className="py-3 px-4 font-semibold text-left">خصم من الدين</th>
                    <th className="py-3 px-4 font-semibold">السبب</th>
                    <th className="py-3 px-4 font-semibold">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseReturns.map((pr) => (
                    <tr key={pr.id}>
                      <td className="py-3 px-4 font-mono-num font-semibold text-slate-900">
                        {pr.returnNumber}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-700">
                        {pr.invoiceNumber}
                      </td>
                      <td className="py-3 px-4">{pr.supplierName}</td>
                      <td className="py-3 px-4 text-left font-mono-num font-bold">
                        {formatCurrency(pr.totalRefund, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                        {formatCurrency(pr.cashRefunded, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-slate-700">
                        {formatCurrency(pr.debtReduced, currency)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{pr.reason}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-500">
                        {formatDateTime(pr.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'suppliers' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {suppliers.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">لا يوجد موردون مسجلون.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الكود</th>
                    <th className="py-3 px-4 font-semibold">اسم المورد</th>
                    <th className="py-3 px-4 font-semibold">الهاتف</th>
                    <th className="py-3 px-4 font-semibold text-left">إجمالي المشتريات</th>
                    <th className="py-3 px-4 font-semibold text-left">المدفوع</th>
                    <th className="py-3 px-4 font-semibold text-left">المستحق للمورد</th>
                    <th className="py-3 px-4 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono-num font-semibold text-slate-700">
                        {s.code}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">{s.name}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-600">{s.phone || '—'}</td>
                      <td className="py-3 px-4 text-left font-mono-num">
                        {formatCurrency(s.totalPurchases, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                        {formatCurrency(s.totalPaid, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num font-bold text-rose-700">
                        {formatCurrency(s.balanceDue, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setStatementSupplier(s)}
                            title="كشف حساب المورد"
                            className="p-1.5 text-slate-600 hover:text-emerald-700 rounded cursor-pointer"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          {s.balanceDue > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setPaySupplier(s);
                                setPayAmt(String(s.balanceDue));
                              }}
                              title="سداد للمورد"
                              className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                            >
                              <Wallet className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Purchase Return Modal */}
      {returnPurchase && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                مرتجع مشتريات للمورد — {returnPurchase.invoiceNumber}
              </h3>
              <button type="button" onClick={() => setReturnPurchase(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            {returnError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {returnError}
              </div>
            )}
            <form onSubmit={handleSubmitPurchaseReturn} className="space-y-4">
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {returnPurchase.items.map((it) => {
                  const maxRet = Math.max(0, it.quantity - (it.returnedQuantity || 0));
                  const prod = products.find((p) => p.id === it.productId);
                  const hasDamaged = (prod?.damagedQuantity || 0) > 0;
                  return (
                    <div key={it.productId} className="p-3 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{it.productName}</div>
                        <div className="font-mono-num text-slate-500">
                          {it.productCode} · المشتراة: {it.quantity} · القابلة للإرجاع: {maxRet}
                        </div>
                        {hasDamaged && (
                          <label className="inline-flex items-center gap-1.5 text-rose-700 mt-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(fromDamagedFlags[it.productId])}
                              onChange={(e) =>
                                setFromDamagedFlags((prev) => ({
                                  ...prev,
                                  [it.productId]: e.target.checked,
                                }))
                              }
                            />
                            <span>خصم من المخزون التالف ({prod?.damagedQuantity})</span>
                          </label>
                        )}
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={maxRet}
                        value={returnQtys[it.productId] || 0}
                        onChange={(e) =>
                          setReturnQtys((prev) => ({
                            ...prev,
                            [it.productId]: Math.min(maxRet, Math.max(0, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-20 px-2 py-1 border border-slate-300 rounded text-center font-mono-num"
                      />
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  سبب الإرجاع للمورد *
                </label>
                <textarea
                  required
                  rows={2}
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="مثال: انتهاء صلاحية قريب، بضاعة معيبة من المورد..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setReturnPurchase(null)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
                >
                  تراجع
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg cursor-pointer"
                >
                  {submittingReturn ? 'جاري التنفيذ...' : 'اعتماد مرتجع المشتريات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Supplier Modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">إضافة مورد جديد</h3>
              <button type="button" onClick={() => setShowSupplierModal(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateSupplier} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم المورد *</label>
                <input
                  type="text"
                  required
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الهاتف</label>
                <input
                  type="text"
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingSup}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                >
                  {savingSup ? 'جاري الحفظ...' : 'حفظ المورد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Supplier Modal */}
      {paySupplier && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">سند صرف — {paySupplier.name}</h3>
              <button type="button" onClick={() => setPaySupplier(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handlePaySupplier} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">المبلغ المدفوع *</label>
                <input
                  type="number"
                  required
                  min={0.01}
                  step="0.01"
                  value={payAmt}
                  onChange={(e) => setPayAmt(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPaySupplier(null)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={payingSup}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                >
                  {payingSup ? 'جاري التسجيل...' : 'تأكيد الصرف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Statement Modal */}
      {statementSupplier && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full print-container overflow-hidden my-auto">
            <div className="no-print flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-bold text-slate-900">
                كشف حساب المورد: {statementSupplier.name} ({statementSupplier.code})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={triggerPrint}
                  className="px-3.5 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة</span>
                </button>
                <button type="button" onClick={() => setStatementSupplier(null)}>
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-4 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <div className="text-slate-500">صافي المشتريات</div>
                  <div className="text-base font-bold font-mono-num">
                    {formatCurrency(statementSupplier.totalPurchases, currency)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">إجمالي المسدد</div>
                  <div className="text-base font-bold font-mono-num text-emerald-700">
                    {formatCurrency(statementSupplier.totalPaid, currency)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">المستحق للمورد</div>
                  <div className="text-base font-bold font-mono-num text-rose-700">
                    {formatCurrency(statementSupplier.balanceDue, currency)}
                  </div>
                </div>
              </div>
              <table className="w-full text-xs text-right border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">التاريخ</th>
                    <th className="py-2.5 px-3">المرجع</th>
                    <th className="py-2.5 px-3">البيان</th>
                    <th className="py-2.5 px-3 text-left">مشتريات (دائن)</th>
                    <th className="py-2.5 px-3 text-left">دفعات/مرتجع (مدين)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplierStatementRows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 px-3 font-mono-num text-slate-500">{formatDateTime(r.date)}</td>
                      <td className="py-2 px-3 font-mono-num font-semibold">{r.ref}</td>
                      <td className="py-2 px-3">{r.desc}</td>
                      <td className="py-2 px-3 text-left font-mono-num">
                        {r.credit > 0 ? formatCurrency(r.credit, currency) : '—'}
                      </td>
                      <td className="py-2 px-3 text-left font-mono-num text-emerald-700">
                        {r.debit > 0 ? formatCurrency(r.debit, currency) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* View Purchase Modal */}
      {viewPurchase && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                تفاصيل فاتورة الشراء {viewPurchase.invoiceNumber}
              </h3>
              <button type="button" onClick={() => setViewPurchase(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="text-xs text-slate-600 flex justify-between">
              <span>المورد: {viewPurchase.supplierName}</span>
              <span className="font-mono-num">{formatDateTime(viewPurchase.createdAt)}</span>
            </div>
            <table className="w-full text-xs text-right border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">الكود</th>
                  <th className="py-2 px-3">الصنف</th>
                  <th className="py-2 px-3 text-left">الكمية</th>
                  <th className="py-2 px-3 text-left">التكلفة</th>
                  <th className="py-2 px-3 text-left">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {viewPurchase.items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="py-2 px-3 font-mono-num">{it.productCode}</td>
                    <td className="py-2 px-3">
                      {it.productName}
                      {(it.returnedQuantity || 0) > 0 && (
                        <span className="text-amber-700 mr-1.5">
                          (مرتجع: {it.returnedQuantity})
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num">{it.quantity}</td>
                    <td className="py-2 px-3 text-left font-mono-num">
                      {formatCurrency(it.unitCost, currency)}
                    </td>
                    <td className="py-2 px-3 text-left font-mono-num font-semibold">
                      {formatCurrency(it.lineTotal, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
