import React, { useMemo, useState } from 'react';
import { Edit2, FileText, MessageCircle, Plus, Printer, Search, Wallet, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { triggerPrint } from '../lib/exportUtils';
import { formatReadableError } from '../lib/firestoreError';
import {
  buildWhatsAppUrl,
  formatCurrency,
  formatDateOnly,
  formatDateTime,
} from '../lib/formatters';
import {
  createCustomerTx,
  createVoucherTx,
  updateCustomerTx,
} from '../services/accountingService';
import { Customer } from '../types/accounting';

export function CustomersView() {
  const { userAccount } = useAuth();
  const { customers, sales, returns, vouchers, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const isAdmin = userAccount?.role === 'admin';
  const canManageCustomers = Boolean(isAdmin || userAccount?.permissions.canManageCustomers);

  const [search, setSearch] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(false);

  // Add/Edit Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Payment Receipt Modal
  const [payTarget, setPayTarget] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);

  // Statement Modal
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => !onlyDebtors || c.balanceDue > 0)
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          (c.phone && c.phone.toLowerCase().includes(q))
        );
      });
  }, [customers, search, onlyDebtors]);

  const totalDebt = useMemo(
    () => customers.reduce((sum, c) => sum + Math.max(0, c.balanceDue || 0), 0),
    [customers]
  );

  const openCreate = () => {
    setEditingCustomer(null);
    setName('');
    setPhone('');
    setAddress('');
    setNotes('');
    setErrorMsg(null);
    setFormModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setName(c.name);
    setPhone(c.phone || '');
    setAddress(c.address || '');
    setNotes(c.notes || '');
    setErrorMsg(null);
    setFormModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const actor = {
        uid: userAccount.uid,
        displayName: userAccount.displayName,
        role: userAccount.role,
      };
      if (editingCustomer) {
        await updateCustomerTx(editingCustomer, { name, phone, address, notes }, actor);
      } else {
        await createCustomerTx({ name, phone, address, notes }, actor);
      }
      setFormModalOpen(false);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSaving(false);
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !payTarget) return;
    setPaying(true);
    setErrorMsg(null);
    try {
      await createVoucherTx(
        {
          type: 'receipt',
          category: 'سداد دين عميل',
          partyType: 'customer',
          partyId: payTarget.id,
          partyName: payTarget.name,
          amount: Number(payAmount) || 0,
          notes: payNotes || `سداد رصيد العميل ${payTarget.name}`,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setPayTarget(null);
      setPayAmount('');
      setPayNotes('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setPaying(false);
    }
  };

  const statementRecords = useMemo(() => {
    if (!statementCustomer) return [];
    const custSales = sales
      .filter((s) => s.customerId === statementCustomer.id)
      .map((s) => ({
        id: s.id,
        date: s.createdAt,
        ref: s.invoiceNumber,
        desc: `فاتورة مبيعات (${s.items.length} أصناف) · البائع: ${s.employeeName}`,
        debit: s.totalAmount,
        credit: s.paidAmount,
      }));

    const custVouchers = vouchers
      .filter((v) => v.partyType === 'customer' && v.partyId === statementCustomer.id)
      .map((v) => ({
        id: v.id,
        date: v.createdAt,
        ref: v.voucherNumber,
        desc: `${v.category}${v.notes ? ` - ${v.notes}` : ''}`,
        debit: 0,
        credit: v.amount,
      }));

    const custReturns = returns
      .filter((r) => r.customerId === statementCustomer.id)
      .map((r) => ({
        id: r.id,
        date: r.createdAt,
        ref: r.returnNumber,
        desc: `مرتجع على فاتورة ${r.invoiceNumber} (${r.reason})`,
        debit: 0,
        credit: r.debtReduced,
      }));

    return [...custSales, ...custVouchers, ...custReturns].sort(
      (a, b) => (b.date?.toMillis?.() || 0) - (a.date?.toMillis?.() || 0)
    );
  }, [statementCustomer, sales, vouchers, returns]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بكود العميل أو الاسم أو رقم الهاتف..."
              className="w-full pr-10 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyDebtors}
              onChange={(e) => setOnlyDebtors(e.target.checked)}
            />
            <span>العملاء أصحاب المديونية فقط</span>
          </label>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-xs text-slate-500">
            إجمالي ديون العملاء:{' '}
            <span className="font-mono-num font-bold text-rose-700">
              {formatCurrency(totalDebt, currency)}
            </span>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة عميل</span>
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">لا يوجد عملاء مطابقون.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">الكود</th>
                  <th className="py-3 px-4 font-semibold">اسم العميل</th>
                  <th className="py-3 px-4 font-semibold">الهاتف</th>
                  <th className="py-3 px-4 font-semibold">تاريخ التسجيل</th>
                  <th className="py-3 px-4 font-semibold text-left">إجمالي المشتريات</th>
                  <th className="py-3 px-4 font-semibold text-left">المدفوع</th>
                  <th className="py-3 px-4 font-semibold text-left">المتبقي (الدين)</th>
                  <th className="py-3 px-4 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-num font-semibold text-slate-700">
                      {c.code}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      <div>{c.name}</div>
                      {c.address && <div className="text-slate-400">{c.address}</div>}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-slate-600">{c.phone || '—'}</td>
                    <td className="py-3 px-4 font-mono-num text-slate-500">
                      {formatDateOnly(c.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num">
                      {formatCurrency(c.totalPurchases, currency)}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                      {formatCurrency(c.totalPaid, currency)}
                    </td>
                    <td className="py-3 px-4 text-left font-mono-num font-bold">
                      <span className={c.balanceDue > 0 ? 'text-rose-700' : 'text-slate-600'}>
                        {formatCurrency(c.balanceDue, currency)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setStatementCustomer(c)}
                          title="كشف حساب العميل ومشترياته"
                          className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        {c.balanceDue > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayTarget(c);
                              setPayAmount(String(c.balanceDue));
                              setErrorMsg(null);
                            }}
                            title="تسديد دفعة (سند قبض)"
                            className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                          >
                            <Wallet className="w-4 h-4" />
                          </button>
                        )}
                        {canManageCustomers && (
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            title="تعديل"
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                          >
                            <Edit2 className="w-4 h-4" />
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

      {/* Add/Edit Customer Modal */}
      {formModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                {editingCustomer ? `تعديل بيانات ${editingCustomer.name}` : 'تسجيل عميل جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
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
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Debt Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">سند قبض — {payTarget.name}</h3>
              <button
                type="button"
                onClick={() => setPayTarget(null)}
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
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs flex justify-between">
              <span className="text-slate-600">الرصيد المتبقي على العميل</span>
              <span className="font-mono-num font-bold text-rose-700">
                {formatCurrency(payTarget.balanceDue, currency)}
              </span>
            </div>
            <form onSubmit={handlePaymentSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">المبلغ المدفوع *</label>
                <input
                  type="number"
                  required
                  min={0.01}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">بيان / ملاحظات</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="دفعة نقدية من الحساب"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                >
                  {paying ? 'جاري التسجيل...' : 'تأكيد السداد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Account Statement Modal */}
      {statementCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full print-container overflow-hidden my-auto">
            <div className="no-print flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-bold text-slate-900">
                كشف حساب العميل: {statementCustomer.name} ({statementCustomer.code})
              </h3>
              <div className="flex items-center gap-2">
                <a
                  href={buildWhatsAppUrl(
                    statementCustomer.phone,
                    `مرحباً ${statementCustomer.name}،\nملخص حسابكم لدى ${shopSettings?.shopName || 'بقالة الحسام'}:\nإجمالي المشتريات: ${formatCurrency(statementCustomer.totalPurchases, currency)}\nإجمالي المدفوع: ${formatCurrency(statementCustomer.totalPaid, currency)}\nالرصيد المتبقي: ${formatCurrency(statementCustomer.balanceDue, currency)}`
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>إرسال عبر واتساب</span>
                </a>
                <button
                  type="button"
                  onClick={triggerPrint}
                  className="px-3.5 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة / PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatementCustomer(null)}
                  className="p-2 text-slate-500 hover:text-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-4 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <div className="text-slate-500">إجمالي المشتريات</div>
                  <div className="text-base font-bold font-mono-num text-slate-900 mt-0.5">
                    {formatCurrency(statementCustomer.totalPurchases, currency)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">إجمالي المدفوع</div>
                  <div className="text-base font-bold font-mono-num text-emerald-700 mt-0.5">
                    {formatCurrency(statementCustomer.totalPaid, currency)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">الرصيد المتبقي</div>
                  <div className="text-base font-bold font-mono-num text-rose-700 mt-0.5">
                    {formatCurrency(statementCustomer.balanceDue, currency)}
                  </div>
                </div>
              </div>

              {statementRecords.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  لا توجد حركات مسجلة لهذا العميل حتى الآن.
                </div>
              ) : (
                <table className="w-full text-xs text-right border border-slate-200 rounded-lg overflow-hidden">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">التاريخ</th>
                      <th className="py-2.5 px-3 font-semibold">المرجع</th>
                      <th className="py-2.5 px-3 font-semibold">البيان</th>
                      <th className="py-2.5 px-3 font-semibold text-left">مشتريات (مدين)</th>
                      <th className="py-2.5 px-3 font-semibold text-left">دفعات (دائن)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statementRecords.map((rec) => (
                      <tr key={rec.id}>
                        <td className="py-2.5 px-3 font-mono-num text-slate-500 whitespace-nowrap">
                          {formatDateTime(rec.date)}
                        </td>
                        <td className="py-2.5 px-3 font-mono-num font-semibold text-slate-800">
                          {rec.ref}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">{rec.desc}</td>
                        <td className="py-2.5 px-3 text-left font-mono-num text-slate-900">
                          {rec.debit > 0 ? formatCurrency(rec.debit, currency) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-left font-mono-num text-emerald-700">
                          {rec.credit > 0 ? formatCurrency(rec.credit, currency) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
