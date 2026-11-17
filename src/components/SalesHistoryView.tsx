import React, { useMemo, useState } from 'react';
import { Eye, RotateCcw, Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { formatReadableError } from '../lib/firestoreError';
import { formatCurrency, formatDateTime } from '../lib/formatters';
import { createReturnOrCancelTx } from '../services/accountingService';
import { Sale } from '../types/accounting';
import { InvoiceModal } from './InvoiceModal';

export function SalesHistoryView() {
  const { userAccount } = useAuth();
  const { sales, returns, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const isAdmin = userAccount?.role === 'admin';
  const canCancelOrReturn = Boolean(isAdmin || userAccount?.permissions.canCancelInvoice);

  const [activeSubTab, setActiveSubTab] = useState<'sales' | 'returns'>('sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Sale['status']>('all');
  const [viewSale, setViewSale] = useState<Sale | null>(null);

  // Return / Cancel Modal State
  const [returnTarget, setReturnTarget] = useState<Sale | null>(null);
  const [returnMode, setReturnMode] = useState<'return' | 'cancel'>('return');
  const [returnReason, setReturnReason] = useState('');
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [restockFlags, setRestockFlags] = useState<Record<string, boolean>>({});
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales
      .filter((s) => statusFilter === 'all' || s.status === statusFilter)
      .filter((s) => {
        if (!q) return true;
        return (
          s.invoiceNumber.toLowerCase().includes(q) ||
          s.customerName.toLowerCase().includes(q) ||
          s.employeeName.toLowerCase().includes(q) ||
          (s.customerCode && s.customerCode.toLowerCase().includes(q))
        );
      });
  }, [sales, search, statusFilter]);

  const openReturnModal = (sale: Sale) => {
    setReturnTarget(sale);
    setReturnMode('return');
    setReturnReason('');
    setReturnError(null);
    const qtyMap: Record<string, number> = {};
    const restockMap: Record<string, boolean> = {};
    for (const it of sale.items) {
      qtyMap[it.productId] = 0;
      restockMap[it.productId] = true;
    }
    setReturnQtys(qtyMap);
    setRestockFlags(restockMap);
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !returnTarget) return;
    setReturnError(null);
    setSubmittingReturn(true);
    try {
      await createReturnOrCancelTx(
        {
          sale: returnTarget,
          type: returnMode,
          items: returnTarget.items.map((it) => ({
            productId: it.productId,
            quantity: returnQtys[it.productId] || 0,
            restockable: restockFlags[it.productId] !== false,
          })),
          reason: returnReason,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setReturnTarget(null);
    } catch (err) {
      setReturnError(formatReadableError(err));
    } finally {
      setSubmittingReturn(false);
    }
  };

  const statusText = (st: Sale['status']) =>
    st === 'completed'
      ? 'مكتملة'
      : st === 'partially_returned'
        ? 'مرتجع جزئي'
        : st === 'returned'
          ? 'مرتجعة بالكامل'
          : 'ملغاة';

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActiveSubTab('sales')}
            className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer ${
              activeSubTab === 'sales' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            فواتير المبيعات ({sales.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('returns')}
            className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer ${
              activeSubTab === 'returns' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            سجل المرتجعات والإلغاءات ({returns.length})
          </button>
        </div>

        {activeSubTab === 'sales' && (
          <div className="flex flex-col sm:flex-row gap-2 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الفاتورة، العميل، أو البائع..."
                className="w-full pr-10 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | Sale['status'])}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">جميع الحالات</option>
              <option value="completed">مكتملة</option>
              <option value="partially_returned">مرتجع جزئي</option>
              <option value="returned">مرتجعة بالكامل</option>
              <option value="cancelled">ملغاة</option>
            </select>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500 px-1">
        الفواتير المعتمدة محمية من الحذف المباشر؛ يتم التعديل عبر المرتجعات أو الإلغاء المحاسبي الموثق.
      </div>

      {activeSubTab === 'sales' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredSales.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا توجد فواتير مطابقة للبحث.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">رقم الفاتورة</th>
                    <th className="py-3 px-4 font-semibold">البائع</th>
                    <th className="py-3 px-4 font-semibold">العميل</th>
                    <th className="py-3 px-4 font-semibold text-left">الأصناف</th>
                    <th className="py-3 px-4 font-semibold text-left">الإجمالي</th>
                    <th className="py-3 px-4 font-semibold text-left">المدفوع</th>
                    <th className="py-3 px-4 font-semibold text-left">المتبقي</th>
                    <th className="py-3 px-4 font-semibold">الحالة</th>
                    <th className="py-3 px-4 font-semibold">التاريخ</th>
                    <th className="py-3 px-4 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono-num font-bold text-slate-900">
                        {s.invoiceNumber}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{s.employeeName}</td>
                      <td className="py-3 px-4 text-slate-800">{s.customerName}</td>
                      <td className="py-3 px-4 text-left font-mono-num">{s.items.length}</td>
                      <td className="py-3 px-4 text-left font-mono-num font-semibold text-slate-900">
                        {formatCurrency(s.totalAmount, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                        {formatCurrency(s.paidAmount, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-rose-700">
                        {formatCurrency(s.remainingAmount, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-medium ${
                            s.status === 'completed'
                              ? 'text-emerald-700'
                              : s.status === 'cancelled'
                                ? 'text-rose-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {statusText(s.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                        {formatDateTime(s.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setViewSale(s)}
                            title="عرض وطباعة الفاتورة"
                            className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canCancelOrReturn &&
                            s.status !== 'cancelled' &&
                            s.status !== 'returned' && (
                              <button
                                type="button"
                                onClick={() => openReturnModal(s)}
                                title="تسجيل مرتجع أو إلغاء"
                                className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded cursor-pointer"
                              >
                                <RotateCcw className="w-4 h-4" />
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
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {returns.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا توجد مرتجعات أو فواتير ملغاة مسجلة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">رقم السند</th>
                    <th className="py-3 px-4 font-semibold">الفاتورة الأصلية</th>
                    <th className="py-3 px-4 font-semibold">النوع</th>
                    <th className="py-3 px-4 font-semibold">العميل</th>
                    <th className="py-3 px-4 font-semibold">الموظف</th>
                    <th className="py-3 px-4 font-semibold text-left">إجمالي المرتجع</th>
                    <th className="py-3 px-4 font-semibold text-left">مسترد نقداً</th>
                    <th className="py-3 px-4 font-semibold">السبب</th>
                    <th className="py-3 px-4 font-semibold">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returns.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 px-4 font-mono-num font-semibold text-slate-900">
                        {r.returnNumber}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-700">
                        {r.invoiceNumber}
                      </td>
                      <td className="py-3 px-4">
                        <span className={r.type === 'cancel' ? 'text-rose-700' : 'text-amber-700'}>
                          {r.type === 'cancel' ? 'إلغاء فاتورة' : 'مرتجع أصناف'}
                        </span>
                      </td>
                      <td className="py-3 px-4">{r.customerName}</td>
                      <td className="py-3 px-4">{r.employeeName}</td>
                      <td className="py-3 px-4 text-left font-mono-num font-semibold">
                        {formatCurrency(r.totalRefund, currency)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono-num text-rose-700">
                        {formatCurrency(r.cashRefunded, currency)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{r.reason}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                        {formatDateTime(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {viewSale && (
        <InvoiceModal
          sale={viewSale}
          shopSettings={shopSettings}
          onClose={() => setViewSale(null)}
        />
      )}

      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                مرتجع / إلغاء الفاتورة {returnTarget.invoiceNumber}
              </h3>
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {returnError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {returnError}
              </div>
            )}

            <form onSubmit={handleReturnSubmit} className="space-y-4">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setReturnMode('return')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md cursor-pointer ${
                    returnMode === 'return' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  مرتجع جزئي / أصناف محددة
                </button>
                <button
                  type="button"
                  onClick={() => setReturnMode('cancel')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md cursor-pointer ${
                    returnMode === 'cancel' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  إلغاء كامل الفاتورة وإعادة المخزون
                </button>
              </div>

              {returnMode === 'return' && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {returnTarget.items.map((it) => {
                    const maxAvail = Math.max(0, it.quantity - (it.returnedQuantity || 0));
                    const isRestockable = restockFlags[it.productId] !== false;
                    return (
                      <div key={it.productId} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{it.productName}</div>
                          <div className="text-slate-500 font-mono-num">
                            {it.productCode} · المباع: {it.quantity} · القابل للإرجاع: {maxAvail}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            value={isRestockable ? 'valid' : 'damaged'}
                            onChange={(e) =>
                              setRestockFlags((prev) => ({
                                ...prev,
                                [it.productId]: e.target.value === 'valid',
                              }))
                            }
                            className={`px-2 py-1 text-xs border rounded font-medium ${
                              isRestockable
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                : 'border-rose-300 bg-rose-50 text-rose-800'
                            }`}
                          >
                            <option value="valid">صالح (يعود للمخزون)</option>
                            <option value="damaged">تالف (لا يُضاف للمخزون)</option>
                          </select>
                          <input
                            type="number"
                            min={0}
                            max={maxAvail}
                            value={returnQtys[it.productId] || 0}
                            onChange={(e) =>
                              setReturnQtys((prev) => ({
                                ...prev,
                                [it.productId]: Math.min(maxAvail, Math.max(0, Number(e.target.value) || 0)),
                              }))
                            }
                            className="w-16 px-2 py-1 border border-slate-300 rounded text-center font-mono-num"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  سبب الإرجاع أو الإلغاء *
                </label>
                <textarea
                  required
                  rows={2}
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="اذكر سبب الإرجاع أو الإلغاء لتوثيقه في سجل التدقيق..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg"
                >
                  تراجع
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg cursor-pointer"
                >
                  {submittingReturn ? 'جاري التنفيذ...' : 'تأكيد المرتجع / الإلغاء'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
