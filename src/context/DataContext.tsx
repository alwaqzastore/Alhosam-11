import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  Account,
  AuditLog,
  Customer,
  JournalEntry,
  Product,
  Purchase,
  PurchaseReturn,
  Sale,
  SaleReturn,
  ShopSettings,
  StaffInvite,
  StockMovement,
  Stocktake,
  Supplier,
  TreasurySummary,
  UserAccount,
  Voucher,
  Warehouse,
} from '../types/accounting';
import { useAuth } from './AuthContext';

interface DataContextValue {
  warehouses: Warehouse[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: Purchase[];
  returns: SaleReturn[];
  purchaseReturns: PurchaseReturn[];
  accounts: Account[];
  journalEntries: JournalEntry[];
  stockMovements: StockMovement[];
  stocktakes: Stocktake[];
  vouchers: Voucher[];
  users: UserAccount[];
  staffInvites: StaffInvite[];
  auditLogs: AuditLog[];
  shopSettings: ShopSettings | null;
  treasury: TreasurySummary | null;
  dataLoading: boolean;
  isOnline: boolean;
  hasPendingWrites: boolean;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { userAccount, accessDeniedReason } = useAuth();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [treasury, setTreasury] = useState<TreasurySummary | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!userAccount || userAccount.status !== 'active' || accessDeniedReason) {
      setWarehouses([]);
      setProducts([]);
      setCustomers([]);
      setSuppliers([]);
      setSales([]);
      setPurchases([]);
      setReturns([]);
      setPurchaseReturns([]);
      setAccounts([]);
      setJournalEntries([]);
      setStockMovements([]);
      setStocktakes([]);
      setVouchers([]);
      setUsers([]);
      setStaffInvites([]);
      setAuditLogs([]);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    const isAdmin = userAccount.role === 'admin';
    const canViewAllSales = isAdmin || userAccount.permissions?.canViewAllSales;
    const unsubs: (() => void)[] = [];

    const markPending = (key: string, pending: boolean) => {
      setPendingMap((prev) => {
        if (prev[key] === pending) return prev;
        return { ...prev, [key]: pending };
      });
    };

    unsubs.push(
      onSnapshot(
        query(collection(db, 'warehouses'), orderBy('name', 'asc')),
        { includeMetadataChanges: true },
        (snap) => {
          setWarehouses(snap.docs.map((d) => d.data() as Warehouse));
          markPending('warehouses', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'warehouses')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'products'), orderBy('name', 'asc')),
        { includeMetadataChanges: true },
        (snap) => {
          setProducts(snap.docs.map((d) => d.data() as Product));
          markPending('products', snap.metadata.hasPendingWrites);
          setDataLoading(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'products')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'customers'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setCustomers(snap.docs.map((d) => d.data() as Customer));
          markPending('customers', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'suppliers'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setSuppliers(snap.docs.map((d) => d.data() as Supplier));
          markPending('suppliers', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'suppliers')
      )
    );

    const salesQuery = canViewAllSales
      ? query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(500))
      : query(
          collection(db, 'sales'),
          where('employeeId', '==', userAccount.uid),
          limit(300)
        );

    unsubs.push(
      onSnapshot(
        salesQuery,
        { includeMetadataChanges: true },
        (snap) => {
          const list = snap.docs.map((d) => d.data() as Sale);
          list.sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() || 0;
            const tb = b.createdAt?.toMillis?.() || 0;
            return tb - ta;
          });
          setSales(list);
          markPending('sales', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'sales')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'purchases'), orderBy('createdAt', 'desc'), limit(300)),
        { includeMetadataChanges: true },
        (snap) => {
          setPurchases(snap.docs.map((d) => d.data() as Purchase));
          markPending('purchases', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'purchases')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'returns'), orderBy('createdAt', 'desc'), limit(300)),
        { includeMetadataChanges: true },
        (snap) => {
          setReturns(snap.docs.map((d) => d.data() as SaleReturn));
          markPending('returns', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'returns')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'purchase_returns'), orderBy('createdAt', 'desc'), limit(300)),
        { includeMetadataChanges: true },
        (snap) => {
          setPurchaseReturns(snap.docs.map((d) => d.data() as PurchaseReturn));
          markPending('purchase_returns', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'purchase_returns')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'accounts'), orderBy('code', 'asc')),
        { includeMetadataChanges: true },
        (snap) => {
          setAccounts(snap.docs.map((d) => d.data() as Account));
          markPending('accounts', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'accounts')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'journal_entries'), orderBy('createdAt', 'desc'), limit(500)),
        { includeMetadataChanges: true },
        (snap) => {
          setJournalEntries(snap.docs.map((d) => d.data() as JournalEntry));
          markPending('journal_entries', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'journal_entries')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'stock_movements'), orderBy('createdAt', 'desc'), limit(500)),
        { includeMetadataChanges: true },
        (snap) => {
          setStockMovements(snap.docs.map((d) => d.data() as StockMovement));
          markPending('stock_movements', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'stock_movements')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'stocktakes'), orderBy('createdAt', 'desc'), limit(100)),
        { includeMetadataChanges: true },
        (snap) => {
          setStocktakes(snap.docs.map((d) => d.data() as Stocktake));
          markPending('stocktakes', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'stocktakes')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'vouchers'), orderBy('createdAt', 'desc'), limit(500)),
        { includeMetadataChanges: true },
        (snap) => {
          setVouchers(snap.docs.map((d) => d.data() as Voucher));
          markPending('vouchers', snap.metadata.hasPendingWrites);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'vouchers')
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'shop'),
        (snap) => {
          if (snap.exists()) setShopSettings(snap.data() as ShopSettings);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'settings/shop')
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'treasury'),
        (snap) => {
          if (snap.exists()) setTreasury(snap.data() as TreasurySummary);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'settings/treasury')
      )
    );

    if (isAdmin) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'users'), orderBy('createdAt', 'desc')),
          (snap) => setUsers(snap.docs.map((d) => d.data() as UserAccount)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'staffInvites'), orderBy('createdAt', 'desc')),
          (snap) => setStaffInvites(snap.docs.map((d) => d.data() as StaffInvite)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'staffInvites')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(300)),
          (snap) => setAuditLogs(snap.docs.map((d) => d.data() as AuditLog)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs')
        )
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [userAccount?.uid, userAccount?.role, userAccount?.status, userAccount?.permissions?.canViewAllSales, accessDeniedReason]);

  const hasPendingWrites = Object.values(pendingMap).some(Boolean);

  return (
    <DataContext.Provider
      value={{
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
        stockMovements,
        stocktakes,
        vouchers,
        users,
        staffInvites,
        auditLogs,
        shopSettings,
        treasury,
        dataLoading,
        isOnline,
        hasPendingWrites,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
