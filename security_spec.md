# Security Specification — Mizan Pro Accounting & POS System

## 1. Data Invariants
1. **Strict Staff Gate**: Only verified Google accounts registered as `active` in `/users/{uid}` (or the bootstrapped primary admin `alhosamshop2027@gmail.com`) can read or write any shop operational data.
2. **No Self-Privilege Escalation**: An employee cannot create or update `/users/{uid}` with `role: 'admin'` or alter their `status` or `permissions` map; employee registration requires a matching `/staffInvites/{inviteId}` document created by an Admin whose `email` matches `request.auth.token.email`.
3. **Immutable Audit Trail**: `/audit_logs/{logId}` entries must have `actorId == request.auth.uid` and `createdAt == request.time`, and can NEVER be updated or deleted by anyone (including employees and admins).
4. **SKU Uniqueness & Integrity**: `/products/{productId}` requires valid non-negative prices/quantities and strict field schemas; base `purchasePrice`/`salePrice` edits require `isAdmin()` or explicit `canEditPrices` permission.
5. **Sales & Financial Integrity**: `/sales/{saleId}` requires `employeeId == request.auth.uid` on creation (unless Admin), `createdAt == request.time`, non-negative amounts, bounded `items` array (`<= 100`), and employees cannot delete sales or modify completed invoices without `canCancelInvoice` / Admin role.
6. **Financial Accounts Protection**: `/vouchers/{voucherId}` (expenses, treasury adjustments) and `/settings/treasury` updates follow strict permission checks; employees cannot delete vouchers or manipulate shop settings.
7. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps must equal `request.time`.
8. **PII Isolation**: `/users/{userId}` contains email and phone PII; employees can only `get` their own profile while only `isAdmin()` can `list` or manage all staff profiles.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: Anonymous user attempts `getDocs(collection(db, 'sales'))`.
2. **Unverified Email Spoof**: User with `email_verified: false` attempts to read `/products`.
3. **Self-Admin Escalation**: Random signed-in user attempts `setDoc(doc(db, 'users', uid), { role: 'admin', status: 'active', ... })`.
4. **Employee Permission Tampering**: Active employee attempts `updateDoc(doc(db, 'users', uid), { permissions: { canCancelInvoice: true } })`.
5. **Suspended Employee Access**: Employee with `status: 'suspended'` attempts to create a sale in `/sales`.
6. **Shadow Field Injection**: Employee attempts `setDoc` on `/products/p1` with extra ghost field `{ isVerified: true }`.
7. **Employee Deleting Sale**: Active employee attempts `deleteDoc(doc(db, 'sales', 's1'))`.
8. **Audit Log Tampering**: Employee or Admin attempts `updateDoc` or `deleteDoc` on `/audit_logs/log1`.
9. **Spoofed Actor in Sale**: Employee A attempts to create a sale with `employeeId: 'employee_B_uid'`.
10. **Forged Timestamp**: Client attempts to create `/sales/s1` with a backdated `createdAt` timestamp instead of `serverTimestamp()`.
11. **PII Blanket Read**: Employee attempts `getDocs(collection(db, 'users'))` to scrape all staff emails and phones.
12. **Resource Poisoning / Oversized ID**: Attacker attempts to write to `/products/<200-char-invalid-id!@#>` or inject a 1MB description string.
