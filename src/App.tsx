import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/LoginScreen';
import { Layout, NavTab } from './components/Layout';
import { DashboardView } from './components/DashboardView';
import { PosView } from './components/PosView';
import { SalesHistoryView } from './components/SalesHistoryView';
import { ProductsView } from './components/ProductsView';
import { CustomersView } from './components/CustomersView';
import { PurchasesView } from './components/PurchasesView';
import { InventoryView } from './components/InventoryView';
import { FinanceView } from './components/FinanceView';
import { ReportsView } from './components/ReportsView';
import { AdminUsersView } from './components/AdminUsersView';
import { AccountingView } from './components/AccountingView';

function MainShell() {
  const { firebaseUser, userAccount, loading, accessDeniedReason } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('pos');

  useEffect(() => {
    if (userAccount?.role === 'admin') {
      setActiveTab('dashboard');
    } else if (userAccount?.role === 'employee') {
      setActiveTab('pos');
    }
  }, [userAccount?.uid, userAccount?.role]);

  if (loading || !firebaseUser || !userAccount || accessDeniedReason) {
    return <LoginScreen />;
  }

  const isAdmin = userAccount.role === 'admin';
  const perms = userAccount.permissions;

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':
        return isAdmin ? <DashboardView onNavigate={setActiveTab} /> : <PosView />;
      case 'pos':
        return <PosView />;
      case 'sales':
        return <SalesHistoryView />;
      case 'products':
        return <ProductsView />;
      case 'customers':
        return <CustomersView />;
      case 'purchases':
        return isAdmin || perms.canManagePurchases ? <PurchasesView /> : <PosView />;
      case 'inventory':
        return isAdmin || perms.canManageInventory ? <InventoryView /> : <PosView />;
      case 'finance':
        return isAdmin ? <FinanceView /> : <PosView />;
      case 'accounting':
        return isAdmin ? <AccountingView /> : <PosView />;
      case 'reports':
        return isAdmin || perms.canViewReports ? <ReportsView /> : <PosView />;
      case 'admin':
        return isAdmin ? <AdminUsersView /> : <PosView />;
      default:
        return <PosView />;
    }
  };

  return (
    <Layout activeTab={activeTab} onSelectTab={setActiveTab}>
      {renderTab()}
    </Layout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DataProvider>
          <MainShell />
        </DataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
