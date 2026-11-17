import React, { useEffect, useState } from 'react';
import {
  Download,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Upload,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { downloadJsonBackup } from '../lib/exportUtils';
import { formatReadableError } from '../lib/firestoreError';
import { formatDateTime } from '../lib/formatters';
import {
  createStaffInviteTx,
  restoreBackupBatch,
  updateInviteStatusOrPermsTx,
  updateShopSettingsTx,
  updateStaffAccountTx,
} from '../services/accountingService';
import {
  DEFAULT_EMPLOYEE_PERMISSIONS,
  FULL_ADMIN_PERMISSIONS,
  StaffInvite,
  StaffPermissions,
  SUPPORTED_CURRENCIES,
  UserAccount,
  UserRole,
} from '../types/accounting';

const PERM_LABELS: { key: keyof Omit<StaffPermissions, 'maxDiscountPercent'>; label: string }[] = [
  { key: 'canDiscount', label: 'منح خصومات في نقطة البيع' },
  { key: 'canViewAllSales', label: 'الاطلاع على جميع فواتير المبيعات' },
  { key: 'canEditPrices', label: 'تعديل أسعار البيع' },
  { key: 'canCancelInvoice', label: 'إلغاء الفواتير وتسجيل المرتجعات' },
  { key: 'canManagePurchases', label: 'إدارة المشتريات والموردين' },
  { key: 'canManageInventory', label: 'إدارة الأصناف والجرد' },
  { key: 'canManageCustomers', label: 'تعديل بيانات العملاء' },
  { key: 'canViewReports', label: 'الاطلاع على التقارير والتصدير' },
];

export function AdminUsersView() {
  const { userAccount } = useAuth();
  const {
    users,
    staffInvites,
    auditLogs,
    shopSettings,
    warehouses,
    products,
    customers,
    suppliers,
    sales,
    purchases,
    returns,
    purchaseReturns,
    accounts,
    journalEntries,
    vouchers,
  } = useData();

  const [subTab, setSubTab] = useState<'staff' | 'audit' | 'settings' | 'backup'>('staff');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add/Edit Staff Modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editingInvite, setEditingInvite] = useState<StaffInvite | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('employee');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [perms, setPerms] = useState<StaffPermissions>(DEFAULT_EMPLOYEE_PERMISSIONS);
  const [savingStaff, setSavingStaff] = useState(false);

  // Shop Settings Form
  const [shopName, setShopName] = useState(shopSettings?.shopName || 'بقالة الحسام');
  const [currency, setCurrency] = useState(shopSettings?.currency || 'ر.ي');
  const [shopPhone, setShopPhone] = useState(shopSettings?.phone || '');
  const [shopAddress, setShopAddress] = useState(shopSettings?.address || '');
  const [taxNumber, setTaxNumber] = useState(shopSettings?.taxNumber || '');
  const [invoiceFooter, setInvoiceFooter] = useState(
    shopSettings?.invoiceFooter || 'شكراً لتعاملكم معنا - بقالة الحسام'
  );
  const [savingSettings, setSavingSettings] = useState(false);

  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (shopSettings) {
      setShopName(shopSettings.shopName || 'بقالة الحسام');
      setCurrency(shopSettings.currency || 'ر.ي');
      setShopPhone(shopSettings.phone || '');
      setShopAddress(shopSettings.address || '');
      setTaxNumber(shopSettings.taxNumber || '');
      setInvoiceFooter(shopSettings.invoiceFooter || 'شكراً لتعاملكم معنا - بقالة الحسام');
    }
  }, [shopSettings]);

  const openInviteModal = () => {
    setEditingUser(null);
    setEditingInvite(null);
    setEmail('');
    setDisplayName('');
    setPhone('');
    setRole('employee');
    setStatus('active');
    setPerms({ ...DEFAULT_EMPLOYEE_PERMISSIONS });
    setErrorMsg(null);
    setStaffModalOpen(true);
  };

  const openEditUser = (u: UserAccount) => {
    setEditingUser(u);
    setEditingInvite(null);
    setEmail(u.email);
    setDisplayName(u.displayName);
    setPhone(u.phone || '');
    setRole(u.role);
    setStatus(u.status);
    setPerms({ ...u.permissions });
    setErrorMsg(null);
    setStaffModalOpen(true);
  };

  const openEditInvite = (inv: StaffInvite) => {
    setEditingUser(null);
    setEditingInvite(inv);
    setEmail(inv.email);
    setDisplayName(inv.displayName);
    setPhone(inv.phone || '');
    setRole(inv.role);
    setStatus(inv.status);
    setPerms({ ...inv.permissions });
    setErrorMsg(null);
    setStaffModalOpen(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingStaff(true);
    try {
      const actor = {
        uid: userAccount.uid,
        displayName: userAccount.displayName,
        role: userAccount.role,
      };
      const effectivePerms = role === 'admin' ? FULL_ADMIN_PERMISSIONS : perms;
      if (editingUser) {
        await updateStaffAccountTx(
          editingUser,
          { displayName, phone, role, status, permissions: effectivePerms },
          actor
        );
        setSuccessMsg(`تم تحديث حساب الموظف ${displayName} بنجاح.`);
      } else if (editingInvite) {
        await updateInviteStatusOrPermsTx(
          editingInvite,
          { displayName, phone, role, status, permissions: effectivePerms },
          actor
        );
        setSuccessMsg(`تم تحديث دعوة الموظف ${displayName} بنجاح.`);
      } else {
        await createStaffInviteTx(
          { email, displayName, phone, role, permissions: effectivePerms },
          actor
        );
        setSuccessMsg(
          `تمت إضافة الموظف (${email}). يمكنه الآن تسجيل الدخول بحساب Google مباشرة.`
        );
      }
      setStaffModalOpen(false);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingStaff(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setSavingSettings(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateShopSettingsTx(
        {
          shopName,
          currency,
          phone: shopPhone,
          address: shopAddress,
          taxNumber,
          invoiceFooter,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setSuccessMsg('تم حفظ إعدادات المتجر بنجاح.');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDownloadBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      shopSettings,
      warehouses,
      products,
      customers,
      suppliers,
      sales,
      purchases,
      returns,
      purchaseReturns,
      accounts,
      journalEntries,
      vouchers,
    };
    downloadJsonBackup(payload, `alhosam_backup_${new Date().toISOString().slice(0, 10)}`);
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userAccount) return;
    setRestoring(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await restoreBackupBatch(parsed, {
        uid: userAccount.uid,
        displayName: userAccount.displayName,
        role: userAccount.role,
      });
      setSuccessMsg(
        `تمت الاستعادة بنجاح: ${res.productsRestored} صنف، ${res.customersRestored} عميل، ${res.suppliersRestored} مورد، ${res.warehousesRestored} مستودع.`
      );
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  const pendingInvites = staffInvites.filter((inv) => !inv.claimedUid);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('staff')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'staff' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            الموظفون والصلاحيات ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('audit')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            سجل التدقيق الموثق ({auditLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('settings')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'settings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            إعدادات المتجر
          </button>
          <button
            type="button"
            onClick={() => setSubTab('backup')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              subTab === 'backup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            النسخ الاحتياطي والاستعادة
          </button>
        </div>

        {subTab === 'staff' && (
          <button
            type="button"
            onClick={openInviteModal}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة موظف جديد</span>
          </button>
        )}
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

      {subTab === 'staff' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900">
              الحسابات النشطة والموقوفة
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">الاسم</th>
                    <th className="py-3 px-4">البريد الإلكتروني</th>
                    <th className="py-3 px-4">الدور</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4">آخر دخول</th>
                    <th className="py-3 px-4">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.uid}>
                      <td className="py-3 px-4 font-semibold text-slate-900">{u.displayName}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-600">{u.email}</td>
                      <td className="py-3 px-4">
                        {u.role === 'admin' ? 'مسؤول رئيسي' : 'موظف / بائع'}
                      </td>
                      <td className="py-3 px-4">
                        {u.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <UserCheck className="w-3.5 h-3.5" />
                            نشط
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                            <UserX className="w-3.5 h-3.5" />
                            موقوف
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-500">
                        {formatDateTime(u.lastLoginAt)}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => openEditUser(u)}
                          className="text-emerald-700 hover:underline font-medium cursor-pointer"
                        >
                          تعديل الصلاحيات
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pendingInvites.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900">
                دعوات الموظفين بانتظار أول تسجيل دخول
              </div>
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4">الاسم</th>
                    <th className="py-2.5 px-4">البريد الإلكتروني</th>
                    <th className="py-2.5 px-4">الحالة</th>
                    <th className="py-2.5 px-4">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingInvites.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2.5 px-4 font-medium">{inv.displayName}</td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-600">{inv.email}</td>
                      <td className="py-2.5 px-4">
                        {inv.status === 'active' ? 'مفعّلة' : 'موقوفة'}
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => openEditInvite(inv)}
                          className="text-emerald-700 hover:underline cursor-pointer"
                        >
                          تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-sm">
              سجل التدقيق الموثق (للقراءة فقط — غير قابل للتعديل أو الحذف)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">التاريخ والوقت</th>
                  <th className="py-2.5 px-4">المنفّذ</th>
                  <th className="py-2.5 px-4">الدور</th>
                  <th className="py-2.5 px-4">العملية</th>
                  <th className="py-2.5 px-4">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{log.actorName}</td>
                    <td className="py-2.5 px-4">
                      {log.actorRole === 'admin' ? 'مسؤول' : 'موظف'}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-800">{log.summary}</td>
                    <td className="py-2.5 px-4 text-slate-500 max-w-md">{log.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'settings' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-xl space-y-4"
        >
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <SettingsIcon className="w-4 h-4 text-emerald-600" />
            <h3>إعدادات المتجر والفواتير</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">اسم المحل *</label>
              <input
                type="text"
                required
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">العملة المعتمدة *</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
                {!SUPPORTED_CURRENCIES.some((c) => c.code === currency) && (
                  <option value={currency}>{currency}</option>
                )}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">رقم الهاتف</label>
              <input
                type="text"
                value={shopPhone}
                onChange={(e) => setShopPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الرقم الضريبي</label>
              <input
                type="text"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">العنوان</label>
            <input
              type="text"
              value={shopAddress}
              onChange={(e) => setShopAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">تذييل الفاتورة</label>
            <input
              type="text"
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            {savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        </form>
      )}

      {subTab === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="font-bold text-slate-900">تصدير نسخة احتياطية كاملة</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              تنزيل ملف JSON يحتوي على كافة الأصناف، العملاء، الموردين، فواتير المبيعات والمشتريات، المرتجعات، والسندات المالية.
            </p>
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تحميل النسخة الاحتياطية (JSON)</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="font-bold text-slate-900">استعادة الأصناف والعملاء والموردين</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              رفع ملف نسخة احتياطية لاستعادة سجل الأصناف والعملاء والموردين بأمان دون حذف الفواتير القائمة.
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>{restoring ? 'جاري الاستعادة...' : 'اختيار ملف JSON للاستعادة'}</span>
              <input
                type="file"
                accept=".json,application/json"
                disabled={restoring}
                onChange={handleRestoreFile}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {/* Staff Add/Edit Modal */}
      {staffModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                {editingUser || editingInvite ? 'تعديل صلاحيات الموظف' : 'إضافة موظف جديد'}
              </h3>
              <button type="button" onClick={() => setStaffModalOpen(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleSaveStaff} className="space-y-4">
              {!editingUser && !editingInvite && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    البريد الإلكتروني (حساب Google للموظف) *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="employee@gmail.com"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الاسم *</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الدور الوظيفي</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="employee">موظف / بائع</option>
                    <option value="admin">مسؤول (صلاحية كاملة)</option>
                  </select>
                </div>
                {(editingUser || editingInvite) && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">حالة الحساب</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="active">نشط</option>
                      <option value="suspended">موقوف</option>
                    </select>
                  </div>
                )}
              </div>

              {role === 'employee' && (
                <div className="border border-slate-200 rounded-lg p-4 space-y-2.5 bg-slate-50">
                  <div className="text-xs font-bold text-slate-800">صلاحيات الموظف المسموحة</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PERM_LABELS.map((item) => (
                      <label
                        key={item.key}
                        className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(perms[item.key])}
                          onChange={(e) =>
                            setPerms((prev) => ({ ...prev, [item.key]: e.target.checked }))
                          }
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                  {perms.canDiscount && (
                    <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                      <span>الحد الأقصى لنسبة الخصم %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={perms.maxDiscountPercent}
                        onChange={(e) =>
                          setPerms((prev) => ({
                            ...prev,
                            maxDiscountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-20 px-2 py-1 border border-slate-300 rounded font-mono-num bg-white"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStaffModalOpen(false)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingStaff}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                >
                  {savingStaff ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
