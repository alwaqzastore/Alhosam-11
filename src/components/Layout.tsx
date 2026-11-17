import React, { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Truck,
  ClipboardList,
  Wallet,
  BookOpen,
  FileBarChart2,
  Shield,
  LogOut,
  Menu,
  X,
  ReceiptText,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { getExpiryStatus } from '../lib/formatters';
import { PWAInstallButton } from './PWAInstallButton';

export type NavTab =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'products'
  | 'customers'
  | 'purchases'
  | 'inventory'
  | 'finance'
  | 'accounting'
  | 'reports'
  | 'admin';

interface LayoutProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  children: React.ReactNode;
}

export function Layout({ activeTab, onSelectTab, children }: LayoutProps) {
  const { userAccount, signOut } = useAuth();
  const { shopSettings, products, isOnline, hasPendingWrites } = useData();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!userAccount) return null;

  const isAdmin = userAccount.role === 'admin';
  const perms = userAccount.permissions;

  const alertProductsCount = products.filter((p) => {
    if (!p.isActive) return false;
    const lowStock = p.quantity <= p.minStock;
    const exp = getExpiryStatus(p.expiryDate);
    return lowStock || exp.status === 'expired' || exp.status === 'expiring_soon';
  }).length;

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
    badge?: number;
  }[] = [
    {
      id: 'dashboard',
      label: 'لوحة التحكم',
      icon: LayoutDashboard,
      visible: isAdmin,
    },
    {
      id: 'pos',
      label: 'نقطة البيع السريعة',
      icon: ShoppingCart,
      visible: true,
    },
    {
      id: 'sales',
      label: 'المبيعات والمرتجعات',
      icon: ReceiptText,
      visible: true,
    },
    {
      id: 'products',
      label: 'المنتجات والصلاحية',
      icon: Package,
      visible: true,
      badge: alertProductsCount > 0 ? alertProductsCount : undefined,
    },
    {
      id: 'customers',
      label: 'العملاء والديون',
      icon: Users,
      visible: true,
    },
    {
      id: 'purchases',
      label: 'المشتريات والموردون',
      icon: Truck,
      visible: isAdmin || perms.canManagePurchases,
    },
    {
      id: 'inventory',
      label: 'المخزون والمستودعات',
      icon: ClipboardList,
      visible: isAdmin || perms.canManageInventory,
    },
    {
      id: 'finance',
      label: 'الصندوق والخزينة',
      icon: Wallet,
      visible: isAdmin,
    },
    {
      id: 'accounting',
      label: 'النظام المحاسبي',
      icon: BookOpen,
      visible: isAdmin,
    },
    {
      id: 'reports',
      label: 'التقارير والتصدير',
      icon: FileBarChart2,
      visible: isAdmin || perms.canViewReports,
    },
    {
      id: 'admin',
      label: 'المستخدمون والنسخ',
      icon: Shield,
      visible: isAdmin,
    },
  ];

  const visibleNav = navItems.filter((item) => item.visible);
  const activeItem = visibleNav.find((n) => n.id === activeTab) || visibleNav[0];

  const handleNavClick = (id: NavTab) => {
    onSelectTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row" dir="rtl">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:right-0 bg-slate-900 text-slate-200 border-l border-slate-800 z-30">
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
          <div className="truncate font-display text-lg font-extrabold text-white">
            {shopSettings?.shopName || 'بقالة الحسام'}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`font-mono-num text-xs px-1.5 py-0.5 rounded ${
                      active ? 'bg-emerald-700 text-white' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="text-xs space-y-0.5">
            <div className="font-semibold text-white truncate">{userAccount.displayName}</div>
            <div className="text-slate-400">
              {isAdmin ? 'المسؤول الرئيسي' : 'موظف / بائع'}
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-slate-900 text-slate-200 flex flex-col h-full z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800">
              <span className="font-display font-bold text-white truncate">
                بقالة الحسام
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2.5 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                      active ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span className="font-mono-num text-xs text-amber-300">{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-800">
              <button
                type="button"
                onClick={signOut}
                className="w-full min-h-[44px] py-2.5 px-3 bg-slate-800 text-slate-200 text-xs font-medium rounded-lg flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pr-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-3 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة"
              className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
              {activeItem?.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {!isOnline && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
                <WifiOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">وضع عدم الاتصال · تُحفظ العمليات محلياً</span>
                <span className="sm:hidden">بدون إنترنت</span>
              </div>
            )}
            {isOnline && hasPendingWrites && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span className="hidden sm:inline">جاري مزامنة عمليات معلقة...</span>
              </div>
            )}
            <PWAInstallButton />
            {activeTab !== 'pos' && (
              <button
                type="button"
                onClick={() => onSelectTab('pos')}
                className="min-h-[40px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>فاتورة بيع</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
