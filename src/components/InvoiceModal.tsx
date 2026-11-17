import { Printer, X, Share2, Check, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { buildWhatsAppUrl, formatCurrency, formatDateTime } from '../lib/formatters';
import { triggerPrint } from '../lib/exportUtils';
import { Sale, ShopSettings } from '../types/accounting';

interface InvoiceModalProps {
  sale: Sale;
  shopSettings: ShopSettings | null;
  onClose: () => void;
}

export function InvoiceModal({ sale, shopSettings, onClose }: InvoiceModalProps) {
  const [copied, setCopied] = useState(false);
  const currency = shopSettings?.currency || 'ر.ي';
  const shopName = shopSettings?.shopName || 'بقالة الحسام';

  const paymentLabel =
    sale.paymentMethod === 'cash'
      ? 'نقدي'
      : sale.paymentMethod === 'credit'
        ? 'آجل'
        : 'دفع جزئي';

  const statusLabel =
    sale.status === 'completed'
      ? 'مكتملة'
      : sale.status === 'partially_returned'
        ? 'مرتجع جزئي'
        : sale.status === 'returned'
          ? 'مرتجعة بالكامل'
          : 'ملغاة';

  const invoiceMessage = [
    `*${shopName}*`,
    `فاتورة مبيعات رقم: ${sale.invoiceNumber}`,
    `التاريخ: ${formatDateTime(sale.createdAt)}`,
    `العميل: ${sale.customerName}${sale.customerCode ? ` (${sale.customerCode})` : ''}`,
    `--- الأصناف ---`,
    ...sale.items.map(
      (it) =>
        `• ${it.productName} × ${it.quantity} ${it.unit} = ${formatCurrency(it.lineTotal, currency)}`
    ),
    `----------------`,
    `الإجمالي الفرعي: ${formatCurrency(sale.subtotal, currency)}`,
    sale.discount > 0 ? `الخصم: -${formatCurrency(sale.discount, currency)}` : null,
    `*الصافي المطلوب: ${formatCurrency(sale.totalAmount, currency)}*`,
    `المدفوع: ${formatCurrency(sale.paidAmount, currency)}`,
    sale.remainingAmount > 0
      ? `المتبقي (آجل): ${formatCurrency(sale.remainingAmount, currency)}`
      : null,
    shopSettings?.invoiceFooter || 'شكراً لتعاملكم مع بقالة الحسام',
  ]
    .filter(Boolean)
    .join('\n');

  const whatsappHref = buildWhatsAppUrl(sale.customerPhone, invoiceMessage);

  const handleShareText = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `فاتورة ${sale.invoiceNumber}`, text: invoiceMessage });
      } else {
        await navigator.clipboard.writeText(invoiceMessage);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // User dismissed native share dialog
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full print-container overflow-hidden my-auto">
        <div className="no-print flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="font-bold text-slate-900">تفاصيل الفاتورة {sale.invoiceNumber}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
            >
              <MessageCircle className="w-4 h-4" />
              <span>إرسال عبر واتساب</span>
            </a>
            <button
              type="button"
              onClick={handleShareText}
              className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4" />}
              <span>{copied ? 'تم النسخ' : 'نسخ النص'}</span>
            </button>
            <button
              type="button"
              onClick={triggerPrint}
              className="px-3.5 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">{shopName}</h2>
              <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                {shopSettings?.address && <div>{shopSettings.address}</div>}
                {shopSettings?.phone && <div className="font-mono-num">هاتف: {shopSettings.phone}</div>}
                {shopSettings?.taxNumber && <div className="font-mono-num">الرقم الضريبي: {shopSettings.taxNumber}</div>}
              </div>
            </div>
            <div className="text-right sm:text-left space-y-1">
              <div className="text-xs text-slate-500">فاتورة مبيعات</div>
              <div className="text-lg font-bold font-mono-num text-slate-900">{sale.invoiceNumber}</div>
              <div className="text-xs text-slate-500 font-mono-num">{formatDateTime(sale.createdAt)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <div className="text-slate-500">العميل</div>
              <div className="font-semibold text-slate-900 mt-0.5">{sale.customerName}</div>
              {sale.customerCode && (
                <div className="font-mono-num text-slate-500">{sale.customerCode}</div>
              )}
              {sale.customerPhone && (
                <div className="font-mono-num text-slate-500">{sale.customerPhone}</div>
              )}
            </div>
            <div>
              <div className="text-slate-500">البائع المسؤول</div>
              <div className="font-semibold text-slate-900 mt-0.5">{sale.employeeName}</div>
            </div>
            <div>
              <div className="text-slate-500">طريقة الدفع</div>
              <div className="font-semibold text-slate-900 mt-0.5">{paymentLabel}</div>
            </div>
            <div>
              <div className="text-slate-500">حالة الفاتورة</div>
              <div className="font-semibold text-slate-900 mt-0.5">{statusLabel}</div>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">الكود</th>
                  <th className="py-2.5 px-3 font-semibold">الصنف</th>
                  <th className="py-2.5 px-3 font-semibold text-left">الكمية</th>
                  <th className="py-2.5 px-3 font-semibold text-left">سعر الوحدة</th>
                  <th className="py-2.5 px-3 font-semibold text-left">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sale.items.map((item, idx) => (
                  <tr key={`${item.productId}-${idx}`}>
                    <td className="py-2.5 px-3 font-mono-num text-slate-600">{item.productCode}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">
                      {item.productName}
                      {item.returnedQuantity ? (
                        <span className="text-amber-700 mr-2">
                          (مرتجع: {item.returnedQuantity})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono-num">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono-num">
                      {formatCurrency(item.unitSalePrice, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono-num font-semibold text-slate-900">
                      {formatCurrency(item.lineTotal, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 pt-2">
            <div className="text-xs text-slate-500 max-w-xs">
              {sale.notes && <div className="mb-2 text-slate-700">ملاحظات: {sale.notes}</div>}
              <div>{shopSettings?.invoiceFooter || 'شكراً لتعاملكم مع بقالة الحسام'}</div>
            </div>

            <div className="w-full sm:w-64 space-y-2 text-sm border border-slate-200 rounded-lg p-4 bg-slate-50">
              <div className="flex justify-between text-slate-600">
                <span>الإجمالي الفرعي</span>
                <span className="font-mono-num">{formatCurrency(sale.subtotal, currency)}</span>
              </div>
              {sale.discount > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>الخصم</span>
                  <span className="font-mono-num">-{formatCurrency(sale.discount, currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-900 pt-2 border-t border-slate-200">
                <span>صافي الفاتورة</span>
                <span className="font-mono-num">{formatCurrency(sale.totalAmount, currency)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 text-xs">
                <span>المبلغ المدفوع</span>
                <span className="font-mono-num font-semibold">
                  {formatCurrency(sale.paidAmount, currency)}
                </span>
              </div>
              <div className="flex justify-between text-rose-700 text-xs">
                <span>المبلغ المتبقي</span>
                <span className="font-mono-num font-semibold">
                  {formatCurrency(sale.remainingAmount, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
