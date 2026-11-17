import {
  collection,
  doc,
  DocumentReference,
  DocumentSnapshot,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp,
  Transaction,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { generateDocId, sanitizeCode } from '../lib/formatters';
import {
  Account,
  AccountType,
  AuditLog,
  Customer,
  JournalEntry,
  JournalLine,
  JournalSourceType,
  NormalBalance,
  PaymentMethod,
  Product,
  Purchase,
  PurchaseLineItem,
  PurchaseReturn,
  PurchaseReturnLineItem,
  ReturnLineItem,
  Sale,
  SaleLineItem,
  SaleReturn,
  ShopSettings,
  StaffInvite,
  StaffPermissions,
  STANDARD_ACCOUNTS,
  StockMovement,
  StockMovementType,
  Stocktake,
  StocktakeItem,
  Supplier,
  UserAccount,
  UserRole,
  Voucher,
  VoucherType,
  Warehouse,
} from '../types/accounting';

export interface ActorContext {
  uid: string;
  displayName: string;
  role: UserRole;
}

function makeAuditEntry(
  actor: ActorContext,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  details?: string
) {
  const id = generateDocId('AUD');
  const data: Record<string, unknown> = {
    id,
    action: action.slice(0, 64),
    entityType: entityType.slice(0, 64),
    entityId: entityId.slice(0, 128),
    summary: summary.slice(0, 300),
    actorId: actor.uid,
    actorName: actor.displayName.slice(0, 100),
    actorRole: actor.role,
    createdAt: serverTimestamp(),
  };
  if (details && details.trim()) {
    data.details = details.trim().slice(0, 1000);
  }
  return { ref: doc(db, 'audit_logs', id), data };
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ============================================================================
// STANDARD ACCOUNTS & DEFAULT WAREHOUSE SEEDING + DOUBLE-ENTRY JOURNAL ENGINE
// ============================================================================
export async function ensureStandardAccountsAndWarehouse(actor: ActorContext): Promise<void> {
  try {
    const [whSnap, accSnap] = await Promise.all([
      getDocs(collection(db, 'warehouses')),
      getDocs(collection(db, 'accounts')),
    ]);

    const batch = writeBatch(db);
    let ops = 0;

    if (whSnap.empty) {
      batch.set(doc(db, 'warehouses', 'WH_MAIN'), {
        id: 'WH_MAIN',
        code: 'WH-01',
        name: 'المستودع الرئيسي',
        location: 'المقر الرئيسي - بقالة الحسام',
        isDefault: true,
        isActive: true,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops++;
    }

    const existingAccIds = new Set(accSnap.docs.map((d) => d.id));
    for (const std of STANDARD_ACCOUNTS) {
      if (!existingAccIds.has(std.id)) {
        batch.set(doc(db, 'accounts', std.id), {
          id: std.id,
          code: std.code,
          name: std.name,
          type: std.type,
          normalBalance: std.normalBalance,
          balance: 0,
          isSystem: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ops++;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }
  } catch {
    // Silent fallback — transactions also lazily initialize any missing standard account
  }
}

interface JournalReadContext {
  counterRef: DocumentReference;
  counterSnap: DocumentSnapshot;
  accountSnaps: Map<string, DocumentSnapshot>;
}

async function readJournalContext(
  tx: Transaction,
  accountIds: string[]
): Promise<JournalReadContext> {
  const uniqueIds = Array.from(new Set(accountIds));
  const counterRef = doc(db, 'counters', 'journal_entries');
  const [counterSnap, ...accSnaps] = await Promise.all([
    tx.get(counterRef),
    ...uniqueIds.map((id) => tx.get(doc(db, 'accounts', id))),
  ]);
  const accountSnaps = new Map<string, DocumentSnapshot>();
  uniqueIds.forEach((id, idx) => {
    accountSnaps.set(id, accSnaps[idx]);
  });
  return { counterRef, counterSnap, accountSnaps };
}

function postJournalEntryInTx(
  tx: Transaction,
  jCtx: JournalReadContext,
  opts: {
    description: string;
    sourceType: JournalSourceType;
    sourceId?: string;
    sourceNumber?: string;
    rawLines: { accountId: string; debit: number; credit: number }[];
    actor: ActorContext;
  }
): JournalEntry | null {
  // Merge lines with the same accountId & filter zero lines
  const grouped = new Map<string, { debit: number; credit: number }>();
  for (const l of opts.rawLines) {
    const d = Math.max(0, roundMoney(l.debit));
    const c = Math.max(0, roundMoney(l.credit));
    if (d === 0 && c === 0) continue;
    const prev = grouped.get(l.accountId) || { debit: 0, credit: 0 };
    grouped.set(l.accountId, {
      debit: roundMoney(prev.debit + d),
      credit: roundMoney(prev.credit + c),
    });
  }

  const lines: JournalLine[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const [accountId, vals] of grouped.entries()) {
    const snap = jCtx.accountSnaps.get(accountId);
    const stdDef = STANDARD_ACCOUNTS.find((s) => s.id === accountId);
    const accData = snap?.exists()
      ? (snap.data() as Account)
      : stdDef
        ? {
            id: stdDef.id,
            code: stdDef.code,
            name: stdDef.name,
            type: stdDef.type,
            normalBalance: stdDef.normalBalance,
            balance: 0,
            isSystem: true,
          }
        : null;

    if (!accData) {
      throw new Error(`الحساب المحاسبي غير موجود: ${accountId}`);
    }

    totalDebit = roundMoney(totalDebit + vals.debit);
    totalCredit = roundMoney(totalCredit + vals.credit);

    lines.push({
      accountId: accData.id,
      accountCode: accData.code,
      accountName: accData.name,
      debit: vals.debit,
      credit: vals.credit,
    });
  }

  if (lines.length < 2 || totalDebit <= 0 || totalCredit <= 0) {
    return null;
  }

  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(
      `القيد المحاسبي غير متوازن (مدين: ${totalDebit} ، دائن: ${totalCredit}).`
    );
  }
  // Ensure strict equality for Firestore rules `data.totalDebit == data.totalCredit`
  if (totalDebit !== totalCredit) {
    const diff = roundMoney(totalDebit - totalCredit);
    const creditLine = lines.find((l) => l.credit > 0);
    if (creditLine) {
      creditLine.credit = roundMoney(creditLine.credit + diff);
      totalCredit = totalDebit;
    }
  }

  const nextSeq = jCtx.counterSnap.exists()
    ? Number(jCtx.counterSnap.data()?.seq || 0) + 1
    : 1;
  const entryNumber = `JRN-${String(nextSeq).padStart(5, '0')}`;
  const entryId = generateDocId('JRN');

  if (jCtx.counterSnap.exists()) {
    tx.update(jCtx.counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
  } else {
    tx.set(jCtx.counterRef, { seq: nextSeq, prefix: 'JRN', updatedAt: serverTimestamp() });
  }

  // Update each affected account balance
  for (const line of lines) {
    const accRef = doc(db, 'accounts', line.accountId);
    const snap = jCtx.accountSnaps.get(line.accountId);
    const stdDef = STANDARD_ACCOUNTS.find((s) => s.id === line.accountId);

    if (snap && snap.exists()) {
      const cur = snap.data() as Account;
      const delta =
        cur.normalBalance === 'debit'
          ? roundMoney(line.debit - line.credit)
          : roundMoney(line.credit - line.debit);
      tx.update(accRef, {
        balance: roundMoney((cur.balance || 0) + delta),
        updatedAt: serverTimestamp(),
      });
    } else if (stdDef) {
      const delta =
        stdDef.normalBalance === 'debit'
          ? roundMoney(line.debit - line.credit)
          : roundMoney(line.credit - line.debit);
      tx.set(accRef, {
        id: stdDef.id,
        code: stdDef.code,
        name: stdDef.name,
        type: stdDef.type,
        normalBalance: stdDef.normalBalance,
        balance: delta,
        isSystem: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  const entryPayload: Record<string, unknown> = {
    id: entryId,
    entryNumber,
    description: opts.description.trim().slice(0, 300),
    sourceType: opts.sourceType,
    lines,
    totalDebit,
    totalCredit,
    status: 'posted',
    employeeId: opts.actor.uid,
    employeeName: opts.actor.displayName.slice(0, 100),
    createdAt: serverTimestamp(),
  };
  if (opts.sourceId) entryPayload.sourceId = opts.sourceId;
  if (opts.sourceNumber) entryPayload.sourceNumber = opts.sourceNumber;

  tx.set(doc(db, 'journal_entries', entryId), entryPayload);

  return {
    ...(entryPayload as unknown as JournalEntry),
    createdAt: Timestamp.now(),
  };
}

// ============================================================================
// WAREHOUSES
// ============================================================================
export interface WarehouseInput {
  code?: string;
  name: string;
  location?: string;
  isDefault?: boolean;
}

export async function createWarehouseTx(
  input: WarehouseInput,
  actor: ActorContext
): Promise<Warehouse> {
  const warehouseId = generateDocId('WH');
  let built!: Warehouse;
  try {
    await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'counters', 'warehouses');
      const counterSnap = await tx.get(counterRef);
      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 2;
      const code = input.code?.trim()
        ? sanitizeCode(input.code)
        : `WH-${String(nextSeq).padStart(2, '0')}`;
      if (!code) throw new Error('كود المستودع غير صالح.');

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'WH', updatedAt: serverTimestamp() });
      }

      const payload: Record<string, unknown> = {
        id: warehouseId,
        code: code.slice(0, 32),
        name: input.name.trim().slice(0, 100),
        isDefault: Boolean(input.isDefault),
        isActive: true,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.location?.trim()) payload.location = input.location.trim().slice(0, 200);

      tx.set(doc(db, 'warehouses', warehouseId), payload);

      const audit = makeAuditEntry(
        actor,
        'CREATE_WAREHOUSE',
        'warehouses',
        warehouseId,
        `إضافة مستودع جديد: ${payload.name} (${code})`
      );
      tx.set(audit.ref, audit.data);

      built = {
        ...(payload as unknown as Warehouse),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
    });
    return built;
  } catch (err) {
    if (err instanceof Error && err.message.includes('كود')) throw err;
    handleFirestoreError(err, OperationType.CREATE, `warehouses/${warehouseId}`);
  }
}

export async function transferProductWarehouseTx(
  product: Product,
  targetWarehouse: Warehouse,
  notes: string,
  actor: ActorContext
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, 'products', product.id);
      const prodSnap = await tx.get(prodRef);
      if (!prodSnap.exists()) throw new Error('الصنف غير موجود.');
      const cur = prodSnap.data() as Product;

      tx.update(prodRef, {
        warehouseId: targetWarehouse.id,
        warehouseName: targetWarehouse.name,
        updatedAt: serverTimestamp(),
      });

      const movId = generateDocId('MOV');
      tx.set(doc(db, 'stock_movements', movId), {
        id: movId,
        productId: cur.id,
        productCode: cur.code,
        productName: cur.name,
        type: 'warehouse_transfer' as StockMovementType,
        quantityChange: 0,
        previousQty: cur.quantity,
        newQty: cur.quantity,
        warehouseName: targetWarehouse.name,
        referenceId: targetWarehouse.id,
        referenceNumber: targetWarehouse.code,
        reason:
          notes.trim().slice(0, 300) ||
          `نقل الصنف إلى مستودع (${targetWarehouse.name})`,
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        createdAt: serverTimestamp(),
      });

      const audit = makeAuditEntry(
        actor,
        'TRANSFER_WAREHOUSE',
        'products',
        cur.id,
        `نقل الصنف ${cur.name} (${cur.code}) إلى ${targetWarehouse.name}`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `products/${product.id}`);
  }
}

// ============================================================================
// PRODUCTS & UNIQUE SKU CODES (WITH EXPIRY & WAREHOUSES & DELETE)
// ============================================================================
export interface ProductInput {
  code?: string;
  barcode?: string;
  name: string;
  category?: string;
  description?: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  quantity: number;
  minStock: number;
  expiryDate?: string;
  warehouseId?: string;
  warehouseName?: string;
  isActive: boolean;
}

export async function createProductTx(input: ProductInput, actor: ActorContext): Promise<string> {
  const productId = generateDocId('PRD');
  try {
    await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'counters', 'products');
      const counterSnap = await tx.get(counterRef);
      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;

      const rawCode = input.code?.trim()
        ? sanitizeCode(input.code)
        : `ITM-${String(nextSeq).padStart(4, '0')}`;
      if (!rawCode) {
        throw new Error('يرجى إدخال كود صنف صالح باستخدام الأحرف الإنجليزية والأرقام.');
      }

      const codeLockRef = doc(db, 'productCodes', rawCode);
      const codeLockSnap = await tx.get(codeLockRef);
      if (codeLockSnap.exists()) {
        throw new Error(`كود الصنف (${rawCode}) مستخدم بالفعل لصنف آخر. يرجى اختيار كود مختلف.`);
      }

      const openingQty = Math.max(0, Number(input.quantity) || 0);
      const unitPurchase = Math.max(0, roundMoney(input.purchasePrice));
      const openingValue = roundMoney(openingQty * unitPurchase);

      const jCtx =
        openingValue > 0
          ? await readJournalContext(tx, ['ACC_1103', 'ACC_3101'])
          : null;

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'ITM', updatedAt: serverTimestamp() });
      }

      const productRef = doc(db, 'products', productId);
      const productPayload: Record<string, unknown> = {
        id: productId,
        code: rawCode,
        name: input.name.trim().slice(0, 160),
        unit: (input.unit || 'قطعة').trim().slice(0, 32),
        purchasePrice: unitPurchase,
        salePrice: Math.max(0, roundMoney(input.salePrice)),
        quantity: openingQty,
        damagedQuantity: 0,
        minStock: Math.max(0, Number(input.minStock) || 0),
        isActive: Boolean(input.isActive),
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.barcode?.trim()) productPayload.barcode = input.barcode.trim().slice(0, 64);
      if (input.category?.trim()) productPayload.category = input.category.trim().slice(0, 80);
      if (input.description?.trim()) productPayload.description = input.description.trim().slice(0, 500);
      if (input.expiryDate?.trim()) productPayload.expiryDate = input.expiryDate.trim().slice(0, 20);
      if (input.warehouseId?.trim()) productPayload.warehouseId = input.warehouseId.trim().slice(0, 128);
      if (input.warehouseName?.trim()) productPayload.warehouseName = input.warehouseName.trim().slice(0, 100);

      tx.set(codeLockRef, {
        code: rawCode,
        productId,
        createdAt: serverTimestamp(),
      });
      tx.set(productRef, productPayload);

      if (openingQty > 0) {
        const movId = generateDocId('MOV');
        tx.set(doc(db, 'stock_movements', movId), {
          id: movId,
          productId,
          productCode: rawCode,
          productName: productPayload.name,
          type: 'opening' as StockMovementType,
          quantityChange: openingQty,
          previousQty: 0,
          newQty: openingQty,
          warehouseName: input.warehouseName?.trim() || 'المستودع الرئيسي',
          referenceId: productId,
          referenceNumber: rawCode,
          reason: 'رصيد افتتاحي عند إضافة الصنف',
          employeeId: actor.uid,
          employeeName: actor.displayName.slice(0, 100),
          createdAt: serverTimestamp(),
        });
      }

      if (jCtx && openingValue > 0) {
        postJournalEntryInTx(tx, jCtx, {
          description: `قيد رصيد افتتاحي للصنف: ${productPayload.name} (${rawCode})`,
          sourceType: 'stock_adjustment',
          sourceId: productId,
          sourceNumber: rawCode,
          rawLines: [
            { accountId: 'ACC_1103', debit: openingValue, credit: 0 },
            { accountId: 'ACC_3101', debit: 0, credit: openingValue },
          ],
          actor,
        });
      }

      const audit = makeAuditEntry(
        actor,
        'CREATE_PRODUCT',
        'products',
        productId,
        `إضافة صنف جديد: ${productPayload.name} (${rawCode})`,
        `سعر البيع: ${productPayload.salePrice} | الكمية: ${openingQty}`
      );
      tx.set(audit.ref, audit.data);
    });
    return productId;
  } catch (err) {
    if (err instanceof Error && err.message.includes('كود الصنف')) throw err;
    handleFirestoreError(err, OperationType.WRITE, `products/${productId}`);
  }
}

export async function updateProductTx(
  existing: Product,
  updates: Partial<ProductInput>,
  actor: ActorContext
): Promise<void> {
  const path = `products/${existing.id}`;
  try {
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, 'products', existing.id);
      const snap = await tx.get(prodRef);
      if (!snap.exists()) throw new Error('الصنف غير موجود.');
      const curData = snap.data() as Product;

      const nextCode = updates.code !== undefined ? sanitizeCode(updates.code) : existing.code;
      if (!nextCode) throw new Error('كود الصنف غير صالح.');

      if (nextCode !== existing.code) {
        const newLockRef = doc(db, 'productCodes', nextCode);
        const newLockSnap = await tx.get(newLockRef);
        if (newLockSnap.exists()) {
          throw new Error(`كود الصنف (${nextCode}) مستخدم بالفعل لصنف آخر.`);
        }
        tx.set(newLockRef, {
          code: nextCode,
          productId: existing.id,
          createdAt: serverTimestamp(),
        });
        tx.delete(doc(db, 'productCodes', existing.code));
      }

      const payload: Record<string, unknown> = {
        id: existing.id,
        code: nextCode,
        name: (updates.name ?? existing.name).trim().slice(0, 160),
        unit: (updates.unit ?? existing.unit).trim().slice(0, 32),
        purchasePrice: Math.max(0, roundMoney(updates.purchasePrice ?? existing.purchasePrice)),
        salePrice: Math.max(0, roundMoney(updates.salePrice ?? existing.salePrice)),
        quantity: curData.quantity,
        damagedQuantity: curData.damagedQuantity || 0,
        minStock: Math.max(0, Number(updates.minStock ?? existing.minStock)),
        isActive: updates.isActive ?? existing.isActive,
        createdBy: existing.createdBy,
        createdAt: existing.createdAt,
        updatedAt: serverTimestamp(),
      };
      const barcode = updates.barcode !== undefined ? updates.barcode : existing.barcode;
      const category = updates.category !== undefined ? updates.category : existing.category;
      const description = updates.description !== undefined ? updates.description : existing.description;
      const expiryDate = updates.expiryDate !== undefined ? updates.expiryDate : existing.expiryDate;
      const warehouseId = updates.warehouseId !== undefined ? updates.warehouseId : existing.warehouseId;
      const warehouseName = updates.warehouseName !== undefined ? updates.warehouseName : existing.warehouseName;

      if (barcode?.trim()) payload.barcode = barcode.trim().slice(0, 64);
      if (category?.trim()) payload.category = category.trim().slice(0, 80);
      if (description?.trim()) payload.description = description.trim().slice(0, 500);
      if (expiryDate?.trim()) payload.expiryDate = expiryDate.trim().slice(0, 20);
      if (warehouseId?.trim()) payload.warehouseId = warehouseId.trim().slice(0, 128);
      if (warehouseName?.trim()) payload.warehouseName = warehouseName.trim().slice(0, 100);

      tx.set(prodRef, payload);

      const audit = makeAuditEntry(
        actor,
        'UPDATE_PRODUCT',
        'products',
        existing.id,
        `تحديث بيانات الصنف: ${payload.name} (${nextCode})`,
        `سعر الشراء: ${payload.purchasePrice} | سعر البيع: ${payload.salePrice}`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (err instanceof Error && (err.message.includes('كود الصنف') || err.message.includes('غير موجود'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteProductTx(product: Product, actor: ActorContext): Promise<void> {
  const path = `products/${product.id}`;
  try {
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, 'products', product.id);
      const prodSnap = await tx.get(prodRef);
      if (!prodSnap.exists()) throw new Error('الصنف غير موجود.');

      const codeLockRef = doc(db, 'productCodes', product.code);
      const codeSnap = await tx.get(codeLockRef);

      tx.delete(prodRef);
      if (codeSnap.exists()) {
        tx.delete(codeLockRef);
      }

      const audit = makeAuditEntry(
        actor,
        'DELETE_PRODUCT',
        'products',
        product.id,
        `حذف الصنف: ${product.name} (${product.code})`,
        `الكمية وقت الحذف: ${product.quantity} | التالف: ${product.damagedQuantity || 0}`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// CUSTOMERS & SUPPLIERS
// ============================================================================
export interface PartyInput {
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export async function createCustomerTx(input: PartyInput, actor: ActorContext): Promise<Customer> {
  const customerId = generateDocId('CUS');
  let generatedCode = '';
  try {
    await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'counters', 'customers');
      const counterSnap = await tx.get(counterRef);
      const seq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      generatedCode = `CUS-${String(seq).padStart(4, '0')}`;

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq, prefix: 'CUS', updatedAt: serverTimestamp() });
      }

      const payload: Record<string, unknown> = {
        id: customerId,
        code: generatedCode,
        name: input.name.trim().slice(0, 120),
        totalPurchases: 0,
        totalPaid: 0,
        balanceDue: 0,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.phone?.trim()) payload.phone = input.phone.trim().slice(0, 30);
      if (input.address?.trim()) payload.address = input.address.trim().slice(0, 250);
      if (input.notes?.trim()) payload.notes = input.notes.trim().slice(0, 500);

      tx.set(doc(db, 'customers', customerId), payload);

      const audit = makeAuditEntry(
        actor,
        'CREATE_CUSTOMER',
        'customers',
        customerId,
        `تسجيل عميل جديد: ${payload.name} (${generatedCode})`
      );
      tx.set(audit.ref, audit.data);
    });

    return {
      id: customerId,
      code: generatedCode,
      name: input.name.trim(),
      phone: input.phone?.trim(),
      address: input.address?.trim(),
      notes: input.notes?.trim(),
      totalPurchases: 0,
      totalPaid: 0,
      balanceDue: 0,
      createdBy: actor.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `customers/${customerId}`);
  }
}

export async function updateCustomerTx(
  customer: Customer,
  input: PartyInput,
  actor: ActorContext
): Promise<void> {
  const path = `customers/${customer.id}`;
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'customers', customer.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('العميل غير موجود.');
      const cur = snap.data();

      const payload: Record<string, unknown> = {
        id: customer.id,
        code: cur.code,
        name: input.name.trim().slice(0, 120),
        totalPurchases: cur.totalPurchases,
        totalPaid: cur.totalPaid,
        balanceDue: cur.balanceDue,
        createdBy: cur.createdBy,
        createdAt: cur.createdAt,
        updatedAt: serverTimestamp(),
      };
      if (input.phone?.trim()) payload.phone = input.phone.trim().slice(0, 30);
      if (input.address?.trim()) payload.address = input.address.trim().slice(0, 250);
      if (input.notes?.trim()) payload.notes = input.notes.trim().slice(0, 500);

      tx.set(ref, payload);

      const audit = makeAuditEntry(
        actor,
        'UPDATE_CUSTOMER',
        'customers',
        customer.id,
        `تعديل بيانات العميل: ${payload.name} (${cur.code})`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createSupplierTx(input: PartyInput, actor: ActorContext): Promise<Supplier> {
  const supplierId = generateDocId('SUP');
  let generatedCode = '';
  try {
    await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'counters', 'suppliers');
      const counterSnap = await tx.get(counterRef);
      const seq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      generatedCode = `SUP-${String(seq).padStart(4, '0')}`;

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq, prefix: 'SUP', updatedAt: serverTimestamp() });
      }

      const payload: Record<string, unknown> = {
        id: supplierId,
        code: generatedCode,
        name: input.name.trim().slice(0, 120),
        totalPurchases: 0,
        totalPaid: 0,
        balanceDue: 0,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.phone?.trim()) payload.phone = input.phone.trim().slice(0, 30);
      if (input.address?.trim()) payload.address = input.address.trim().slice(0, 250);
      if (input.notes?.trim()) payload.notes = input.notes.trim().slice(0, 500);

      tx.set(doc(db, 'suppliers', supplierId), payload);

      const audit = makeAuditEntry(
        actor,
        'CREATE_SUPPLIER',
        'suppliers',
        supplierId,
        `إضافة مورد جديد: ${payload.name} (${generatedCode})`
      );
      tx.set(audit.ref, audit.data);
    });

    return {
      id: supplierId,
      code: generatedCode,
      name: input.name.trim(),
      phone: input.phone?.trim(),
      address: input.address?.trim(),
      notes: input.notes?.trim(),
      totalPurchases: 0,
      totalPaid: 0,
      balanceDue: 0,
      createdBy: actor.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `suppliers/${supplierId}`);
  }
}

// ============================================================================
// POINT OF SALE (ATOMIC TRANSACTION + DOUBLE-ENTRY JOURNAL)
// ============================================================================
export interface CreateSaleInput {
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  items: { productId: string; quantity: number; unitSalePrice: number }[];
  discount: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  notes?: string;
}

export async function createSaleTx(input: CreateSaleInput, actor: ActorContext): Promise<Sale> {
  const saleId = generateDocId('SAL');
  let createdInvoiceNumber = '';
  let builtSale!: Sale;

  try {
    await runTransaction(db, async (tx) => {
      if (input.items.length === 0) throw new Error('الفاتورة فارغة، أضف صنفاً واحداً على الأقل.');
      if (input.items.length > 100) throw new Error('الحد الأقصى للأصناف في الفاتورة الواحدة 100 صنف.');

      // 1. ALL READS FIRST
      const counterRef = doc(db, 'counters', 'sales');
      const counterSnap = await tx.get(counterRef);

      const treasuryRef = doc(db, 'settings', 'treasury');
      const treasurySnap = await tx.get(treasuryRef);

      let customerSnap = null;
      const customerRef = input.customerId ? doc(db, 'customers', input.customerId) : null;
      if (customerRef) {
        customerSnap = await tx.get(customerRef);
        if (!customerSnap.exists()) {
          throw new Error('العميل المحدد غير موجود في قاعدة البيانات.');
        }
      }

      const productSnaps = await Promise.all(
        input.items.map((item) => tx.get(doc(db, 'products', item.productId)))
      );

      const jCtx = await readJournalContext(tx, [
        'ACC_1101',
        'ACC_1102',
        'ACC_1103',
        'ACC_4101',
        'ACC_4102',
        'ACC_5101',
      ]);

      // 2. VALIDATIONS & CALCULATIONS
      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      createdInvoiceNumber = `INV-${String(nextSeq).padStart(5, '0')}`;

      const lineItems: SaleLineItem[] = [];
      let subtotal = 0;
      let totalCost = 0;

      const productUpdates: {
        ref: ReturnType<typeof doc>;
        prevQty: number;
        newQty: number;
        code: string;
        name: string;
        warehouseName?: string;
        qtySold: number;
      }[] = [];

      for (let i = 0; i < input.items.length; i++) {
        const reqItem = input.items[i];
        const snap = productSnaps[i];
        if (!snap.exists()) {
          throw new Error('أحد الأصناف المضافة غير موجود.');
        }
        const prod = snap.data() as Product;
        const qty = Number(reqItem.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`الكمية غير صالحة للصنف: ${prod.name}`);
        }
        if (prod.quantity < qty) {
          throw new Error(
            `الكمية المتوفرة من (${prod.name} - ${prod.code}) هي ${prod.quantity} فقط ولا تكفي لبيع ${qty}.`
          );
        }

        const unitSale = Math.max(0, roundMoney(reqItem.unitSalePrice));
        const unitCost = Math.max(0, roundMoney(prod.purchasePrice));
        const lineTotal = roundMoney(unitSale * qty);
        const lineCost = roundMoney(unitCost * qty);
        const lineProfit = roundMoney(lineTotal - lineCost);

        subtotal = roundMoney(subtotal + lineTotal);
        totalCost = roundMoney(totalCost + lineCost);

        lineItems.push({
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          unit: prod.unit,
          quantity: qty,
          returnedQuantity: 0,
          unitPurchasePrice: unitCost,
          unitSalePrice: unitSale,
          lineTotal,
          lineProfit,
        });

        productUpdates.push({
          ref: doc(db, 'products', prod.id),
          prevQty: prod.quantity,
          newQty: roundMoney(prod.quantity - qty),
          code: prod.code,
          name: prod.name,
          warehouseName: prod.warehouseName,
          qtySold: qty,
        });
      }

      const discount = Math.min(subtotal, Math.max(0, roundMoney(input.discount)));
      const totalAmount = roundMoney(subtotal - discount);
      const netProfit = roundMoney(totalAmount - totalCost);

      let paidAmount = 0;
      if (input.paymentMethod === 'cash') {
        paidAmount = totalAmount;
      } else if (input.paymentMethod === 'credit') {
        paidAmount = 0;
      } else {
        paidAmount = Math.min(totalAmount, Math.max(0, roundMoney(input.paidAmount)));
      }
      const remainingAmount = roundMoney(totalAmount - paidAmount);

      if (remainingAmount > 0 && !customerRef) {
        throw new Error('يرجى اختيار عميل مسجل أو إضافة عميل جديد للبيع الآجل أو الجزئي.');
      }

      // 3. ALL WRITES
      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'INV', updatedAt: serverTimestamp() });
      }

      for (const pu of productUpdates) {
        tx.update(pu.ref, {
          quantity: pu.newQty,
          updatedAt: serverTimestamp(),
        });
        const movId = generateDocId('MOV');
        const movPayload: Record<string, unknown> = {
          id: movId,
          productId: pu.ref.id,
          productCode: pu.code,
          productName: pu.name,
          type: 'sale' as StockMovementType,
          quantityChange: -pu.qtySold,
          previousQty: pu.prevQty,
          newQty: pu.newQty,
          referenceId: saleId,
          referenceNumber: createdInvoiceNumber,
          reason: `فاتورة مبيعات رقم ${createdInvoiceNumber}`,
          employeeId: actor.uid,
          employeeName: actor.displayName.slice(0, 100),
          createdAt: serverTimestamp(),
        };
        if (pu.warehouseName) movPayload.warehouseName = pu.warehouseName;
        tx.set(doc(db, 'stock_movements', movId), movPayload);
      }

      const custData = customerSnap?.data() as Customer | undefined;
      if (customerRef && custData) {
        tx.update(customerRef, {
          totalPurchases: roundMoney((custData.totalPurchases || 0) + totalAmount),
          totalPaid: roundMoney((custData.totalPaid || 0) + paidAmount),
          balanceDue: roundMoney((custData.balanceDue || 0) + remainingAmount),
          updatedAt: serverTimestamp(),
        });
      }

      if (paidAmount > 0) {
        const prevT = treasurySnap.exists()
          ? treasurySnap.data()
          : { cashBalance: 0, totalCashIn: 0, totalCashOut: 0 };
        tx.set(treasuryRef, {
          cashBalance: roundMoney((prevT.cashBalance || 0) + paidAmount),
          totalCashIn: roundMoney((prevT.totalCashIn || 0) + paidAmount),
          totalCashOut: roundMoney(prevT.totalCashOut || 0),
          updatedAt: serverTimestamp(),
        });
      }

      const salePayload: Record<string, unknown> = {
        id: saleId,
        invoiceNumber: createdInvoiceNumber,
        customerName: (custData?.name || input.customerName || 'عميل نقدي').trim().slice(0, 120),
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        items: lineItems,
        subtotal,
        discount,
        totalAmount,
        totalCost,
        netProfit,
        paidAmount,
        remainingAmount,
        paymentMethod: input.paymentMethod,
        status: 'completed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (customerRef && custData) {
        salePayload.customerId = customerRef.id;
        salePayload.customerCode = custData.code;
        if (custData.phone) salePayload.customerPhone = custData.phone;
      } else if (input.customerPhone?.trim()) {
        salePayload.customerPhone = input.customerPhone.trim().slice(0, 30);
      }
      if (input.notes?.trim()) {
        salePayload.notes = input.notes.trim().slice(0, 500);
      }

      tx.set(doc(db, 'sales', saleId), salePayload);

      // Post Double-Entry Journal Entry
      postJournalEntryInTx(tx, jCtx, {
        description: `قيد فاتورة مبيعات ${createdInvoiceNumber} - ${salePayload.customerName}`,
        sourceType: 'sale',
        sourceId: saleId,
        sourceNumber: createdInvoiceNumber,
        rawLines: [
          { accountId: 'ACC_1101', debit: paidAmount, credit: 0 },
          { accountId: 'ACC_1102', debit: remainingAmount, credit: 0 },
          { accountId: 'ACC_4102', debit: discount, credit: 0 },
          { accountId: 'ACC_4101', debit: 0, credit: subtotal },
          { accountId: 'ACC_5101', debit: totalCost, credit: 0 },
          { accountId: 'ACC_1103', debit: 0, credit: totalCost },
        ],
        actor,
      });

      const audit = makeAuditEntry(
        actor,
        'CREATE_SALE',
        'sales',
        saleId,
        `إصدار فاتورة مبيعات ${createdInvoiceNumber} للعميل ${salePayload.customerName}`,
        `الإجمالي: ${totalAmount} | المدفوع: ${paidAmount} | المتبقي: ${remainingAmount} | الأصناف: ${lineItems.length}`
      );
      tx.set(audit.ref, audit.data);

      builtSale = {
        ...(salePayload as unknown as Sale),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
    });

    return builtSale;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('المتوفر') ||
        err.message.includes('الكمية') ||
        err.message.includes('العميل') ||
        err.message.includes('الفاتورة'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `sales/${saleId}`);
  }
}

// ============================================================================
// PURCHASES (ATOMIC TRANSACTION + DOUBLE-ENTRY JOURNAL)
// ============================================================================
export interface CreatePurchaseInput {
  supplierId: string;
  items: { productId: string; quantity: number; unitCost: number }[];
  paymentMethod: PaymentMethod;
  paidAmount: number;
  notes?: string;
}

export async function createPurchaseTx(
  input: CreatePurchaseInput,
  actor: ActorContext
): Promise<Purchase> {
  const purchaseId = generateDocId('PUR');
  let builtPurchase!: Purchase;

  try {
    await runTransaction(db, async (tx) => {
      if (!input.supplierId) throw new Error('يرجى اختيار المورد.');
      if (input.items.length === 0) throw new Error('أضف صنفاً واحداً على الأقل لفاتورة الشراء.');

      const counterRef = doc(db, 'counters', 'purchases');
      const counterSnap = await tx.get(counterRef);
      const supplierRef = doc(db, 'suppliers', input.supplierId);
      const supplierSnap = await tx.get(supplierRef);
      if (!supplierSnap.exists()) throw new Error('المورد المحدد غير موجود.');

      const treasuryRef = doc(db, 'settings', 'treasury');
      const treasurySnap = await tx.get(treasuryRef);

      const productSnaps = await Promise.all(
        input.items.map((item) => tx.get(doc(db, 'products', item.productId)))
      );

      const jCtx = await readJournalContext(tx, ['ACC_1101', 'ACC_1103', 'ACC_2101']);

      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      const invoiceNumber = `PUR-${String(nextSeq).padStart(5, '0')}`;

      const lineItems: PurchaseLineItem[] = [];
      let totalAmount = 0;

      const productUpdates: {
        ref: ReturnType<typeof doc>;
        prevQty: number;
        newQty: number;
        newCost: number;
        code: string;
        name: string;
        warehouseName?: string;
        qtyAdded: number;
      }[] = [];

      for (let i = 0; i < input.items.length; i++) {
        const reqItem = input.items[i];
        const snap = productSnaps[i];
        if (!snap.exists()) throw new Error('أحد الأصناف غير موجود.');
        const prod = snap.data() as Product;
        const qty = Number(reqItem.quantity);
        const unitCost = Math.max(0, roundMoney(reqItem.unitCost));
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`كمية غير صالحة للصنف ${prod.name}`);

        const lineTotal = roundMoney(qty * unitCost);
        totalAmount = roundMoney(totalAmount + lineTotal);

        lineItems.push({
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          unit: prod.unit,
          quantity: qty,
          returnedQuantity: 0,
          unitCost,
          lineTotal,
        });

        productUpdates.push({
          ref: doc(db, 'products', prod.id),
          prevQty: prod.quantity,
          newQty: roundMoney(prod.quantity + qty),
          newCost: unitCost,
          code: prod.code,
          name: prod.name,
          warehouseName: prod.warehouseName,
          qtyAdded: qty,
        });
      }

      let paidAmount = 0;
      if (input.paymentMethod === 'cash') paidAmount = totalAmount;
      else if (input.paymentMethod === 'credit') paidAmount = 0;
      else paidAmount = Math.min(totalAmount, Math.max(0, roundMoney(input.paidAmount)));

      const remainingAmount = roundMoney(totalAmount - paidAmount);

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'PUR', updatedAt: serverTimestamp() });
      }

      for (const pu of productUpdates) {
        tx.update(pu.ref, {
          quantity: pu.newQty,
          purchasePrice: pu.newCost,
          updatedAt: serverTimestamp(),
        });

        const movId = generateDocId('MOV');
        const movPayload: Record<string, unknown> = {
          id: movId,
          productId: pu.ref.id,
          productCode: pu.code,
          productName: pu.name,
          type: 'purchase' as StockMovementType,
          quantityChange: pu.qtyAdded,
          previousQty: pu.prevQty,
          newQty: pu.newQty,
          referenceId: purchaseId,
          referenceNumber: invoiceNumber,
          reason: `فاتورة مشتريات رقم ${invoiceNumber}`,
          employeeId: actor.uid,
          employeeName: actor.displayName.slice(0, 100),
          createdAt: serverTimestamp(),
        };
        if (pu.warehouseName) movPayload.warehouseName = pu.warehouseName;
        tx.set(doc(db, 'stock_movements', movId), movPayload);
      }

      const sup = supplierSnap.data() as Supplier;
      tx.update(supplierRef, {
        totalPurchases: roundMoney((sup.totalPurchases || 0) + totalAmount),
        totalPaid: roundMoney((sup.totalPaid || 0) + paidAmount),
        balanceDue: roundMoney((sup.balanceDue || 0) + remainingAmount),
        updatedAt: serverTimestamp(),
      });

      if (paidAmount > 0) {
        const prevT = treasurySnap.exists()
          ? treasurySnap.data()
          : { cashBalance: 0, totalCashIn: 0, totalCashOut: 0 };
        tx.set(treasuryRef, {
          cashBalance: roundMoney((prevT.cashBalance || 0) - paidAmount),
          totalCashIn: roundMoney(prevT.totalCashIn || 0),
          totalCashOut: roundMoney((prevT.totalCashOut || 0) + paidAmount),
          updatedAt: serverTimestamp(),
        });
      }

      const purchasePayload: Record<string, unknown> = {
        id: purchaseId,
        invoiceNumber,
        supplierId: sup.id,
        supplierName: sup.name,
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        items: lineItems,
        totalAmount,
        paidAmount,
        remainingAmount,
        paymentMethod: input.paymentMethod,
        status: 'received',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (sup.phone) purchasePayload.supplierPhone = sup.phone;
      if (input.notes?.trim()) purchasePayload.notes = input.notes.trim().slice(0, 500);

      tx.set(doc(db, 'purchases', purchaseId), purchasePayload);

      postJournalEntryInTx(tx, jCtx, {
        description: `قيد فاتورة مشتريات ${invoiceNumber} من المورد ${sup.name}`,
        sourceType: 'purchase',
        sourceId: purchaseId,
        sourceNumber: invoiceNumber,
        rawLines: [
          { accountId: 'ACC_1103', debit: totalAmount, credit: 0 },
          { accountId: 'ACC_1101', debit: 0, credit: paidAmount },
          { accountId: 'ACC_2101', debit: 0, credit: remainingAmount },
        ],
        actor,
      });

      const audit = makeAuditEntry(
        actor,
        'CREATE_PURCHASE',
        'purchases',
        purchaseId,
        `اعتماد فاتورة مشتريات ${invoiceNumber} من المورد ${sup.name}`,
        `الإجمالي: ${totalAmount} | المدفوع: ${paidAmount} | المتبقي: ${remainingAmount}`
      );
      tx.set(audit.ref, audit.data);

      builtPurchase = {
        ...(purchasePayload as unknown as Purchase),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
    });

    return builtPurchase;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('المورد') || err.message.includes('أضف'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `purchases/${purchaseId}`);
  }
}

// ============================================================================
// SALE RETURNS & CANCELLATIONS (DAMAGED ITEMS NEVER ENTER SELLABLE STOCK!)
// ============================================================================
export interface ReturnInput {
  sale: Sale;
  type: 'return' | 'cancel';
  items: { productId: string; quantity: number; restockable: boolean }[];
  reason: string;
}

export async function createReturnOrCancelTx(
  input: ReturnInput,
  actor: ActorContext
): Promise<SaleReturn> {
  const returnId = generateDocId('RET');
  let builtReturn!: SaleReturn;

  try {
    await runTransaction(db, async (tx) => {
      if (!input.reason.trim()) throw new Error('يجب كتابة سبب الإرجاع أو الإلغاء.');

      const saleRef = doc(db, 'sales', input.sale.id);
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) throw new Error('الفاتورة غير موجودة.');
      const saleData = saleSnap.data() as Sale;

      if (saleData.status === 'cancelled' || saleData.status === 'returned') {
        throw new Error('تم إلغاء هذه الفاتورة أو إرجاعها بالكامل مسبقاً.');
      }

      const counterRef = doc(db, 'counters', 'returns');
      const counterSnap = await tx.get(counterRef);
      const treasuryRef = doc(db, 'settings', 'treasury');
      const treasurySnap = await tx.get(treasuryRef);
      const customerRef = saleData.customerId ? doc(db, 'customers', saleData.customerId) : null;
      const customerSnap = customerRef ? await tx.get(customerRef) : null;

      const returnItemsReq =
        input.type === 'cancel'
          ? saleData.items.map((it) => ({
              productId: it.productId,
              quantity: Math.max(0, it.quantity - (it.returnedQuantity || 0)),
              restockable: true,
            }))
          : input.items.filter((it) => it.quantity > 0);

      if (returnItemsReq.length === 0) {
        throw new Error('يرجى تحديد كمية واحدة على الأقل للإرجاع.');
      }

      const productSnaps = await Promise.all(
        returnItemsReq.map((it) => tx.get(doc(db, 'products', it.productId)))
      );

      const jCtx = await readJournalContext(tx, [
        'ACC_1101',
        'ACC_1102',
        'ACC_1103',
        'ACC_1104',
        'ACC_4102',
        'ACC_5101',
      ]);

      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      const returnNumber = `RET-${String(nextSeq).padStart(5, '0')}`;

      const returnLines: ReturnLineItem[] = [];
      let totalRefund = 0;
      let restockCost = 0;
      let damagedCost = 0;

      const discountRatio =
        saleData.subtotal > 0 ? saleData.totalAmount / saleData.subtotal : 1;

      const updatedSaleItems = saleData.items.map((sItem) => ({ ...sItem }));
      const restockOps: {
        ref: ReturnType<typeof doc>;
        prevQty: number;
        newQty: number;
        prevDamaged: number;
        newDamaged: number;
        qtyReturned: number;
        restockable: boolean;
        code: string;
        name: string;
        warehouseName?: string;
      }[] = [];

      for (let i = 0; i < returnItemsReq.length; i++) {
        const req = returnItemsReq[i];
        const saleItemIdx = updatedSaleItems.findIndex((s) => s.productId === req.productId);
        if (saleItemIdx === -1) throw new Error('صنف غير موجود ضمن الفاتورة.');

        const sItem = updatedSaleItems[saleItemIdx];
        const alreadyReturned = sItem.returnedQuantity || 0;
        const maxReturnable = sItem.quantity - alreadyReturned;
        if (req.quantity <= 0 || req.quantity > maxReturnable) {
          throw new Error(
            `الكمية المرتجعة من (${sItem.productName}) تتجاوز الكمية المتبقية القابلة للإرجاع (${maxReturnable}).`
          );
        }

        sItem.returnedQuantity = alreadyReturned + req.quantity;
        const refundLineTotal = roundMoney(sItem.unitSalePrice * req.quantity * discountRatio);
        const lineCost = roundMoney(sItem.unitPurchasePrice * req.quantity);
        totalRefund = roundMoney(totalRefund + refundLineTotal);

        if (req.restockable) {
          restockCost = roundMoney(restockCost + lineCost);
        } else {
          damagedCost = roundMoney(damagedCost + lineCost);
        }

        returnLines.push({
          productId: sItem.productId,
          productCode: sItem.productCode,
          productName: sItem.productName,
          quantity: req.quantity,
          unitSalePrice: sItem.unitSalePrice,
          unitPurchasePrice: sItem.unitPurchasePrice,
          refundLineTotal,
          restockable: req.restockable,
        });

        const pSnap = productSnaps[i];
        if (pSnap.exists()) {
          const prod = pSnap.data() as Product;
          const prevDamaged = prod.damagedQuantity || 0;
          restockOps.push({
            ref: doc(db, 'products', prod.id),
            prevQty: prod.quantity,
            newQty: req.restockable ? roundMoney(prod.quantity + req.quantity) : prod.quantity,
            prevDamaged,
            newDamaged: req.restockable ? prevDamaged : roundMoney(prevDamaged + req.quantity),
            qtyReturned: req.quantity,
            restockable: req.restockable,
            code: prod.code,
            name: prod.name,
            warehouseName: prod.warehouseName,
          });
        }
      }

      const allReturned = updatedSaleItems.every(
        (it) => (it.returnedQuantity || 0) >= it.quantity
      );
      const nextStatus =
        input.type === 'cancel' ? 'cancelled' : allReturned ? 'returned' : 'partially_returned';

      const debtReduced = Math.min(saleData.remainingAmount || 0, totalRefund);
      const cashRefunded = roundMoney(Math.max(0, totalRefund - debtReduced));

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'RET', updatedAt: serverTimestamp() });
      }

      for (const ro of restockOps) {
        if (ro.restockable) {
          // Valid item -> increment sellable quantity
          tx.update(ro.ref, {
            quantity: ro.newQty,
            updatedAt: serverTimestamp(),
          });
          const movId = generateDocId('MOV');
          const movPayload: Record<string, unknown> = {
            id: movId,
            productId: ro.ref.id,
            productCode: ro.code,
            productName: ro.name,
            type: 'return' as StockMovementType,
            quantityChange: ro.qtyReturned,
            previousQty: ro.prevQty,
            newQty: ro.newQty,
            referenceId: returnId,
            referenceNumber: returnNumber,
            reason: `${input.type === 'cancel' ? 'إلغاء فاتورة' : 'مرتجع صالح للمخزون'} ${saleData.invoiceNumber}: ${input.reason}`,
            employeeId: actor.uid,
            employeeName: actor.displayName.slice(0, 100),
            createdAt: serverTimestamp(),
          };
          if (ro.warehouseName) movPayload.warehouseName = ro.warehouseName;
          tx.set(doc(db, 'stock_movements', movId), movPayload);
        } else {
          // Damaged returned item -> NEVER add to sellable quantity! Record in damagedQuantity only
          tx.update(ro.ref, {
            damagedQuantity: ro.newDamaged,
            updatedAt: serverTimestamp(),
          });
          const movId = generateDocId('MOV');
          const movPayload: Record<string, unknown> = {
            id: movId,
            productId: ro.ref.id,
            productCode: ro.code,
            productName: ro.name,
            type: 'return' as StockMovementType,
            quantityChange: 0,
            previousQty: ro.prevQty,
            newQty: ro.prevQty,
            referenceId: returnId,
            referenceNumber: returnNumber,
            reason: `مرتجع تالف (+${ro.qtyReturned} تالف - لم يُضف للمخزون القابل للبيع) فاتورة ${saleData.invoiceNumber}: ${input.reason}`,
            employeeId: actor.uid,
            employeeName: actor.displayName.slice(0, 100),
            createdAt: serverTimestamp(),
          };
          if (ro.warehouseName) movPayload.warehouseName = ro.warehouseName;
          tx.set(doc(db, 'stock_movements', movId), movPayload);
        }
      }

      if (actor.role === 'admin') {
        tx.update(saleRef, {
          status: nextStatus,
          items: updatedSaleItems,
          remainingAmount: roundMoney(Math.max(0, (saleData.remainingAmount || 0) - debtReduced)),
          paidAmount: roundMoney(Math.max(0, (saleData.paidAmount || 0) - cashRefunded)),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(saleRef, {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      }

      if (customerRef && customerSnap?.exists()) {
        const cData = customerSnap.data() as Customer;
        tx.update(customerRef, {
          totalPurchases: roundMoney(Math.max(0, (cData.totalPurchases || 0) - totalRefund)),
          totalPaid: roundMoney(Math.max(0, (cData.totalPaid || 0) - cashRefunded)),
          balanceDue: roundMoney(Math.max(0, (cData.balanceDue || 0) - debtReduced)),
          updatedAt: serverTimestamp(),
        });
      }

      if (cashRefunded > 0) {
        const prevT = treasurySnap.exists()
          ? treasurySnap.data()
          : { cashBalance: 0, totalCashIn: 0, totalCashOut: 0 };
        tx.set(treasuryRef, {
          cashBalance: roundMoney((prevT.cashBalance || 0) - cashRefunded),
          totalCashIn: roundMoney(prevT.totalCashIn || 0),
          totalCashOut: roundMoney((prevT.totalCashOut || 0) + cashRefunded),
          updatedAt: serverTimestamp(),
        });
      }

      const retPayload: Record<string, unknown> = {
        id: returnId,
        returnNumber,
        saleId: saleData.id,
        invoiceNumber: saleData.invoiceNumber,
        customerName: saleData.customerName,
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        type: input.type,
        items: returnLines,
        totalRefund,
        cashRefunded,
        debtReduced,
        reason: input.reason.trim().slice(0, 300),
        createdAt: serverTimestamp(),
      };
      if (saleData.customerId) retPayload.customerId = saleData.customerId;

      tx.set(doc(db, 'returns', returnId), retPayload);

      // Post balanced journal entry for sale return
      postJournalEntryInTx(tx, jCtx, {
        description: `قيد ${input.type === 'cancel' ? 'إلغاء فاتورة' : 'مرتجع مبيعات'} ${saleData.invoiceNumber} (${returnNumber})`,
        sourceType: 'sale_return',
        sourceId: returnId,
        sourceNumber: returnNumber,
        rawLines: [
          { accountId: 'ACC_4102', debit: totalRefund, credit: 0 },
          { accountId: 'ACC_1101', debit: 0, credit: cashRefunded },
          { accountId: 'ACC_1102', debit: 0, credit: debtReduced },
          { accountId: 'ACC_1103', debit: restockCost, credit: 0 },
          { accountId: 'ACC_1104', debit: damagedCost, credit: 0 },
          { accountId: 'ACC_5101', debit: 0, credit: roundMoney(restockCost + damagedCost) },
        ],
        actor,
      });

      const audit = makeAuditEntry(
        actor,
        input.type === 'cancel' ? 'CANCEL_SALE' : 'RETURN_SALE',
        'returns',
        returnId,
        `${input.type === 'cancel' ? 'إلغاء' : 'مرتجع'} فاتورة ${saleData.invoiceNumber} (${returnNumber})`,
        `قيمة المرتجع: ${totalRefund} | مسترد نقداً: ${cashRefunded} | خصم من الدين: ${debtReduced} | السبب: ${input.reason}`
      );
      tx.set(audit.ref, audit.data);

      builtReturn = {
        ...(retPayload as unknown as SaleReturn),
        createdAt: Timestamp.now(),
      };
    });

    return builtReturn;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('سبب') ||
        err.message.includes('إلغاء') ||
        err.message.includes('تتجاوز') ||
        err.message.includes('تحديد'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `returns/${returnId}`);
  }
}

// ============================================================================
// PURCHASE RETURNS (RETURN TO SUPPLIERS + DEDUCT INVENTORY + SUPPLIER BALANCE)
// ============================================================================
export interface CreatePurchaseReturnInput {
  purchase: Purchase;
  items: { productId: string; quantity: number; fromDamaged?: boolean }[];
  reason: string;
}

export async function createPurchaseReturnTx(
  input: CreatePurchaseReturnInput,
  actor: ActorContext
): Promise<PurchaseReturn> {
  const returnId = generateDocId('PRT');
  let builtReturn!: PurchaseReturn;

  try {
    await runTransaction(db, async (tx) => {
      if (!input.reason.trim()) throw new Error('يجب كتابة سبب مرتجع المشتريات.');

      const purchaseRef = doc(db, 'purchases', input.purchase.id);
      const purchaseSnap = await tx.get(purchaseRef);
      if (!purchaseSnap.exists()) throw new Error('فاتورة الشراء غير موجودة.');
      const purchaseData = purchaseSnap.data() as Purchase;

      if (purchaseData.status === 'cancelled' || purchaseData.status === 'returned') {
        throw new Error('تم إرجاع أو إلغاء فاتورة الشراء بالكامل مسبقاً.');
      }

      const itemsReq = input.items.filter((i) => i.quantity > 0);
      if (itemsReq.length === 0) {
        throw new Error('يرجى تحديد كمية واحدة على الأقل لإرجاعها للمورد.');
      }

      const counterRef = doc(db, 'counters', 'purchase_returns');
      const counterSnap = await tx.get(counterRef);
      const supplierRef = doc(db, 'suppliers', purchaseData.supplierId);
      const supplierSnap = await tx.get(supplierRef);
      const treasuryRef = doc(db, 'settings', 'treasury');
      const treasurySnap = await tx.get(treasuryRef);

      const productSnaps = await Promise.all(
        itemsReq.map((it) => tx.get(doc(db, 'products', it.productId)))
      );

      const jCtx = await readJournalContext(tx, [
        'ACC_1101',
        'ACC_1103',
        'ACC_1104',
        'ACC_2101',
      ]);

      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      const returnNumber = `PRT-${String(nextSeq).padStart(5, '0')}`;

      const updatedPurchaseItems = purchaseData.items.map((pi) => ({ ...pi }));
      const returnLines: PurchaseReturnLineItem[] = [];
      let totalRefund = 0;
      let goodReturnCost = 0;
      let damagedReturnCost = 0;

      const stockOps: {
        ref: ReturnType<typeof doc>;
        prevQty: number;
        newQty: number;
        prevDamaged: number;
        newDamaged: number;
        qtyOut: number;
        fromDamaged: boolean;
        code: string;
        name: string;
        warehouseName?: string;
      }[] = [];

      for (let i = 0; i < itemsReq.length; i++) {
        const req = itemsReq[i];
        const idx = updatedPurchaseItems.findIndex((pi) => pi.productId === req.productId);
        if (idx === -1) throw new Error('الصنف غير موجود ضمن فاتورة الشراء.');

        const pItem = updatedPurchaseItems[idx];
        const alreadyReturned = pItem.returnedQuantity || 0;
        const maxRet = pItem.quantity - alreadyReturned;
        if (req.quantity <= 0 || req.quantity > maxRet) {
          throw new Error(
            `الكمية المرتجعة للمورد من (${pItem.productName}) تتجاوز الكمية القابلة للإرجاع (${maxRet}).`
          );
        }

        const pSnap = productSnaps[i];
        if (!pSnap.exists()) throw new Error(`الصنف (${pItem.productName}) غير موجود في المخزون.`);
        const prod = pSnap.data() as Product;
        const fromDamaged = Boolean(req.fromDamaged);
        const prevDamaged = prod.damagedQuantity || 0;

        if (fromDamaged) {
          if (prevDamaged < req.quantity) {
            throw new Error(
              `الكمية التالفة المسجلة من (${prod.name}) هي ${prevDamaged} فقط ولا تكفي لإرجاع ${req.quantity}.`
            );
          }
        } else if (prod.quantity < req.quantity) {
          throw new Error(
            `الرصيد القابل للبيع من (${prod.name}) هو ${prod.quantity} فقط ولا يكفي لخصم ${req.quantity} للمورد.`
          );
        }

        pItem.returnedQuantity = alreadyReturned + req.quantity;
        const refundLineTotal = roundMoney(pItem.unitCost * req.quantity);
        totalRefund = roundMoney(totalRefund + refundLineTotal);

        if (fromDamaged) {
          damagedReturnCost = roundMoney(damagedReturnCost + refundLineTotal);
        } else {
          goodReturnCost = roundMoney(goodReturnCost + refundLineTotal);
        }

        returnLines.push({
          productId: pItem.productId,
          productCode: pItem.productCode,
          productName: pItem.productName,
          quantity: req.quantity,
          unitCost: pItem.unitCost,
          refundLineTotal,
          fromDamaged,
        });

        stockOps.push({
          ref: doc(db, 'products', prod.id),
          prevQty: prod.quantity,
          newQty: fromDamaged ? prod.quantity : roundMoney(prod.quantity - req.quantity),
          prevDamaged,
          newDamaged: fromDamaged ? roundMoney(prevDamaged - req.quantity) : prevDamaged,
          qtyOut: req.quantity,
          fromDamaged,
          code: prod.code,
          name: prod.name,
          warehouseName: prod.warehouseName,
        });
      }

      const allReturned = updatedPurchaseItems.every(
        (it) => (it.returnedQuantity || 0) >= it.quantity
      );
      const nextStatus = allReturned ? 'returned' : 'partially_returned';

      // Reduce supplier remaining debt first, remainder is cash refunded back into treasury
      const debtReduced = Math.min(purchaseData.remainingAmount || 0, totalRefund);
      const cashRefunded = roundMoney(Math.max(0, totalRefund - debtReduced));

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'PRT', updatedAt: serverTimestamp() });
      }

      for (const so of stockOps) {
        tx.update(so.ref, {
          quantity: so.newQty,
          damagedQuantity: so.newDamaged,
          updatedAt: serverTimestamp(),
        });

        const movId = generateDocId('MOV');
        const movPayload: Record<string, unknown> = {
          id: movId,
          productId: so.ref.id,
          productCode: so.code,
          productName: so.name,
          type: 'purchase_return' as StockMovementType,
          quantityChange: so.fromDamaged ? 0 : -so.qtyOut,
          previousQty: so.prevQty,
          newQty: so.newQty,
          referenceId: returnId,
          referenceNumber: returnNumber,
          reason: so.fromDamaged
            ? `مرتجع مشتريات من المخزون التالف (-${so.qtyOut} تالف) فاتورة ${purchaseData.invoiceNumber}: ${input.reason}`
            : `مرتجع مشتريات للمورد فاتورة ${purchaseData.invoiceNumber}: ${input.reason}`,
          employeeId: actor.uid,
          employeeName: actor.displayName.slice(0, 100),
          createdAt: serverTimestamp(),
        };
        if (so.warehouseName) movPayload.warehouseName = so.warehouseName;
        tx.set(doc(db, 'stock_movements', movId), movPayload);
      }

      if (actor.role === 'admin') {
        tx.update(purchaseRef, {
          status: nextStatus,
          items: updatedPurchaseItems,
          remainingAmount: roundMoney(Math.max(0, (purchaseData.remainingAmount || 0) - debtReduced)),
          paidAmount: roundMoney(Math.max(0, (purchaseData.paidAmount || 0) - cashRefunded)),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(purchaseRef, {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      }

      if (supplierSnap.exists()) {
        const sData = supplierSnap.data() as Supplier;
        tx.update(supplierRef, {
          totalPurchases: roundMoney(Math.max(0, (sData.totalPurchases || 0) - totalRefund)),
          totalPaid: roundMoney(Math.max(0, (sData.totalPaid || 0) - cashRefunded)),
          balanceDue: roundMoney(Math.max(0, (sData.balanceDue || 0) - debtReduced)),
          updatedAt: serverTimestamp(),
        });
      }

      if (cashRefunded > 0) {
        const prevT = treasurySnap.exists()
          ? treasurySnap.data()
          : { cashBalance: 0, totalCashIn: 0, totalCashOut: 0 };
        tx.set(treasuryRef, {
          cashBalance: roundMoney((prevT.cashBalance || 0) + cashRefunded),
          totalCashIn: roundMoney((prevT.totalCashIn || 0) + cashRefunded),
          totalCashOut: roundMoney(prevT.totalCashOut || 0),
          updatedAt: serverTimestamp(),
        });
      }

      const prPayload: Record<string, unknown> = {
        id: returnId,
        returnNumber,
        purchaseId: purchaseData.id,
        invoiceNumber: purchaseData.invoiceNumber,
        supplierId: purchaseData.supplierId,
        supplierName: purchaseData.supplierName,
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        items: returnLines,
        totalRefund,
        cashRefunded,
        debtReduced,
        reason: input.reason.trim().slice(0, 300),
        createdAt: serverTimestamp(),
      };

      tx.set(doc(db, 'purchase_returns', returnId), prPayload);

      postJournalEntryInTx(tx, jCtx, {
        description: `قيد مرتجع مشتريات للمورد ${purchaseData.supplierName} (${returnNumber})`,
        sourceType: 'purchase_return',
        sourceId: returnId,
        sourceNumber: returnNumber,
        rawLines: [
          { accountId: 'ACC_1101', debit: cashRefunded, credit: 0 },
          { accountId: 'ACC_2101', debit: debtReduced, credit: 0 },
          { accountId: 'ACC_1103', debit: 0, credit: goodReturnCost },
          { accountId: 'ACC_1104', debit: 0, credit: damagedReturnCost },
        ],
        actor,
      });

      const audit = makeAuditEntry(
        actor,
        'RETURN_PURCHASE',
        'purchase_returns',
        returnId,
        `مرتجع مشتريات فاتورة ${purchaseData.invoiceNumber} للمورد ${purchaseData.supplierName} (${returnNumber})`,
        `إجمالي المرتجع: ${totalRefund} | مسترد نقداً: ${cashRefunded} | تخفيض ذمم المورد: ${debtReduced}`
      );
      tx.set(audit.ref, audit.data);

      builtReturn = {
        ...(prPayload as unknown as PurchaseReturn),
        createdAt: Timestamp.now(),
      };
    });

    return builtReturn;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('سبب') ||
        err.message.includes('تتجاوز') ||
        err.message.includes('لا تكفي') ||
        err.message.includes('تحديد'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `purchase_returns/${returnId}`);
  }
}

// ============================================================================
// STOCK ADJUSTMENTS, DAMAGED WRITE-OFF & PHYSICAL STOCKTAKE
// ============================================================================
export async function adjustStockTx(
  productId: string,
  direction: 'in' | 'out',
  quantity: number,
  reason: string,
  actor: ActorContext
): Promise<void> {
  const path = `products/${productId}`;
  try {
    await runTransaction(db, async (tx) => {
      if (quantity <= 0) throw new Error('يرجى إدخال كمية موجبة.');
      if (!reason.trim()) throw new Error('يرجى كتابة سبب تسوية المخزون.');

      const prodRef = doc(db, 'products', productId);
      const prodSnap = await tx.get(prodRef);
      if (!prodSnap.exists()) throw new Error('الصنف غير موجود.');
      const prod = prodSnap.data() as Product;

      const delta = direction === 'in' ? quantity : -quantity;
      const newQty = roundMoney(prod.quantity + delta);
      if (newQty < 0) {
        throw new Error(`لا يمكن خصم ${quantity} لأن الرصيد الحالي ${prod.quantity} فقط.`);
      }

      const adjValue = roundMoney(quantity * (prod.purchasePrice || 0));
      const jCtx =
        adjValue > 0 ? await readJournalContext(tx, ['ACC_1103', 'ACC_5202']) : null;

      tx.update(prodRef, { quantity: newQty, updatedAt: serverTimestamp() });

      const movId = generateDocId('MOV');
      const movPayload: Record<string, unknown> = {
        id: movId,
        productId: prod.id,
        productCode: prod.code,
        productName: prod.name,
        type: direction === 'in' ? 'adjustment_in' : 'adjustment_out',
        quantityChange: delta,
        previousQty: prod.quantity,
        newQty,
        referenceId: movId,
        referenceNumber: prod.code,
        reason: reason.trim().slice(0, 300),
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        createdAt: serverTimestamp(),
      };
      if (prod.warehouseName) movPayload.warehouseName = prod.warehouseName;
      tx.set(doc(db, 'stock_movements', movId), movPayload);

      if (jCtx && adjValue > 0) {
        postJournalEntryInTx(tx, jCtx, {
          description: `قيد تسوية مخزون (${direction === 'in' ? 'زيادة' : 'نقص/تلف'}) للصنف ${prod.name}`,
          sourceType: 'stock_adjustment',
          sourceId: movId,
          sourceNumber: prod.code,
          rawLines:
            direction === 'in'
              ? [
                  { accountId: 'ACC_1103', debit: adjValue, credit: 0 },
                  { accountId: 'ACC_5202', debit: 0, credit: adjValue },
                ]
              : [
                  { accountId: 'ACC_5202', debit: adjValue, credit: 0 },
                  { accountId: 'ACC_1103', debit: 0, credit: adjValue },
                ],
          actor,
        });
      }

      const audit = makeAuditEntry(
        actor,
        direction === 'in' ? 'STOCK_IN' : 'STOCK_OUT',
        'products',
        prod.id,
        `تسوية مخزون (${direction === 'in' ? 'وارد +' : 'منصرف -'}${quantity}) للصنف ${prod.name} (${prod.code})`,
        `الرصيد السابق: ${prod.quantity} -> الجديد: ${newQty} | السبب: ${reason}`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('كمية') ||
        err.message.includes('سبب') ||
        err.message.includes('لا يمكن'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function writeOffDamagedStockTx(
  product: Product,
  quantity: number,
  reason: string,
  actor: ActorContext
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      if (quantity <= 0) throw new Error('أدخل كمية تالفة صحيحة للشطب.');
      const prodRef = doc(db, 'products', product.id);
      const snap = await tx.get(prodRef);
      if (!snap.exists()) throw new Error('الصنف غير موجود.');
      const cur = snap.data() as Product;
      const curDamaged = cur.damagedQuantity || 0;
      if (quantity > curDamaged) {
        throw new Error(`الكمية التالفة المسجلة هي ${curDamaged} فقط.`);
      }

      const lossValue = roundMoney(quantity * (cur.purchasePrice || 0));
      const jCtx =
        lossValue > 0 ? await readJournalContext(tx, ['ACC_1104', 'ACC_5202']) : null;

      tx.update(prodRef, {
        damagedQuantity: roundMoney(curDamaged - quantity),
        updatedAt: serverTimestamp(),
      });

      if (jCtx && lossValue > 0) {
        postJournalEntryInTx(tx, jCtx, {
          description: `قيد شطب وإعدام بضاعة تالفة للصنف ${cur.name} (${cur.code})`,
          sourceType: 'stock_adjustment',
          sourceId: cur.id,
          sourceNumber: cur.code,
          rawLines: [
            { accountId: 'ACC_5202', debit: lossValue, credit: 0 },
            { accountId: 'ACC_1104', debit: 0, credit: lossValue },
          ],
          actor,
        });
      }

      const audit = makeAuditEntry(
        actor,
        'WRITE_OFF_DAMAGED',
        'products',
        cur.id,
        `إتلاف وشطب (${quantity}) من المخزون التالف للصنف ${cur.name}`,
        reason.trim() || 'إعدام بضاعة تالفة/منتهية الصلاحية'
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('التالفة')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `products/${product.id}`);
  }
}

export async function submitStocktakeTx(
  entries: { productId: string; actualQty: number; reason?: string }[],
  notes: string,
  actor: ActorContext
): Promise<Stocktake> {
  const stocktakeId = generateDocId('STK');
  let built!: Stocktake;

  try {
    await runTransaction(db, async (tx) => {
      if (entries.length === 0) throw new Error('لا توجد أصناف في الجرد.');

      const counterRef = doc(db, 'counters', 'stocktakes');
      const counterSnap = await tx.get(counterRef);
      const prodSnaps = await Promise.all(
        entries.map((e) => tx.get(doc(db, 'products', e.productId)))
      );
      const jCtx = await readJournalContext(tx, ['ACC_1103', 'ACC_5202']);

      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      const stocktakeNumber = `STK-${String(nextSeq).padStart(5, '0')}`;

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'STK', updatedAt: serverTimestamp() });
      }

      const items: StocktakeItem[] = [];
      let totalVarianceValue = 0;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const snap = prodSnaps[i];
        if (!snap.exists()) continue;
        const prod = snap.data() as Product;
        const actualQty = Math.max(0, Number(entry.actualQty));
        const variance = roundMoney(actualQty - prod.quantity);
        const varianceValue = roundMoney(variance * prod.purchasePrice);
        totalVarianceValue = roundMoney(totalVarianceValue + varianceValue);

        items.push({
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          systemQty: prod.quantity,
          actualQty,
          variance,
          unitCost: prod.purchasePrice,
          varianceValue,
          reason: entry.reason?.trim() || (variance === 0 ? 'مطابق' : 'تسوية جرد فعلي'),
        });

        if (variance !== 0) {
          tx.update(doc(db, 'products', prod.id), {
            quantity: actualQty,
            updatedAt: serverTimestamp(),
          });

          const movId = generateDocId('MOV');
          const movPayload: Record<string, unknown> = {
            id: movId,
            productId: prod.id,
            productCode: prod.code,
            productName: prod.name,
            type: 'stocktake' as StockMovementType,
            quantityChange: variance,
            previousQty: prod.quantity,
            newQty: actualQty,
            referenceId: stocktakeId,
            referenceNumber: stocktakeNumber,
            reason: entry.reason?.trim() || `جرد فعلي رقم ${stocktakeNumber}`,
            employeeId: actor.uid,
            employeeName: actor.displayName.slice(0, 100),
            createdAt: serverTimestamp(),
          };
          if (prod.warehouseName) movPayload.warehouseName = prod.warehouseName;
          tx.set(doc(db, 'stock_movements', movId), movPayload);
        }
      }

      const payload: Record<string, unknown> = {
        id: stocktakeId,
        stocktakeNumber,
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        items,
        totalVarianceValue,
        createdAt: serverTimestamp(),
      };
      if (notes.trim()) payload.notes = notes.trim().slice(0, 500);

      tx.set(doc(db, 'stocktakes', stocktakeId), payload);

      if (totalVarianceValue !== 0) {
        const absVal = Math.abs(totalVarianceValue);
        postJournalEntryInTx(tx, jCtx, {
          description: `قيد فروقات الجرد الفعلي رقم ${stocktakeNumber}`,
          sourceType: 'stock_adjustment',
          sourceId: stocktakeId,
          sourceNumber: stocktakeNumber,
          rawLines:
            totalVarianceValue > 0
              ? [
                  { accountId: 'ACC_1103', debit: absVal, credit: 0 },
                  { accountId: 'ACC_5202', debit: 0, credit: absVal },
                ]
              : [
                  { accountId: 'ACC_5202', debit: absVal, credit: 0 },
                  { accountId: 'ACC_1103', debit: 0, credit: absVal },
                ],
          actor,
        });
      }

      const audit = makeAuditEntry(
        actor,
        'SUBMIT_STOCKTAKE',
        'stocktakes',
        stocktakeId,
        `اعتماد جلسة جرد مخزون ${stocktakeNumber} (${items.length} صنف)`,
        `قيمة الفروقات: ${totalVarianceValue}`
      );
      tx.set(audit.ref, audit.data);

      built = {
        ...(payload as unknown as Stocktake),
        createdAt: Timestamp.now(),
      };
    });

    return built;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `stocktakes/${stocktakeId}`);
  }
}

// ============================================================================
// FINANCIAL VOUCHERS (RECEIPTS, SUPPLIER PAYMENTS, EXPENSES)
// ============================================================================
export interface CreateVoucherInput {
  type: VoucherType;
  category: string;
  partyType: 'customer' | 'supplier' | 'general';
  partyId?: string;
  partyName?: string;
  amount: number;
  notes?: string;
}

export async function createVoucherTx(
  input: CreateVoucherInput,
  actor: ActorContext
): Promise<Voucher> {
  const voucherId = generateDocId('VCH');
  let built!: Voucher;

  try {
    await runTransaction(db, async (tx) => {
      const amount = roundMoney(input.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('يجب أن يكون مبلغ السند أكبر من صفر.');
      }

      const counterRef = doc(db, 'counters', 'vouchers');
      const counterSnap = await tx.get(counterRef);
      const treasuryRef = doc(db, 'settings', 'treasury');
      const treasurySnap = await tx.get(treasuryRef);

      let partySnap = null;
      const partyRef =
        input.partyId && input.partyType === 'customer'
          ? doc(db, 'customers', input.partyId)
          : input.partyId && input.partyType === 'supplier'
            ? doc(db, 'suppliers', input.partyId)
            : null;
      if (partyRef) {
        partySnap = await tx.get(partyRef);
        if (!partySnap.exists()) throw new Error('الحساب المحدد غير موجود.');
      }

      const jCtx = await readJournalContext(tx, [
        'ACC_1101',
        'ACC_1102',
        'ACC_2101',
        'ACC_3101',
        'ACC_5201',
      ]);

      const nextSeq = counterSnap.exists() ? Number(counterSnap.data().seq || 0) + 1 : 1;
      const voucherNumber = `VCH-${String(nextSeq).padStart(5, '0')}`;

      if (counterSnap.exists()) {
        tx.update(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { seq: nextSeq, prefix: 'VCH', updatedAt: serverTimestamp() });
      }

      let resolvedPartyName = input.partyName?.trim() || '';
      if (partyRef && partySnap?.exists()) {
        const pData = partySnap.data();
        resolvedPartyName = pData.name;
        if (input.partyType === 'customer' && input.type === 'receipt') {
          tx.update(partyRef, {
            totalPaid: roundMoney((pData.totalPaid || 0) + amount),
            balanceDue: roundMoney((pData.balanceDue || 0) - amount),
            updatedAt: serverTimestamp(),
          });
        } else if (input.partyType === 'supplier' && input.type === 'payment') {
          tx.update(partyRef, {
            totalPaid: roundMoney((pData.totalPaid || 0) + amount),
            balanceDue: roundMoney((pData.balanceDue || 0) - amount),
            updatedAt: serverTimestamp(),
          });
        }
      }

      const prevT = treasurySnap.exists()
        ? treasurySnap.data()
        : { cashBalance: 0, totalCashIn: 0, totalCashOut: 0 };
      const isCashIn = input.type === 'receipt';
      tx.set(treasuryRef, {
        cashBalance: roundMoney((prevT.cashBalance || 0) + (isCashIn ? amount : -amount)),
        totalCashIn: roundMoney((prevT.totalCashIn || 0) + (isCashIn ? amount : 0)),
        totalCashOut: roundMoney((prevT.totalCashOut || 0) + (isCashIn ? 0 : amount)),
        updatedAt: serverTimestamp(),
      });

      const payload: Record<string, unknown> = {
        id: voucherId,
        voucherNumber,
        type: input.type,
        category: input.category.trim().slice(0, 80),
        partyType: input.partyType,
        amount,
        employeeId: actor.uid,
        employeeName: actor.displayName.slice(0, 100),
        createdAt: serverTimestamp(),
      };
      if (input.partyId) payload.partyId = input.partyId;
      if (resolvedPartyName) payload.partyName = resolvedPartyName.slice(0, 120);
      if (input.notes?.trim()) payload.notes = input.notes.trim().slice(0, 400);

      tx.set(doc(db, 'vouchers', voucherId), payload);

      // Post balanced journal entry for voucher
      const jLines =
        input.type === 'receipt'
          ? [
              { accountId: 'ACC_1101', debit: amount, credit: 0 },
              {
                accountId: input.partyType === 'customer' ? 'ACC_1102' : 'ACC_3101',
                debit: 0,
                credit: amount,
              },
            ]
          : input.type === 'payment' && input.partyType === 'supplier'
            ? [
                { accountId: 'ACC_2101', debit: amount, credit: 0 },
                { accountId: 'ACC_1101', debit: 0, credit: amount },
              ]
            : [
                { accountId: 'ACC_5201', debit: amount, credit: 0 },
                { accountId: 'ACC_1101', debit: 0, credit: amount },
              ];

      const typeLabel =
        input.type === 'receipt' ? 'سند قبض' : input.type === 'payment' ? 'سند صرف' : 'مصروف';

      postJournalEntryInTx(tx, jCtx, {
        description: `قيد ${typeLabel} (${voucherNumber}) - ${input.category}${resolvedPartyName ? ` (${resolvedPartyName})` : ''}`,
        sourceType: 'voucher',
        sourceId: voucherId,
        sourceNumber: voucherNumber,
        rawLines: jLines,
        actor,
      });

      const audit = makeAuditEntry(
        actor,
        'CREATE_VOUCHER',
        'vouchers',
        voucherId,
        `تسجيل ${typeLabel} (${voucherNumber}) بمبلغ ${amount}`,
        `${input.category}${resolvedPartyName ? ` | الطرف: ${resolvedPartyName}` : ''}`
      );
      tx.set(audit.ref, audit.data);

      built = {
        ...(payload as unknown as Voucher),
        createdAt: Timestamp.now(),
      };
    });

    return built;
  } catch (err) {
    if (err instanceof Error && err.message.includes('مبلغ')) throw err;
    handleFirestoreError(err, OperationType.WRITE, `vouchers/${voucherId}`);
  }
}

// ============================================================================
// GENERAL ACCOUNTING: CHART OF ACCOUNTS, MANUAL JOURNALS & REVERSALS
// ============================================================================
export async function createCustomAccountTx(
  input: {
    code: string;
    name: string;
    type: AccountType;
    normalBalance: NormalBalance;
  },
  actor: ActorContext
): Promise<Account> {
  const cleanCode = sanitizeCode(input.code);
  if (!cleanCode) throw new Error('كود الحساب يجب أن يحتوي على أحرف أو أرقام إنجليزية صالحة.');
  const accountId = `ACC_${cleanCode}`;
  let built!: Account;

  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'accounts', accountId);
      const snap = await tx.get(ref);
      if (snap.exists()) {
        throw new Error(`كود الحساب (${cleanCode}) موجود مسبقاً في شجرة الحسابات.`);
      }

      const payload: Record<string, unknown> = {
        id: accountId,
        code: cleanCode.slice(0, 32),
        name: input.name.trim().slice(0, 120),
        type: input.type,
        normalBalance: input.normalBalance,
        balance: 0,
        isSystem: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      tx.set(ref, payload);

      const audit = makeAuditEntry(
        actor,
        'CREATE_ACCOUNT',
        'accounts',
        accountId,
        `إضافة حساب جديد في شجرة الحسابات: ${payload.name} (${cleanCode})`
      );
      tx.set(audit.ref, audit.data);

      built = {
        ...(payload as unknown as Account),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
    });
    return built;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('كود') || err.message.includes('موجود'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `accounts/${accountId}`);
  }
}

export async function createManualJournalEntryTx(
  input: {
    description: string;
    lines: { accountId: string; debit: number; credit: number }[];
  },
  actor: ActorContext
): Promise<JournalEntry> {
  let created!: JournalEntry;
  try {
    await runTransaction(db, async (tx) => {
      if (!input.description.trim()) throw new Error('يرجى إدخال بيان أو وصف القيد.');
      const validLines = input.lines.filter((l) => l.debit > 0 || l.credit > 0);
      if (validLines.length < 2) {
        throw new Error('يجب أن يحتوي القيد اليدوي على طرفين (مدين ودائن) على الأقل.');
      }

      const jCtx = await readJournalContext(
        tx,
        validLines.map((l) => l.accountId)
      );

      const entry = postJournalEntryInTx(tx, jCtx, {
        description: input.description,
        sourceType: 'manual',
        rawLines: validLines,
        actor,
      });

      if (!entry) throw new Error('تعذر إنشاء القيد، تأكد من المبالغ والبنود.');
      created = entry;

      const audit = makeAuditEntry(
        actor,
        'CREATE_MANUAL_JOURNAL',
        'journal_entries',
        entry.id,
        `إنشاء قيد يومي يدوي ${entry.entryNumber} بمبلغ ${entry.totalDebit}`,
        input.description
      );
      tx.set(audit.ref, audit.data);
    });
    return created;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('متوازن') ||
        err.message.includes('طرفين') ||
        err.message.includes('بيان') ||
        err.message.includes('موجود'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, 'journal_entries');
  }
}

export async function reverseJournalEntryTx(
  entry: JournalEntry,
  reason: string,
  actor: ActorContext
): Promise<JournalEntry> {
  let reversal!: JournalEntry;
  try {
    await runTransaction(db, async (tx) => {
      if (!reason.trim()) throw new Error('يجب توثيق سبب العكس المحاسبي.');
      const origRef = doc(db, 'journal_entries', entry.id);
      const origSnap = await tx.get(origRef);
      if (!origSnap.exists()) throw new Error('القيد المحاسبي غير موجود.');
      const orig = origSnap.data() as JournalEntry;
      if (orig.status === 'reversed') {
        throw new Error('تم عكس هذا القيد مسبقاً ولا يمكن تكرار العكس.');
      }

      const jCtx = await readJournalContext(
        tx,
        orig.lines.map((l) => l.accountId)
      );

      const revEntry = postJournalEntryInTx(tx, jCtx, {
        description: `عكس محاسبي للقيد ${orig.entryNumber}: ${reason.trim()}`,
        sourceType: 'reversal',
        sourceId: orig.id,
        sourceNumber: orig.entryNumber,
        rawLines: orig.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
        })),
        actor,
      });

      if (!revEntry) throw new Error('تعذر إنشاء قيد العكس.');
      reversal = revEntry;

      tx.update(origRef, {
        status: 'reversed',
        reversedByEntryId: revEntry.id,
      });

      const audit = makeAuditEntry(
        actor,
        'REVERSE_JOURNAL',
        'journal_entries',
        orig.id,
        `عكس محاسبي موثق للقيد ${orig.entryNumber} عبر القيد ${revEntry.entryNumber}`,
        `السبب: ${reason.trim()} | المبلغ: ${orig.totalDebit}`
      );
      tx.set(audit.ref, audit.data);
    });
    return reversal;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('سبب') || err.message.includes('عكس'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `journal_entries/${entry.id}`);
  }
}

// ============================================================================
// STAFF MANAGEMENT, SHOP SETTINGS & BACKUP RESTORE (ADMIN)
// ============================================================================
export interface StaffInviteInput {
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  permissions: StaffPermissions;
}

export async function createStaffInviteTx(
  input: StaffInviteInput,
  actor: ActorContext
): Promise<void> {
  const inviteId = generateDocId('INV_STF');
  try {
    await runTransaction(db, async (tx) => {
      const normalizedEmail = input.email.trim().toLowerCase();
      if (!normalizedEmail.includes('@')) throw new Error('يرجى إدخال بريد إلكتروني صحيح.');

      const payload: Record<string, unknown> = {
        id: inviteId,
        email: normalizedEmail.slice(0, 160),
        displayName: input.displayName.trim().slice(0, 100),
        role: input.role,
        status: 'active',
        permissions: input.permissions,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (input.phone?.trim()) payload.phone = input.phone.trim().slice(0, 30);

      tx.set(doc(db, 'staffInvites', inviteId), payload);

      const audit = makeAuditEntry(
        actor,
        'INVITE_STAFF',
        'staffInvites',
        inviteId,
        `إضافة موظف جديد: ${payload.displayName} (${normalizedEmail})`,
        `الدور: ${input.role}`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('بريد')) throw err;
    handleFirestoreError(err, OperationType.CREATE, `staffInvites/${inviteId}`);
  }
}

export async function updateStaffAccountTx(
  user: UserAccount,
  updates: {
    displayName: string;
    phone?: string;
    role: UserRole;
    status: 'active' | 'suspended';
    permissions: StaffPermissions;
  },
  actor: ActorContext
): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('حساب الموظف غير موجود.');
      const cur = snap.data();

      const payload: Record<string, unknown> = {
        uid: cur.uid,
        email: cur.email,
        displayName: updates.displayName.trim().slice(0, 100),
        role: updates.role,
        status: updates.status,
        permissions: updates.permissions,
        createdAt: cur.createdAt,
        updatedAt: serverTimestamp(),
      };
      if (updates.phone?.trim()) payload.phone = updates.phone.trim().slice(0, 30);
      if (cur.inviteId) payload.inviteId = cur.inviteId;
      if (cur.lastLoginAt) payload.lastLoginAt = cur.lastLoginAt;

      tx.set(ref, payload);

      const audit = makeAuditEntry(
        actor,
        'UPDATE_STAFF',
        'users',
        user.uid,
        `تحديث حساب الموظف: ${payload.displayName} (${updates.status === 'active' ? 'نشط' : 'موقوف'})`,
        `الدور: ${updates.role}`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateInviteStatusOrPermsTx(
  invite: StaffInvite,
  updates: {
    displayName: string;
    phone?: string;
    role: UserRole;
    status: 'active' | 'suspended';
    permissions: StaffPermissions;
  },
  actor: ActorContext
): Promise<void> {
  const path = `staffInvites/${invite.id}`;
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'staffInvites', invite.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('الدعوة غير موجودة.');
      const cur = snap.data();

      const payload: Record<string, unknown> = {
        id: cur.id,
        email: cur.email,
        displayName: updates.displayName.trim().slice(0, 100),
        role: updates.role,
        status: updates.status,
        permissions: updates.permissions,
        createdBy: cur.createdBy,
        createdAt: cur.createdAt,
        updatedAt: serverTimestamp(),
      };
      if (updates.phone?.trim()) payload.phone = updates.phone.trim().slice(0, 30);
      if (cur.claimedUid) payload.claimedUid = cur.claimedUid;

      tx.set(ref, payload);

      const audit = makeAuditEntry(
        actor,
        'UPDATE_INVITE',
        'staffInvites',
        invite.id,
        `تحديث دعوة الموظف: ${payload.displayName} (${updates.status === 'active' ? 'نشط' : 'موقوف'})`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateShopSettingsTx(
  input: Omit<ShopSettings, 'updatedAt'>,
  actor: ActorContext
): Promise<void> {
  const path = 'settings/shop';
  try {
    await runTransaction(db, async (tx) => {
      const payload: Record<string, unknown> = {
        shopName: input.shopName.trim().slice(0, 120) || 'بقالة الحسام',
        currency: input.currency.trim().slice(0, 16) || 'ر.ي',
        updatedAt: serverTimestamp(),
      };
      if (input.phone?.trim()) payload.phone = input.phone.trim().slice(0, 30);
      if (input.address?.trim()) payload.address = input.address.trim().slice(0, 250);
      if (input.taxNumber?.trim()) payload.taxNumber = input.taxNumber.trim().slice(0, 50);
      if (input.invoiceFooter?.trim()) payload.invoiceFooter = input.invoiceFooter.trim().slice(0, 300);
      if (typeof input.lowStockDefault === 'number') payload.lowStockDefault = Math.max(0, input.lowStockDefault);

      tx.set(doc(db, 'settings', 'shop'), payload);

      const audit = makeAuditEntry(
        actor,
        'UPDATE_SETTINGS',
        'settings',
        'shop',
        `تحديث إعدادات المتجر (${payload.shopName})`
      );
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function restoreBackupBatch(
  backup: {
    products?: Record<string, unknown>[];
    customers?: Record<string, unknown>[];
    suppliers?: Record<string, unknown>[];
    warehouses?: Record<string, unknown>[];
  },
  actor: ActorContext
): Promise<{
  productsRestored: number;
  customersRestored: number;
  suppliersRestored: number;
  warehousesRestored: number;
}> {
  let productsRestored = 0;
  let customersRestored = 0;
  let suppliersRestored = 0;
  let warehousesRestored = 0;

  try {
    const batch = writeBatch(db);
    let opCount = 0;

    if (Array.isArray(backup.warehouses)) {
      for (const item of backup.warehouses.slice(0, 30)) {
        if (!item.id || !item.code || !item.name) continue;
        const id = String(item.id);
        const whPayload: Record<string, unknown> = {
          id,
          code: sanitizeCode(String(item.code)).slice(0, 32),
          name: String(item.name).slice(0, 100),
          isDefault: Boolean(item.isDefault),
          isActive: item.isActive !== false,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (item.location) whPayload.location = String(item.location).slice(0, 200);
        batch.set(doc(db, 'warehouses', id), whPayload);
        warehousesRestored++;
        opCount++;
      }
    }

    if (Array.isArray(backup.products)) {
      for (const item of backup.products.slice(0, 140)) {
        if (!item.id || !item.code || !item.name) continue;
        const id = String(item.id);
        const code = sanitizeCode(String(item.code));
        const prodPayload: Record<string, unknown> = {
          id,
          code,
          name: String(item.name).slice(0, 160),
          unit: String(item.unit || 'قطعة').slice(0, 32),
          purchasePrice: Math.max(0, Number(item.purchasePrice) || 0),
          salePrice: Math.max(0, Number(item.salePrice) || 0),
          quantity: Math.max(0, Number(item.quantity) || 0),
          damagedQuantity: Math.max(0, Number(item.damagedQuantity) || 0),
          minStock: Math.max(0, Number(item.minStock) || 0),
          isActive: item.isActive !== false,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (item.barcode) prodPayload.barcode = String(item.barcode).slice(0, 64);
        if (item.category) prodPayload.category = String(item.category).slice(0, 80);
        if (item.expiryDate) prodPayload.expiryDate = String(item.expiryDate).slice(0, 20);
        if (item.warehouseId) prodPayload.warehouseId = String(item.warehouseId).slice(0, 128);
        if (item.warehouseName) prodPayload.warehouseName = String(item.warehouseName).slice(0, 100);

        batch.set(doc(db, 'products', id), prodPayload);
        batch.set(doc(db, 'productCodes', code), {
          code,
          productId: id,
          createdAt: serverTimestamp(),
        });
        productsRestored++;
        opCount += 2;
        if (opCount >= 380) break;
      }
    }

    if (Array.isArray(backup.customers) && opCount < 420) {
      for (const item of backup.customers.slice(0, 120)) {
        if (!item.id || !item.code || !item.name) continue;
        const id = String(item.id);
        batch.set(doc(db, 'customers', id), {
          id,
          code: sanitizeCode(String(item.code)),
          name: String(item.name).slice(0, 120),
          phone: item.phone ? String(item.phone).slice(0, 30) : '',
          address: item.address ? String(item.address).slice(0, 250) : '',
          totalPurchases: Math.max(0, Number(item.totalPurchases) || 0),
          totalPaid: Math.max(0, Number(item.totalPaid) || 0),
          balanceDue: Number(item.balanceDue) || 0,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        customersRestored++;
        opCount++;
        if (opCount >= 450) break;
      }
    }

    if (Array.isArray(backup.suppliers) && opCount < 460) {
      for (const item of backup.suppliers.slice(0, 80)) {
        if (!item.id || !item.code || !item.name) continue;
        const id = String(item.id);
        batch.set(doc(db, 'suppliers', id), {
          id,
          code: sanitizeCode(String(item.code)),
          name: String(item.name).slice(0, 120),
          phone: item.phone ? String(item.phone).slice(0, 30) : '',
          address: item.address ? String(item.address).slice(0, 250) : '',
          totalPurchases: Math.max(0, Number(item.totalPurchases) || 0),
          totalPaid: Math.max(0, Number(item.totalPaid) || 0),
          balanceDue: Number(item.balanceDue) || 0,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        suppliersRestored++;
        opCount++;
        if (opCount >= 490) break;
      }
    }

    const audit = makeAuditEntry(
      actor,
      'RESTORE_BACKUP',
      'settings',
      'backup',
      `استعادة نسخة احتياطية: ${productsRestored} صنف، ${customersRestored} عميل، ${suppliersRestored} مورد، ${warehousesRestored} مستودع`
    );
    batch.set(audit.ref, audit.data);

    await batch.commit();
    return { productsRestored, customersRestored, suppliersRestored, warehousesRestored };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'backup/restore');
  }
}

export type { AuditLog };
