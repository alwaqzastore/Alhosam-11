import React, { useMemo, useState } from 'react';
import { Plus, Wallet, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { formatReadableError } from '../lib/firestoreError';
import {
  formatCurrency,
  formatDateTime,
  isSameDay,
  isSameMonth,
  isSameYear,
} from '../lib/formatters';
import { createVoucherTx } from '../services/accountingService';
import { VoucherType } from '../types/accounting';

export function FinanceView() {
  const { userAccount } = useAuth();
  const { sales, returns, vouchers, customers, suppliers, treasury, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const [period, setPeriod] = useState<'today' | 'month' | 'year' | 'all'>('month');
  const [showVoucherModal, setShowVoucherModal] = useState(false);

  const [vType, setVType] = useState<VoucherType>('expense');
  const [vCategory, setVCategory] = useState('مصروفات تشغيلية');
  const [vPartyType, setVPartyType] = useState<'general' | 'customer' | 'supplier'>('general');
  const [vPartyId, setVPartyId] = useState('');
  const [vAmount, setVAmount] = useState('');
  const [vNotes, setVNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filterByPeriod = (ts: Parameters<typeof isSameDay>[0]) => {
    const now = new Date();
    if (period === 'today') return isSameDay(ts, now);
    if (period === 'month') return isSameMonth(ts, now);
    if (period === 'year') return isSameYear(ts, now);
    return true;
  };

  const summary = useMemo(() => {
    const pSales = sales.filter((s) => s.status !== 'cancelled' && filterByPeriod(s.createdAt));
    const pReturns = returns.filter((r) => filterByPeriod(r.createdAt));
    const pVouchers = vouchers.filter((v) => filterByPeriod(v.createdAt));

    const grossSales = pSales.reduce((s, x) => s + (x.subtotal || 0), 0);
    const totalDiscounts = pSales.reduce((s, x) => s + (x.discount || 0), 0);
    const netSales = pSales.reduce((s, x) => s + (x.totalAmount || 0), 0);
    const totalCOGS = pSales.reduce((s, x) => s + (x.totalCost || 0), 0);

    const returnsTotal = pReturns.reduce((s, r) => s + (r.totalRefund || 0), 0);
    const recoveredCost = pReturns.reduce(
      (s, r) =>
        s +
        r.items.reduce(
          (iSum, it) => iSum + (it.restockable ? it.unitPurchasePrice * it.quantity : 0),
          0
        ),
      0
    );

    const adjustedRevenue = netSales - returnsTotal;
    const adjustedCOGS = totalCOGS - recoveredCost;
    const grossProfit = adjustedRevenue - adjustedCOGS;

    const expensesTotal = pVouchers
      .filter((v) => v.type === 'expense')
      .reduce((s, v) => s + (v.amount || 0), 0);

    const netProfit = grossProfit - expensesTotal;

    const totalReceivables = customers.reduce((s, c) => s + Math.max(0, c.balanceDue || 0), 0);
    const totalPayables = suppliers.reduce((s, sp) => s + Math.max(0, sp.balanceDue || 0), 0);

    return {
      grossSales,
      totalDiscounts,
      returnsTotal,
      adjustedRevenue,
      adjustedCOGS,
      grossProfit,
      expensesTotal,
      netProfit,
      totalReceivables,
      totalPayables,
      pVouchers,
    };
  }, [sales, returns, vouchers, customers, suppliers, period]);

  const handleOpenVoucher = (type: VoucherType) => {
    setVType(type);
    setErrorMsg(null);
    if (type === 'receipt') {
      setVCategory('سداد دين عميل');
      setVPartyType('customer');
    } else if (type === 'payment') {
      setVCategory('سداد مستحقات مورد');
      setVPartyType('supplier');
    } else {
      setVCategory('مصروفات تشغيلية');
      setVPartyType('general');
    }
    setVPartyId('');
    setVAmount('');
    setVNotes('');
    setShowVoucherModal(true);
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      const partyName =
        vPartyType === 'customer'
          ? customers.find((c) => c.id === vPartyId)?.name
          : vPartyType === 'supplier'
            ? suppliers.find((s) => s.id === vPartyId)?.name
            : undefined;

      await createVoucherTx(
        {
          type: vType,
          category: vCategory,
          partyType: vPartyType,
          partyId: vPartyType !== 'general' ? vPartyId : undefined,
          partyName,
          amount: Number(vAmount) || 0,
          notes: vNotes,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setShowVoucherModal(false);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Cash & Debt Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>رصيد الصندوق النقدي</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-slate-900">
            {formatCurrency(treasury?.cashBalance || 0, currency)}
          </div>
          <div className="text-xs text-slate-500 font-mono-num">
            وارد: {formatCurrency(treasury?.totalCashIn || 0, currency)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>صافي الربح ({period === 'today' ? 'اليوم' : period === 'month' ? 'الشهر' : period === 'year' ? 'السنة' : 'الكل'})</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div
            className={`text-2xl font-bold font-mono-num ${
              summary.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {formatCurrency(summary.netProfit, currency)}
          </div>
          <div className="text-xs text-slate-500 font-mono-num">
            الإيراد الصافي: {formatCurrency(summary.adjustedRevenue, currency)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>ديون العملاء (لنا)</span>
            <TrendingUp className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-amber-700">
            {formatCurrency(summary.totalReceivables, currency)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>مستحقات الموردين (علينا)</span>
            <TrendingDown className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-rose-700">
            {formatCurrency(summary.totalPayables, currency)}
          </div>
        </div>
      </div>

      {/* Period Filter + Voucher Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              { id: 'today', label: 'اليومي' },
              { id: 'month', label: 'الشهري' },
              { id: 'year', label: 'السنوي' },
              { id: 'all', label: 'الإجمالي العام' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                period === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenVoucher('receipt')}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>سند قبض</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenVoucher('payment')}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>سند صرف</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenVoucher('expense')}
            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل مصروف</span>
          </button>
        </div>
      </div>

      {/* P&L Breakdown + Vouchers List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="font-bold text-slate-900 text-sm pb-3 border-b border-slate-200">
            قائمة الأرباح والخسائر التفصيلية
          </h3>
          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">إجمالي المبيعات</span>
              <span className="font-mono-num font-semibold">
                {formatCurrency(summary.grossSales, currency)}
              </span>
            </div>
            <div className="flex justify-between text-amber-700">
              <span>الخصومات الممنوحة</span>
              <span className="font-mono-num">-{formatCurrency(summary.totalDiscounts, currency)}</span>
            </div>
            <div className="flex justify-between text-amber-700">
              <span>المرتجعات</span>
              <span className="font-mono-num">-{formatCurrency(summary.returnsTotal, currency)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-100 font-semibold">
              <span>صافي الإيرادات</span>
              <span className="font-mono-num">{formatCurrency(summary.adjustedRevenue, currency)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>تكلفة البضاعة المباعة</span>
              <span className="font-mono-num">-{formatCurrency(summary.adjustedCOGS, currency)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-100 font-semibold text-slate-900">
              <span>مجمل الربح</span>
              <span className="font-mono-num">{formatCurrency(summary.grossProfit, currency)}</span>
            </div>
            <div className="flex justify-between text-rose-700">
              <span>المصروفات التشغيلية</span>
              <span className="font-mono-num">-{formatCurrency(summary.expensesTotal, currency)}</span>
            </div>
            <div className="flex justify-between pt-3 border-t border-slate-200 text-sm font-bold">
              <span>صافي الربح</span>
              <span
                className={`font-mono-num ${
                  summary.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {formatCurrency(summary.netProfit, currency)}
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="font-bold text-slate-900 text-sm">سجل السندات والمصروفات</h3>
          </div>
          {summary.pVouchers.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              لا توجد سندات أو مصروفات مسجلة في هذه الفترة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4">رقم السند</th>
                    <th className="py-2.5 px-4">النوع</th>
                    <th className="py-2.5 px-4">البند / الطرف</th>
                    <th className="py-2.5 px-4 text-left">المبلغ</th>
                    <th className="py-2.5 px-4">الموظف</th>
                    <th className="py-2.5 px-4">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.pVouchers.map((v) => (
                    <tr key={v.id}>
                      <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-800">
                        {v.voucherNumber}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={
                            v.type === 'receipt'
                              ? 'text-emerald-700 font-medium'
                              : v.type === 'payment'
                                ? 'text-amber-700 font-medium'
                                : 'text-rose-700 font-medium'
                          }
                        >
                          {v.type === 'receipt' ? 'سند قبض' : v.type === 'payment' ? 'سند صرف' : 'مصروف'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{v.category}</div>
                        {(v.partyName || v.notes) && (
                          <div className="text-slate-500">
                            {v.partyName}
                            {v.partyName && v.notes ? ' · ' : ''}
                            {v.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-left font-mono-num font-bold">
                        {formatCurrency(v.amount, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{v.employeeName}</td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                        {formatDateTime(v.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create Voucher Modal */}
      {showVoucherModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                {vType === 'receipt'
                  ? 'إنشاء سند قبض'
                  : vType === 'payment'
                    ? 'إنشاء سند صرف'
                    : 'تسجيل مصروف تشغيلي'}
              </h3>
              <button type="button" onClick={() => setShowVoucherModal(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateVoucher} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">البند / التصنيف *</label>
                <input
                  type="text"
                  required
                  value={vCategory}
                  onChange={(e) => setVCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {vType !== 'expense' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">نوع الطرف</label>
                  <select
                    value={vPartyType}
                    onChange={(e) => {
                      setVPartyType(e.target.value as 'general' | 'customer' | 'supplier');
                      setVPartyId('');
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="customer">عميل</option>
                    <option value="supplier">مورد</option>
                    <option value="general">عام / الصندوق</option>
                  </select>
                </div>
              )}

              {vPartyType === 'customer' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">العميل *</label>
                  <select
                    required
                    value={vPartyId}
                    onChange={(e) => setVPartyId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">اختر العميل...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (المتبقي: {c.balanceDue})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {vPartyType === 'supplier' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">المورد *</label>
                  <select
                    required
                    value={vPartyId}
                    onChange={(e) => setVPartyId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">اختر المورد...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (المستحق: {s.balanceDue})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">المبلغ *</label>
                <input
                  type="number"
                  required
                  min={0.01}
                  step="0.01"
                  value={vAmount}
                  onChange={(e) => setVAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  value={vNotes}
                  onChange={(e) => setVNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVoucherModal(false)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                >
                  {saving ? 'جاري الحفظ...' : 'اعتماد السند'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
