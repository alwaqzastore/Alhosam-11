import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useData } from '../context/DataContext';
import { exportToExcel, triggerPrint } from '../lib/exportUtils';
import {
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  getExpiryStatus,
  toDate,
} from '../lib/formatters';

type ReportKind =
  | 'sales_daily'
  | 'purchases'
  | 'sale_returns'
  | 'purchase_returns'
  | 'pnl'
  | 'inventory'
  | 'expiry_damaged'
  | 'customers'
  | 'employees'
  | 'debts'
  | 'item_movements';

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ReportsView() {
  const {
    products,
    customers,
    suppliers,
    sales,
    purchases,
    returns,
    purchaseReturns,
    vouchers,
    stockMovements,
    shopSettings,
  } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const [reportKind, setReportKind] = useState<ReportKind>('sales_daily');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedCode, setSelectedCode] = useState('');

  const applyPreset = (preset: 'today' | 'month' | 'year' | 'all') => {
    const now = new Date();
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    if (preset === 'today') {
      const t = toInputDate(now);
      setDateFrom(t);
      setDateTo(t);
      return;
    }
    if (preset === 'month') {
      setDateFrom(toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(toInputDate(now));
      return;
    }
    setDateFrom(toInputDate(new Date(now.getFullYear(), 0, 1)));
    setDateTo(toInputDate(now));
  };

  const inRange = (ts: Parameters<typeof toDate>[0]) => {
    if (!dateFrom && !dateTo) return true;
    const d = toDate(ts);
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      if (d < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (d > to) return false;
    }
    return true;
  };

  const reportData = useMemo(() => {
    const rangedSales = sales.filter((s) => s.status !== 'cancelled' && inRange(s.createdAt));

    if (reportKind === 'sales_daily') {
      return rangedSales.map((s) => ({
        'رقم الفاتورة': s.invoiceNumber,
        التاريخ: formatDateTime(s.createdAt),
        البائع: s.employeeName,
        العميل: s.customerName,
        'الإجمالي الفرعي': s.subtotal,
        الخصم: s.discount,
        الصافي: s.totalAmount,
        المدفوع: s.paidAmount,
        المتبقي: s.remainingAmount,
        الربح: s.netProfit,
      }));
    }

    if (reportKind === 'purchases') {
      return purchases
        .filter((p) => p.status !== 'cancelled' && inRange(p.createdAt))
        .map((p) => ({
          'رقم الفاتورة': p.invoiceNumber,
          التاريخ: formatDateTime(p.createdAt),
          المورد: p.supplierName,
          الموظف: p.employeeName,
          'الإجمالي': p.totalAmount,
          المدفوع: p.paidAmount,
          المتبقي: p.remainingAmount,
          الحالة:
            p.status === 'received'
              ? 'مستلمة'
              : p.status === 'partially_returned'
                ? 'مرتجع جزئي'
                : 'مرتجعة بالكامل',
        }));
    }

    if (reportKind === 'sale_returns') {
      return returns
        .filter((r) => inRange(r.createdAt))
        .map((r) => ({
          'رقم المرتجع': r.returnNumber,
          'رقم الفاتورة': r.invoiceNumber,
          التاريخ: formatDateTime(r.createdAt),
          العميل: r.customerName,
          'الكمية المرتجعة': r.items.reduce((s, it) => s + it.quantity, 0),
          'حالة البضاعة': r.items.every((it) => it.restockable)
            ? 'صالحة (أعيدت للمخزون)'
            : r.items.every((it) => !it.restockable)
              ? 'تالفة (معزولة)'
              : 'مختلطة',
          'إجمالي المرتجع': r.totalRefund,
          'المسترد نقداً': r.cashRefunded,
          'المخصوم من الدين': r.debtReduced,
          السبب: r.reason,
        }));
    }

    if (reportKind === 'purchase_returns') {
      return purchaseReturns
        .filter((pr) => inRange(pr.createdAt))
        .map((pr) => ({
          'رقم المرتجع': pr.returnNumber,
          'فاتورة الشراء': pr.invoiceNumber,
          التاريخ: formatDateTime(pr.createdAt),
          المورد: pr.supplierName,
          'الكمية المرتجعة': pr.items.reduce((s, it) => s + it.quantity, 0),
          'إجمالي المرتجع': pr.totalRefund,
          'المسترد نقداً': pr.cashRefunded,
          'المخصوم من حساب المورد': pr.debtReduced,
          السبب: pr.reason,
        }));
    }

    if (reportKind === 'customers') {
      return customers.map((c) => ({
        'كود العميل': c.code,
        'اسم العميل': c.name,
        الهاتف: c.phone || '—',
        'تاريخ التسجيل': formatDateOnly(c.createdAt),
        'إجمالي المشتريات': c.totalPurchases,
        'إجمالي المدفوع': c.totalPaid,
        'الرصيد المتبقي': c.balanceDue,
      }));
    }

    if (reportKind === 'employees') {
      const map = new Map<
        string,
        { name: string; count: number; total: number; profit: number; paid: number }
      >();
      for (const s of rangedSales) {
        const cur = map.get(s.employeeId) || {
          name: s.employeeName,
          count: 0,
          total: 0,
          profit: 0,
          paid: 0,
        };
        cur.count += 1;
        cur.total += s.totalAmount;
        cur.profit += s.netProfit;
        cur.paid += s.paidAmount;
        map.set(s.employeeId, cur);
      }
      return Array.from(map.values()).map((e) => ({
        'اسم الموظف': e.name,
        'عدد الفواتير': e.count,
        'إجمالي المبيعات': e.total,
        'المبالغ المحصلة': e.paid,
        'صافي ربح المبيعات': e.profit,
      }));
    }

    if (reportKind === 'pnl') {
      const revenue = rangedSales.reduce((s, x) => s + x.totalAmount, 0);
      const cogs = rangedSales.reduce((s, x) => s + x.totalCost, 0);
      const discounts = rangedSales.reduce((s, x) => s + x.discount, 0);
      const rangedReturns = returns.filter((r) => inRange(r.createdAt));
      const returnsTotal = rangedReturns.reduce((s, r) => s + r.totalRefund, 0);
      const recoveredCost = rangedReturns.reduce(
        (s, r) =>
          s + r.items.reduce((is, it) => is + (it.restockable ? it.unitPurchasePrice * it.quantity : 0), 0),
        0
      );
      const expenses = vouchers
        .filter((v) => v.type === 'expense' && inRange(v.createdAt))
        .reduce((s, v) => s + v.amount, 0);
      const net = revenue - returnsTotal - (cogs - recoveredCost) - expenses;

      return [
        { البند: 'إجمالي صافي المبيعات', القيمة: revenue },
        { البند: 'إجمالي الخصومات الممنوحة', القيمة: discounts },
        { البند: 'إجمالي مرتجعات المبيعات', القيمة: returnsTotal },
        { البند: 'صافي تكلفة البضاعة المباعة', القيمة: Math.max(0, cogs - recoveredCost) },
        { البند: 'المصروفات التشغيلية', القيمة: expenses },
        { البند: 'صافي الربح التقديري', القيمة: net },
      ];
    }

    if (reportKind === 'inventory') {
      return products.map((p) => ({
        'كود الصنف': p.code,
        الباركود: p.barcode || '—',
        'اسم الصنف': p.name,
        المستودع: p.warehouseName || 'المستودع الرئيسي',
        'المخزون الصالح': p.quantity,
        'الكمية التالفة': p.damagedQuantity || 0,
        'الحد الأدنى': p.minStock,
        'تاريخ الصلاحية': p.expiryDate || '—',
        'سعر الشراء': p.purchasePrice,
        'سعر البيع': p.salePrice,
        'القيمة بالتكلفة': p.quantity * p.purchasePrice,
      }));
    }

    if (reportKind === 'expiry_damaged') {
      return products
        .filter((p) => p.expiryDate || (p.damagedQuantity || 0) > 0)
        .map((p) => {
          const exp = getExpiryStatus(p.expiryDate);
          return {
            'كود الصنف': p.code,
            'اسم الصنف': p.name,
            المستودع: p.warehouseName || 'المستودع الرئيسي',
            'تاريخ الصلاحية': p.expiryDate || 'غير محدد',
            'حالة الصلاحية':
              exp.status === 'expired'
                ? 'منتهي الصلاحية'
                : exp.status === 'expiring_soon'
                  ? 'قريب الانتهاء'
                  : exp.status === 'ok'
                    ? 'سليم'
                    : '—',
            'الأيام المتبقية': exp.daysLeft ?? '—',
            'المخزون الصالح': p.quantity,
            'الكمية التالفة': p.damagedQuantity || 0,
            'قيمة التالف': (p.damagedQuantity || 0) * p.purchasePrice,
          };
        });
    }

    if (reportKind === 'debts') {
      const custDebts = customers
        .filter((c) => c.balanceDue > 0)
        .map((c) => ({
          النوع: 'عميل (مستحق لنا)',
          الكود: c.code,
          الاسم: c.name,
          الهاتف: c.phone || '—',
          'الرصيد المستحق': c.balanceDue,
        }));
      const supDebts = suppliers
        .filter((s) => s.balanceDue > 0)
        .map((s) => ({
          النوع: 'مورد (مستحق علينا)',
          الكود: s.code,
          الاسم: s.name,
          الهاتف: s.phone || '—',
          'الرصيد المستحق': s.balanceDue,
        }));
      return [...custDebts, ...supDebts];
    }

    // item_movements
    return stockMovements
      .filter((m) => inRange(m.createdAt))
      .filter(
        (m) =>
          !selectedCode ||
          m.productCode.toLowerCase().includes(selectedCode.trim().toLowerCase()) ||
          m.productName.toLowerCase().includes(selectedCode.trim().toLowerCase())
      )
      .map((m) => ({
        التاريخ: formatDateTime(m.createdAt),
        'كود الصنف': m.productCode,
        الصنف: m.productName,
        الحركة: m.type,
        التغير: m.quantityChange,
        'الرصيد قبل': m.previousQty,
        'الرصيد بعد': m.newQty,
        المرجع: m.referenceNumber || '—',
        الموظف: m.employeeName,
      }));
  }, [
    reportKind,
    sales,
    purchases,
    purchaseReturns,
    customers,
    suppliers,
    returns,
    vouchers,
    products,
    stockMovements,
    dateFrom,
    dateTo,
    selectedCode,
  ]);

  const reportTitles: Record<ReportKind, string> = {
    sales_daily: 'تقرير المبيعات',
    purchases: 'تقرير المشتريات',
    sale_returns: 'تقرير مرتجعات المبيعات',
    purchase_returns: 'تقرير مرتجعات المشتريات',
    pnl: 'الأرباح والخسائر',
    inventory: 'جرد وتقييم المخزون',
    expiry_damaged: 'تقرير الصلاحية والتالف',
    customers: 'مشتريات وأرصدة العملاء',
    employees: 'أداء ومبيعات الموظفين',
    debts: 'الديون والمستحقات',
    item_movements: 'حركة الأصناف بالكود',
  };

  const columns = reportData.length > 0 ? Object.keys(reportData[0]) : [];

  const handleExportExcel = () => {
    if (reportData.length === 0) return;
    exportToExcel(reportData, reportTitles[reportKind], `alhosam_report_${reportKind}`);
  };

  return (
    <div className="space-y-4">
      {/* Report Selector & Actions */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(reportTitles) as ReportKind[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setReportKind(key)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                reportKind === key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {reportTitles[key]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => applyPreset('today')}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white rounded cursor-pointer"
              >
                اليوم
              </button>
              <button
                type="button"
                onClick={() => applyPreset('month')}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white rounded cursor-pointer"
              >
                هذا الشهر
              </button>
              <button
                type="button"
                onClick={() => applyPreset('year')}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white rounded cursor-pointer"
              >
                هذه السنة
              </button>
              <button
                type="button"
                onClick={() => applyPreset('all')}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white rounded cursor-pointer"
              >
                الكل
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">من تاريخ</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">إلى تاريخ</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono-num"
              />
            </div>
            {reportKind === 'item_movements' && (
              <div>
                <label className="block text-xs text-slate-500 mb-1">كود الصنف</label>
                <input
                  type="text"
                  value={selectedCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                  placeholder="مثال: ITM-0001"
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={reportData.length === 0}
              onClick={handleExportExcel}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تصدير Excel</span>
            </button>
            <button
              type="button"
              onClick={triggerPrint}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Printable Report Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden print-container">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-900">{reportTitles[reportKind]}</h2>
            <div className="text-xs text-slate-500 mt-0.5">
              {shopSettings?.shopName || 'بقالة الحسام'} · عدد السجلات: {reportData.length}
            </div>
          </div>
          <div className="text-xs text-slate-500 font-mono-num">
            {new Date().toLocaleDateString('ar-EG', { numberingSystem: 'latn' })}
          </div>
        </div>

        {reportData.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            لا توجد بيانات متاحة لهذا التقرير في الفترة المحددة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="py-3 px-4 font-semibold whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportData.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {columns.map((col) => {
                      const val = (row as Record<string, unknown>)[col];
                      const isNum = typeof val === 'number';
                      const isMoney =
                        isNum &&
                        !col.includes('عدد') &&
                        !col.includes('الكمية') &&
                        !col.includes('المخزون الصالح') &&
                        !col.includes('الحد') &&
                        !col.includes('الرصيد قبل') &&
                        !col.includes('الرصيد بعد') &&
                        !col.includes('التغير') &&
                        !col.includes('الأيام');
                      return (
                        <td
                          key={col}
                          className={`py-2.5 px-4 ${isNum ? 'font-mono-num font-medium' : ''}`}
                        >
                          {isMoney
                            ? formatCurrency(val as number, currency)
                            : String(val ?? '—')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
