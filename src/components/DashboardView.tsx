import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpLeft,
  CalendarClock,
  DollarSign,
  Package,
  ReceiptText,
  Scale,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  getExpiryStatus,
  isSameDay,
} from '../lib/formatters';
import { Sale } from '../types/accounting';
import { InvoiceModal } from './InvoiceModal';
import { NavTab } from './Layout';

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const {
    products,
    customers,
    suppliers,
    sales,
    purchases,
    returns,
    vouchers,
    treasury,
    shopSettings,
    auditLogs,
    dataLoading,
  } = useData();

  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const currency = shopSettings?.currency || 'ر.ي';

  const metrics = useMemo(() => {
    const today = new Date();
    const activeSales = sales.filter((s) => s.status !== 'cancelled');
    const todaySales = activeSales.filter((s) => isSameDay(s.createdAt, today));

    const todaySalesTotal = todaySales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    const totalSalesRevenue = activeSales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    const totalGrossProfit = activeSales.reduce((sum, s) => sum + (s.netProfit || 0), 0);

    const totalReturnsAmount = returns.reduce((sum, r) => sum + (r.totalRefund || 0), 0);
    const returnedCostRecovered = returns.reduce(
      (sum, r) =>
        sum +
        r.items.reduce(
          (iSum, it) => iSum + (it.restockable ? it.unitPurchasePrice * it.quantity : 0),
          0
        ),
      0
    );
    const returnsProfitImpact = Math.max(0, totalReturnsAmount - returnedCostRecovered);

    const expenses = vouchers.filter((v) => v.type === 'expense');
    const totalExpenses = expenses.reduce((sum, v) => sum + (v.amount || 0), 0);
    const todayExpenses = expenses
      .filter((v) => isSameDay(v.createdAt, today))
      .reduce((sum, v) => sum + (v.amount || 0), 0);

    const netProfitAfterExpenses =
      totalGrossProfit - returnsProfitImpact - totalExpenses;

    const inventoryCostValue = products.reduce(
      (sum, p) => sum + (p.quantity || 0) * (p.purchasePrice || 0),
      0
    );
    const inventoryRetailValue = products.reduce(
      (sum, p) => sum + (p.quantity || 0) * (p.salePrice || 0),
      0
    );

    const totalReceivables = customers.reduce((sum, c) => sum + Math.max(0, c.balanceDue || 0), 0);
    const totalPayables = suppliers.reduce((sum, s) => sum + Math.max(0, s.balanceDue || 0), 0);

    // Top-selling products
    const productStats = new Map<
      string,
      { code: string; name: string; qty: number; revenue: number }
    >();
    for (const s of activeSales) {
      for (const it of s.items) {
        const cur = productStats.get(it.productId) || {
          code: it.productCode,
          name: it.productName,
          qty: 0,
          revenue: 0,
        };
        cur.qty += it.quantity - (it.returnedQuantity || 0);
        cur.revenue += it.lineTotal;
        productStats.set(it.productId, cur);
      }
    }
    const topProducts = Array.from(productStats.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    // Employee performance
    const empStats = new Map<
      string,
      { name: string; invoices: number; salesTotal: number; todayTotal: number }
    >();
    for (const s of activeSales) {
      const cur = empStats.get(s.employeeId) || {
        name: s.employeeName,
        invoices: 0,
        salesTotal: 0,
        todayTotal: 0,
      };
      cur.invoices += 1;
      cur.salesTotal += s.totalAmount;
      if (isSameDay(s.createdAt, today)) cur.todayTotal += s.totalAmount;
      empStats.set(s.employeeId, cur);
    }
    const employeesActivity = Array.from(empStats.values()).sort(
      (a, b) => b.salesTotal - a.salesTotal
    );

    const lowStockProducts = products
      .filter((p) => p.isActive && p.quantity <= p.minStock)
      .sort((a, b) => a.quantity - b.quantity);

    const expiryAlerts = products
      .filter((p) => p.isActive && p.expiryDate)
      .map((p) => ({ product: p, exp: getExpiryStatus(p.expiryDate) }))
      .filter((x) => x.exp.status === 'expired' || x.exp.status === 'expiring_soon')
      .sort((a, b) => (a.exp.daysLeft ?? 999) - (b.exp.daysLeft ?? 999));

    const damagedStockQty = products.reduce((s, p) => s + (p.damagedQuantity || 0), 0);
    const damagedStockCost = products.reduce(
      (s, p) => s + (p.damagedQuantity || 0) * (p.purchasePrice || 0),
      0
    );

    const totalPurchasesAmount = purchases
      .filter((p) => p.status !== 'cancelled')
      .reduce((s, p) => s + (p.totalAmount || 0), 0);

    return {
      todaySalesTotal,
      todayInvoicesCount: todaySales.length,
      totalSalesRevenue,
      netProfitAfterExpenses,
      totalExpenses,
      todayExpenses,
      inventoryCostValue,
      inventoryRetailValue,
      totalReceivables,
      totalPayables,
      topProducts,
      employeesActivity,
      lowStockProducts,
      expiryAlerts,
      damagedStockQty,
      damagedStockCost,
      totalPurchasesAmount,
    };
  }, [products, customers, suppliers, sales, purchases, returns, vouchers]);

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>مبيعات اليوم</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-slate-900">
            {formatCurrency(metrics.todaySalesTotal, currency)}
          </div>
          <div className="text-xs text-slate-500">
            عدد فواتير اليوم: <span className="font-mono-num font-semibold text-slate-700">{metrics.todayInvoicesCount}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>صافي الأرباح التراكمي</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div
            className={`text-2xl font-bold font-mono-num ${
              metrics.netProfitAfterExpenses >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {formatCurrency(metrics.netProfitAfterExpenses, currency)}
          </div>
          <div className="text-xs text-slate-500">
            بعد خصم التكلفة والخصومات والمرتجعات والمصروفات
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>الديون المستحقة لنا</span>
            <Users className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-amber-700">
            {formatCurrency(metrics.totalReceivables, currency)}
          </div>
          <div className="text-xs text-slate-500">
            إجمالي العملاء: <span className="font-mono-num font-semibold text-slate-700">{customers.length}</span> · للموردين:{' '}
            <span className="font-mono-num">{formatCurrency(metrics.totalPayables, currency)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>قيمة المخزون (تكلفة)</span>
            <Package className="w-4 h-4 text-slate-600" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-slate-900">
            {formatCurrency(metrics.inventoryCostValue, currency)}
          </div>
          <div className="text-xs text-slate-500">
            القيمة البيعية: <span className="font-mono-num">{formatCurrency(metrics.inventoryRetailValue, currency)}</span>
          </div>
        </div>
      </div>

      {/* Secondary Financial Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">رصيد الصندوق النقدي</div>
            <div className="text-lg font-bold font-mono-num text-slate-900 mt-0.5">
              {formatCurrency(treasury?.cashBalance || 0, currency)}
            </div>
          </div>
          <Wallet className="w-5 h-5 text-emerald-600" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">إجمالي المصروفات</div>
            <div className="text-lg font-bold font-mono-num text-rose-700 mt-0.5">
              {formatCurrency(metrics.totalExpenses, currency)}
            </div>
            <div className="text-[11px] text-slate-500 font-mono-num">
              اليوم: {formatCurrency(metrics.todayExpenses, currency)}
            </div>
          </div>
          <ReceiptText className="w-5 h-5 text-rose-500" />
        </div>

        <button
          type="button"
          onClick={() => onNavigate('purchases')}
          className="bg-white border border-slate-200 hover:border-emerald-300 rounded-xl px-5 py-4 flex items-center justify-between text-right transition-colors cursor-pointer"
        >
          <div>
            <div className="text-xs text-slate-500">إجمالي المشتريات</div>
            <div className="text-lg font-bold font-mono-num text-slate-900 mt-0.5">
              {formatCurrency(metrics.totalPurchasesAmount, currency)}
            </div>
            <div className="text-[11px] text-emerald-700">
              {purchases.length} فاتورة شراء
            </div>
          </div>
          <ShoppingBag className="w-5 h-5 text-slate-500" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('accounting')}
          className="bg-white border border-slate-200 hover:border-emerald-300 rounded-xl px-5 py-4 flex items-center justify-between text-right transition-colors cursor-pointer"
        >
          <div>
            <div className="text-xs text-slate-500">إجمالي المبيعات التراكمي</div>
            <div className="text-lg font-bold font-mono-num text-slate-900 mt-0.5">
              {formatCurrency(metrics.totalSalesRevenue, currency)}
            </div>
            <div className="text-[11px] text-emerald-700">
              فتح النظام المحاسبي والقيود ←
            </div>
          </div>
          <Scale className="w-5 h-5 text-emerald-600" />
        </button>
      </div>

      {/* Live Sales Feed + Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">آخر عمليات البيع (مباشر)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                اضغط على أي فاتورة لعرض التفاصيل الكاملة والأصناف والمبالغ
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
            >
              <span>عرض السجل الكامل</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {sales.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-500">لم تُسجل أي عمليات بيع حتى الآن.</p>
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
              >
                فتح نقطة البيع
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">الفاتورة</th>
                    <th className="py-2.5 px-4 font-semibold">البائع</th>
                    <th className="py-2.5 px-4 font-semibold">العميل</th>
                    <th className="py-2.5 px-4 font-semibold text-left">الإجمالي</th>
                    <th className="py-2.5 px-4 font-semibold text-left">المدفوع</th>
                    <th className="py-2.5 px-4 font-semibold text-left">المتبقي</th>
                    <th className="py-2.5 px-4 font-semibold">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.slice(0, 10).map((sale) => (
                    <tr
                      key={sale.id}
                      onClick={() => setSelectedSale(sale)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-900">
                        {sale.invoiceNumber}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{sale.employeeName}</td>
                      <td className="py-2.5 px-4 text-slate-700">{sale.customerName}</td>
                      <td className="py-2.5 px-4 text-left font-mono-num font-semibold text-slate-900">
                        {formatCurrency(sale.totalAmount, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-left font-mono-num text-emerald-700">
                        {formatCurrency(sale.paidAmount, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-left font-mono-num text-rose-700">
                        {formatCurrency(sale.remainingAmount, currency)}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                        {formatDateTime(sale.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Low Stock Alerts & Recent Audit */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <h2 className="font-bold text-slate-900 text-sm">تنبيهات المخزون</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                الجرد
              </button>
            </div>
            {metrics.lowStockProducts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                جميع الأصناف ضمن الحدود الآمنة للمخزون
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {metrics.lowStockProducts.slice(0, 8).map((p) => (
                  <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.name}</div>
                      <div className="font-mono-num text-slate-500">كود: {p.code}</div>
                    </div>
                    <div className="text-left shrink-0">
                      <div
                        className={`font-mono-num font-bold ${
                          p.quantity === 0 ? 'text-rose-700' : 'text-amber-700'
                        }`}
                      >
                        {formatNumber(p.quantity)} {p.unit}
                      </div>
                      <div className="text-slate-400 font-mono-num">الحد: {p.minStock}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-rose-600" />
                <h2 className="font-bold text-slate-900 text-sm">الصلاحية والتالف</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                متابعة الصلاحية
              </button>
            </div>
            {metrics.damagedStockQty > 0 && (
              <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-100 flex items-center justify-between text-xs text-rose-800">
                <span>بضاعة تالفة معزولة عن البيع:</span>
                <span className="font-mono-num font-bold">
                  {formatNumber(metrics.damagedStockQty)} وحدة ({formatCurrency(metrics.damagedStockCost, currency)})
                </span>
              </div>
            )}
            {metrics.expiryAlerts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                لا توجد أصناف منتهية أو قريبة الانتهاء (خلال 30 يوماً)
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {metrics.expiryAlerts.slice(0, 8).map(({ product: p, exp }) => (
                  <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.name}</div>
                      <div className="font-mono-num text-slate-500">انتهاء: {p.expiryDate}</div>
                    </div>
                    <div className="text-left shrink-0">
                      <div
                        className={`font-semibold ${
                          exp.status === 'expired' ? 'text-rose-700' : 'text-amber-700'
                        }`}
                      >
                        {exp.status === 'expired'
                          ? 'منتهي الصلاحية'
                          : `باقي ${exp.daysLeft} يوم`}
                      </div>
                      <div className="text-slate-400 font-mono-num">
                        {formatNumber(p.quantity)} {p.unit}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-bold text-slate-900 text-sm">أحدث العمليات المسجلة</h2>
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                سجل التدقيق
              </button>
            </div>
            {auditLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">لا توجد عمليات بعد</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {auditLogs.slice(0, 6).map((log) => (
                  <div key={log.id} className="px-5 py-3 space-y-1 text-xs">
                    <div className="font-medium text-slate-900">{log.summary}</div>
                    <div className="text-slate-500 flex items-center gap-2">
                      <span>{log.actorName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">{formatDateTime(log.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Products & Staff Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-bold text-slate-900 text-sm">الأصناف الأكثر مبيعاً</h2>
          </div>
          {metrics.topProducts.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">لا توجد بيانات مبيعات بعد</div>
          ) : (
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">الكود</th>
                  <th className="py-2.5 px-4 font-semibold">الصنف</th>
                  <th className="py-2.5 px-4 font-semibold text-left">الكمية المباعة</th>
                  <th className="py-2.5 px-4 font-semibold text-left">إجمالي المبيعات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.topProducts.map((tp) => (
                  <tr key={tp.code}>
                    <td className="py-2.5 px-4 font-mono-num text-slate-600">{tp.code}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{tp.name}</td>
                    <td className="py-2.5 px-4 text-left font-mono-num">{formatNumber(tp.qty)}</td>
                    <td className="py-2.5 px-4 text-left font-mono-num font-semibold text-emerald-700">
                      {formatCurrency(tp.revenue, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-bold text-slate-900 text-sm">نشاط وأداء الموظفين</h2>
          </div>
          {metrics.employeesActivity.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">لا توجد مبيعات مسجلة للموظفين</div>
          ) : (
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">الموظف</th>
                  <th className="py-2.5 px-4 font-semibold text-left">الفواتير</th>
                  <th className="py-2.5 px-4 font-semibold text-left">مبيعات اليوم</th>
                  <th className="py-2.5 px-4 font-semibold text-left">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.employeesActivity.map((emp) => (
                  <tr key={emp.name}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{emp.name}</td>
                    <td className="py-2.5 px-4 text-left font-mono-num">{emp.invoices}</td>
                    <td className="py-2.5 px-4 text-left font-mono-num text-slate-700">
                      {formatCurrency(emp.todayTotal, currency)}
                    </td>
                    <td className="py-2.5 px-4 text-left font-mono-num font-semibold text-slate-900">
                      {formatCurrency(emp.salesTotal, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedSale && (
        <InvoiceModal
          sale={selectedSale}
          shopSettings={shopSettings}
          onClose={() => setSelectedSale(null)}
        />
      )}
    </div>
  );
}
