import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'employee';
export type AccountStatus = 'active' | 'suspended';
export type PaymentMethod = 'cash' | 'credit' | 'partial';
export type SaleStatus = 'completed' | 'partially_returned' | 'returned' | 'cancelled';
export type PurchaseStatus = 'received' | 'partially_returned' | 'returned' | 'cancelled';
export type VoucherType = 'receipt' | 'payment' | 'expense';
export type StockMovementType =
  | 'sale'
  | 'purchase'
  | 'return'
  | 'purchase_return'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'stocktake'
  | 'opening'
  | 'warehouse_transfer';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalBalance = 'debit' | 'credit';
export type JournalSourceType =
  | 'sale'
  | 'purchase'
  | 'sale_return'
  | 'purchase_return'
  | 'voucher'
  | 'stock_adjustment'
  | 'manual'
  | 'reversal';

export interface StaffPermissions {
  canDiscount: boolean;
  maxDiscountPercent: number;
  canViewAllSales: boolean;
  canEditPrices: boolean;
  canCancelInvoice: boolean;
  canManagePurchases: boolean;
  canManageInventory: boolean;
  canManageCustomers: boolean;
  canViewReports: boolean;
}

export const DEFAULT_EMPLOYEE_PERMISSIONS: StaffPermissions = {
  canDiscount: false,
  maxDiscountPercent: 0,
  canViewAllSales: false,
  canEditPrices: false,
  canCancelInvoice: false,
  canManagePurchases: false,
  canManageInventory: false,
  canManageCustomers: true,
  canViewReports: false,
};

export const FULL_ADMIN_PERMISSIONS: StaffPermissions = {
  canDiscount: true,
  maxDiscountPercent: 100,
  canViewAllSales: true,
  canEditPrices: true,
  canCancelInvoice: true,
  canManagePurchases: true,
  canManageInventory: true,
  canManageCustomers: true,
  canViewReports: true,
};

export interface UserAccount {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  status: AccountStatus;
  inviteId?: string;
  permissions: StaffPermissions;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt?: Timestamp;
}

export interface StaffInvite {
  id: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  status: AccountStatus;
  permissions: StaffPermissions;
  claimedUid?: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  location?: string;
  isDefault: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Product {
  id: string;
  code: string;
  barcode?: string;
  name: string;
  category?: string;
  description?: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  quantity: number;
  damagedQuantity?: number;
  minStock: number;
  expiryDate?: string;
  warehouseId?: string;
  warehouseName?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  totalPurchases: number;
  totalPaid: number;
  balanceDue: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  totalPurchases: number;
  totalPaid: number;
  balanceDue: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SaleLineItem {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  returnedQuantity?: number;
  unitPurchasePrice: number;
  unitSalePrice: number;
  lineTotal: number;
  lineProfit: number;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  customerId?: string;
  customerCode?: string;
  customerName: string;
  customerPhone?: string;
  employeeId: string;
  employeeName: string;
  items: SaleLineItem[];
  subtotal: number;
  discount: number;
  totalAmount: number;
  totalCost: number;
  netProfit: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PurchaseLineItem {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  returnedQuantity?: number;
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  supplierPhone?: string;
  employeeId: string;
  employeeName: string;
  items: PurchaseLineItem[];
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: PaymentMethod;
  status: PurchaseStatus;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ReturnLineItem {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitSalePrice: number;
  unitPurchasePrice: number;
  refundLineTotal: number;
  restockable: boolean;
}

export interface SaleReturn {
  id: string;
  returnNumber: string;
  saleId: string;
  invoiceNumber: string;
  customerId?: string;
  customerName: string;
  employeeId: string;
  employeeName: string;
  type: 'return' | 'cancel';
  items: ReturnLineItem[];
  totalRefund: number;
  cashRefunded: number;
  debtReduced: number;
  reason: string;
  createdAt: Timestamp;
}

export interface PurchaseReturnLineItem {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitCost: number;
  refundLineTotal: number;
  fromDamaged?: boolean;
}

export interface PurchaseReturn {
  id: string;
  returnNumber: string;
  purchaseId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  employeeId: string;
  employeeName: string;
  items: PurchaseReturnLineItem[];
  totalRefund: number;
  cashRefunded: number;
  debtReduced: number;
  reason: string;
  createdAt: Timestamp;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  balance: number;
  isSystem: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface JournalLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  description: string;
  sourceType: JournalSourceType;
  sourceId?: string;
  sourceNumber?: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  status: 'posted' | 'reversed';
  reversedByEntryId?: string;
  employeeId: string;
  employeeName: string;
  createdAt: Timestamp;
}

export interface StockMovement {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  type: StockMovementType;
  quantityChange: number;
  previousQty: number;
  newQty: number;
  warehouseName?: string;
  referenceId?: string;
  referenceNumber?: string;
  reason?: string;
  employeeId: string;
  employeeName: string;
  createdAt: Timestamp;
}

export interface StocktakeItem {
  productId: string;
  productCode: string;
  productName: string;
  systemQty: number;
  actualQty: number;
  variance: number;
  unitCost: number;
  varianceValue: number;
  reason?: string;
}

export interface Stocktake {
  id: string;
  stocktakeNumber: string;
  employeeId: string;
  employeeName: string;
  items: StocktakeItem[];
  totalVarianceValue: number;
  notes?: string;
  createdAt: Timestamp;
}

export interface Voucher {
  id: string;
  voucherNumber: string;
  type: VoucherType;
  category: string;
  partyType: 'customer' | 'supplier' | 'general';
  partyId?: string;
  partyName?: string;
  amount: number;
  notes?: string;
  employeeId: string;
  employeeName: string;
  createdAt: Timestamp;
}

export interface ShopSettings {
  shopName: string;
  phone?: string;
  address?: string;
  currency: string;
  taxNumber?: string;
  invoiceFooter?: string;
  lowStockDefault?: number;
  updatedAt: Timestamp;
}

export interface TreasurySummary {
  cashBalance: number;
  totalCashIn: number;
  totalCashOut: number;
  updatedAt: Timestamp;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  details?: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  createdAt: Timestamp;
}

export const SUPPORTED_CURRENCIES = [
  { code: 'ر.ي', label: 'الريال اليمني (ر.ي)' },
  { code: 'ر.س', label: 'الريال السعودي (ر.س)' },
  { code: '$', label: 'الدولار الأمريكي ($)' },
  { code: 'د.إ', label: 'الدرهم الإماراتي (د.إ)' },
];

export const STANDARD_ACCOUNTS: {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
}[] = [
  { id: 'ACC_1101', code: '1101', name: 'الصندوق النقدي والخزينة', type: 'asset', normalBalance: 'debit' },
  { id: 'ACC_1102', code: '1102', name: 'ذمم العملاء (المدينون)', type: 'asset', normalBalance: 'debit' },
  { id: 'ACC_1103', code: '1103', name: 'مخزون البضاعة الصالحة', type: 'asset', normalBalance: 'debit' },
  { id: 'ACC_1104', code: '1104', name: 'مخزون البضاعة التالفة', type: 'asset', normalBalance: 'debit' },
  { id: 'ACC_2101', code: '2101', name: 'ذمم الموردين (الدائنون)', type: 'liability', normalBalance: 'credit' },
  { id: 'ACC_3101', code: '3101', name: 'رأس المال والأرصدة الافتتاحية', type: 'equity', normalBalance: 'credit' },
  { id: 'ACC_4101', code: '4101', name: 'إيرادات المبيعات', type: 'revenue', normalBalance: 'credit' },
  { id: 'ACC_4102', code: '4102', name: 'مردودات وخصومات المبيعات', type: 'revenue', normalBalance: 'debit' },
  { id: 'ACC_5101', code: '5101', name: 'تكلفة البضاعة المباعة', type: 'expense', normalBalance: 'debit' },
  { id: 'ACC_5201', code: '5201', name: 'المصروفات التشغيلية والعامة', type: 'expense', normalBalance: 'debit' },
  { id: 'ACC_5202', code: '5202', name: 'خسائر التلف وفروقات الجرد', type: 'expense', normalBalance: 'debit' },
];

export const FIELD_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  CODE_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  MAX_CODE: 64,
  MAX_NAME: 120,
  MAX_PRODUCT_NAME: 160,
  MAX_PHONE: 30,
  MAX_ADDRESS: 250,
  MAX_NOTES: 500,
  MAX_REASON: 300,
};

export const BOOTSTRAPPED_ADMIN_EMAIL = 'alhosamshop2027@gmail.com';
