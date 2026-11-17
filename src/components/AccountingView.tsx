import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Scale,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { exportToExcel, triggerPrint } from '../lib/exportUtils';
import { formatReadableError } from '../lib/firestoreError';
import { formatCurrency, formatDateTime, formatNumber, toDate } from '../lib/formatters';
import {
  createCustomAccountTx,
  createManualJournalEntryTx,
  reverseJournalEntryTx,
} from '../services/accountingService';
import {
  Account,
  AccountType,
  JournalEntry,
  JournalSourceType,
  NormalBalance,
} from '../types/accounting';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'الأصول',
  liability: 'الالتزامات',
  equity: 'حقوق الملكية',
  revenue: 'الإيرادات',
  expense: 'المصروفات والتكاليف',
};

const SOURCE_TYPE_LABELS: Record<JournalSourceType, string> = {
  sale: 'فاتورة مبيعات',
  purchase: 'فاتورة مشتريات',
  sale_return: 'مرتجع مبيعات',
  purchase_return: 'مرتجع مشتريات',
  voucher: 'سند مالي',
  stock_adjustment: 'تسوية / جرد / تلف',
  manual: 'قيد يدوي',
  reversal: 'قيد عكسي',
};

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
}

export function AccountingView() {
  const { userAccount } = useAuth();
  const { accounts, journalEntries, shopSettings } = useData();
  const currency = shopSettings?.currency || 'ر.ي';

  const [subTab, setSubTab] = useState<'chart' | 'journals' | 'ledger' | 'statements'>('chart');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add Custom Account Modal
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('expense');
  const [accNormal, setAccNormal] = useState<NormalBalance>('debit');
  const [savingAcc, setSavingAcc] = useState(false);

  // Journal Entries Filter & Modals
  const [journalSearch, setJournalSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | JournalSourceType>('all');
  const [showManualJournal, setShowManualJournal] = useState(false);
  const [manualDesc, setManualDesc] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { accountId: 'ACC_5201', debit: '', credit: '' },
    { accountId: 'ACC_1101', debit: '', credit: '' },
  ]);
  const [savingJournal, setSavingJournal] = useState(false);

  // Reverse Journal Modal
  const [reverseTarget, setReverseTarget] = useState<JournalEntry | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  // Ledger Selection
  const [ledgerAccountId, setLedgerAccountId] = useState<string>('ACC_1101');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');

  // Account groups for Chart of Accounts
  const groupedAccounts = useMemo(() => {
    const groups: Record<AccountType, Account[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };
    for (const acc of accounts) {
      if (groups[acc.type]) groups[acc.type].push(acc);
    }
    return groups;
  }, [accounts]);

  // Filtered Journal Entries
  const filteredJournals = useMemo(() => {
    const q = journalSearch.trim().toLowerCase();
    return journalEntries
      .filter((j) => sourceFilter === 'all' || j.sourceType === sourceFilter)
      .filter((j) => {
        if (!q) return true;
        return (
          j.entryNumber.toLowerCase().includes(q) ||
          j.description.toLowerCase().includes(q) ||
          (j.sourceNumber && j.sourceNumber.toLowerCase().includes(q)) ||
          j.lines.some((l) => l.accountName.toLowerCase().includes(q) || l.accountCode.toLowerCase().includes(q))
        );
      });
  }, [journalEntries, journalSearch, sourceFilter]);

  // Draft manual journal totals
  const draftTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of draftLines) {
      debit += Math.max(0, Number(l.debit) || 0);
      credit += Math.max(0, Number(l.credit) || 0);
    }
    debit = Math.round(debit * 100) / 100;
    credit = Math.round(credit * 100) / 100;
    return {
      debit,
      credit,
      diff: Math.round(Math.abs(debit - credit) * 100) / 100,
      balanced: debit > 0 && credit > 0 && Math.abs(debit - credit) < 0.005,
    };
  }, [draftLines]);

  // General Ledger rows for selected account
  const selectedLedgerAccount = useMemo(
    () => accounts.find((a) => a.id === ledgerAccountId) || accounts[0] || null,
    [accounts, ledgerAccountId]
  );

  const ledgerRows = useMemo(() => {
    if (!selectedLedgerAccount) return [];
    const chronological = [...journalEntries].sort(
      (a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)
    );

    const rows: {
      id: string;
      date: JournalEntry['createdAt'];
      entryNumber: string;
      sourceNumber?: string;
      description: string;
      status: JournalEntry['status'];
      debit: number;
      credit: number;
      runningBalance: number;
    }[] = [];

    let running = 0;
    for (const j of chronological) {
      const matchingLines = j.lines.filter((l) => l.accountId === selectedLedgerAccount.id);
      if (matchingLines.length === 0) continue;

      const debit = matchingLines.reduce((s, l) => s + (l.debit || 0), 0);
      const credit = matchingLines.reduce((s, l) => s + (l.credit || 0), 0);

      if (selectedLedgerAccount.normalBalance === 'debit') {
        running = Math.round((running + debit - credit) * 100) / 100;
      } else {
        running = Math.round((running + credit - debit) * 100) / 100;
      }

      const d = toDate(j.createdAt);
      if (ledgerFrom) {
        const f = new Date(ledgerFrom);
        f.setHours(0, 0, 0, 0);
        if (d < f) continue;
      }
      if (ledgerTo) {
        const t = new Date(ledgerTo);
        t.setHours(23, 59, 59, 999);
        if (d > t) continue;
      }

      rows.push({
        id: j.id,
        date: j.createdAt,
        entryNumber: j.entryNumber,
        sourceNumber: j.sourceNumber,
        description: j.description,
        status: j.status,
        debit,
        credit,
        runningBalance: running,
      });
    }

    return rows;
  }, [selectedLedgerAccount, journalEntries, ledgerFrom, ledgerTo]);

  // Financial Statements from Chart of Accounts
  const statements = useMemo(() => {
    const signedBalance = (acc: Account, expectedNormal: NormalBalance) =>
      acc.normalBalance === expectedNormal ? acc.balance || 0 : -(acc.balance || 0);

    const revenueAccounts = groupedAccounts.revenue.map((a) => ({
      ...a,
      effective: signedBalance(a, 'credit'),
    }));
    const expenseAccounts = groupedAccounts.expense.map((a) => ({
      ...a,
      effective: signedBalance(a, 'debit'),
    }));

    const totalRevenue = Math.round(
      revenueAccounts.reduce((s, a) => s + a.effective, 0) * 100
    ) / 100;
    const totalExpenses = Math.round(
      expenseAccounts.reduce((s, a) => s + a.effective, 0) * 100
    ) / 100;
    const netIncome = Math.round((totalRevenue - totalExpenses) * 100) / 100;

    const assetAccounts = groupedAccounts.asset.map((a) => ({
      ...a,
      effective: signedBalance(a, 'debit'),
    }));
    const liabilityAccounts = groupedAccounts.liability.map((a) => ({
      ...a,
      effective: signedBalance(a, 'credit'),
    }));
    const equityAccounts = groupedAccounts.equity.map((a) => ({
      ...a,
      effective: signedBalance(a, 'credit'),
    }));

    const totalAssets = Math.round(assetAccounts.reduce((s, a) => s + a.effective, 0) * 100) / 100;
    const totalLiabilities = Math.round(
      liabilityAccounts.reduce((s, a) => s + a.effective, 0) * 100
    ) / 100;
    const totalBaseEquity = Math.round(
      equityAccounts.reduce((s, a) => s + a.effective, 0) * 100
    ) / 100;
    const totalEquityWithNet = Math.round((totalBaseEquity + netIncome) * 100) / 100;
    const totalLiabAndEquity = Math.round((totalLiabilities + totalEquityWithNet) * 100) / 100;

    return {
      revenueAccounts,
      expenseAccounts,
      totalRevenue,
      totalExpenses,
      netIncome,
      assetAccounts,
      liabilityAccounts,
      equityAccounts,
      totalAssets,
      totalLiabilities,
      totalBaseEquity,
      totalEquityWithNet,
      totalLiabAndEquity,
      isBalanced: Math.abs(totalAssets - totalLiabAndEquity) < 0.05,
    };
  }, [groupedAccounts]);

  const handleAccountTypeChange = (nextType: AccountType) => {
    setAccType(nextType);
    setAccNormal(nextType === 'asset' || nextType === 'expense' ? 'debit' : 'credit');
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingAcc(true);
    try {
      const created = await createCustomAccountTx(
        {
          code: accCode,
          name: accName,
          type: accType,
          normalBalance: accNormal,
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setSuccessMsg(`تمت إضافة الحساب (${created.code} - ${created.name}) إلى شجرة الحسابات.`);
      setShowAddAccount(false);
      setAccCode('');
      setAccName('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingAcc(false);
    }
  };

  const handleCreateManualJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSavingJournal(true);
    try {
      const created = await createManualJournalEntryTx(
        {
          description: manualDesc,
          lines: draftLines.map((l) => ({
            accountId: l.accountId,
            debit: Math.max(0, Number(l.debit) || 0),
            credit: Math.max(0, Number(l.credit) || 0),
          })),
        },
        {
          uid: userAccount.uid,
          displayName: userAccount.displayName,
          role: userAccount.role,
        }
      );
      setSuccessMsg(`تم اعتماد القيد اليومي ${created.entryNumber} بمبلغ ${formatCurrency(created.totalDebit, currency)}.`);
      setShowManualJournal(false);
      setManualDesc('');
      setDraftLines([
        { accountId: 'ACC_5201', debit: '', credit: '' },
        { accountId: 'ACC_1101', debit: '', credit: '' },
      ]);
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setSavingJournal(false);
    }
  };

  const handleReverseJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccount || !reverseTarget) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setReversing(true);
    try {
      const rev = await reverseJournalEntryTx(reverseTarget, reverseReason, {
        uid: userAccount.uid,
        displayName: userAccount.displayName,
        role: userAccount.role,
      });
      setSuccessMsg(
        `تم عكس القيد ${reverseTarget.entryNumber} محاسبياً عبر القيد العكسي ${rev.entryNumber}.`
      );
      setReverseTarget(null);
      setReverseReason('');
    } catch (err) {
      setErrorMsg(formatReadableError(err));
    } finally {
      setReversing(false);
    }
  };

  const handleExportLedger = () => {
    if (!selectedLedgerAccount || ledgerRows.length === 0) return;
    const rows = ledgerRows.map((r) => ({
      التاريخ: formatDateTime(r.date),
      'رقم القيد': r.entryNumber,
      المرجع: r.sourceNumber || '—',
      البيان: r.description,
      مدين: r.debit,
      دائن: r.credit,
      'الرصيد الجاري': r.runningBalance,
    }));
    exportToExcel(rows, `دفتر الأستاذ - ${selectedLedgerAccount.name}`, `ledger_${selectedLedgerAccount.code}`);
  };

  return (
    <div className="space-y-4">
      {/* Sub-navigation bar */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('chart')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              subTab === 'chart' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>شجرة الحسابات ({accounts.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('journals')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              subTab === 'journals' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>القيود اليومية ({journalEntries.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              subTab === 'ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>دفتر الأستاذ</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('statements')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              subTab === 'statements' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>الميزانية والأرباح والخسائر</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {subTab === 'chart' && (
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setShowAddAccount(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>حساب جديد</span>
            </button>
          )}
          {subTab === 'journals' && (
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setShowManualJournal(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>قيد يومي يدوي</span>
            </button>
          )}
          {(subTab === 'ledger' || subTab === 'statements') && (
            <button
              type="button"
              onClick={triggerPrint}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / PDF</span>
            </button>
          )}
        </div>
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

      {/* TAB 1: CHART OF ACCOUNTS */}
      {subTab === 'chart' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {(['asset', 'liability', 'equity', 'revenue', 'expense'] as AccountType[]).map((t) => {
              const sum = groupedAccounts[t].reduce((s, a) => {
                const expected: NormalBalance = t === 'asset' || t === 'expense' ? 'debit' : 'credit';
                return s + (a.normalBalance === expected ? a.balance : -a.balance);
              }, 0);
              return (
                <div key={t} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">{ACCOUNT_TYPE_LABELS[t]}</div>
                  <div className="text-base font-bold font-mono-num text-slate-900 mt-1">
                    {formatCurrency(sum, currency)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {groupedAccounts[t].length} حسابات
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">دليل وشجرة الحسابات</h3>
              <span className="text-xs text-slate-500">
                تتحدث الأرصدة لحظياً مع كل فاتورة أو سند أو تسوية مخزون
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">رقم الحساب</th>
                    <th className="py-3 px-4 font-semibold">اسم الحساب</th>
                    <th className="py-3 px-4 font-semibold">التصنيف</th>
                    <th className="py-3 px-4 font-semibold">الطبيعة</th>
                    <th className="py-3 px-4 font-semibold text-left">الرصيد الحالي</th>
                    <th className="py-3 px-4 font-semibold">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono-num font-semibold text-slate-800">
                        {acc.code}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {acc.name}
                        {acc.isSystem && (
                          <span className="mr-2 text-[11px] text-slate-400">(أساسي)</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{ACCOUNT_TYPE_LABELS[acc.type]}</td>
                      <td className="py-3 px-4 text-slate-600">
                        {acc.normalBalance === 'debit' ? 'مدين' : 'دائن'}
                      </td>
                      <td
                        className={`py-3 px-4 text-left font-mono-num font-bold ${
                          acc.balance < 0 ? 'text-rose-700' : 'text-slate-900'
                        }`}
                      >
                        {formatCurrency(acc.balance, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            setLedgerAccountId(acc.id);
                            setSubTab('ledger');
                          }}
                          className="text-emerald-700 hover:underline font-medium cursor-pointer"
                        >
                          دفتر الأستاذ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: JOURNAL ENTRIES */}
      {subTab === 'journals' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={journalSearch}
                onChange={(e) => setJournalSearch(e.target.value)}
                placeholder="بحث برقم القيد أو المرجع أو البيان أو الحساب..."
                className="w-full pr-10 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'all' | JournalSourceType)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">جميع مصادر القيود</option>
              {(Object.keys(SOURCE_TYPE_LABELS) as JournalSourceType[]).map((k) => (
                <option key={k} value={k}>
                  {SOURCE_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            {filteredJournals.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
                لا توجد قيود يومية مطابقة.
              </div>
            ) : (
              filteredJournals.map((entry) => (
                <div
                  key={entry.id}
                  className={`bg-white border rounded-xl overflow-hidden ${
                    entry.status === 'reversed' ? 'border-amber-200 bg-amber-50/20' : 'border-slate-200'
                  }`}
                >
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono-num font-bold text-slate-900">
                        {entry.entryNumber}
                      </span>
                      <span className="text-slate-600">{SOURCE_TYPE_LABELS[entry.sourceType]}</span>
                      {entry.sourceNumber && (
                        <span className="font-mono-num text-slate-500">
                          المرجع: {entry.sourceNumber}
                        </span>
                      )}
                      <span
                        className={`font-semibold ${
                          entry.status === 'reversed' ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {entry.status === 'reversed' ? 'معكوس محاسبياً' : 'معتمد'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 font-mono-num">
                        {formatDateTime(entry.createdAt)} · {entry.employeeName}
                      </span>
                      {entry.status === 'posted' && entry.sourceType !== 'reversal' && (
                        <button
                          type="button"
                          onClick={() => {
                            setReverseTarget(entry);
                            setReverseReason('');
                            setErrorMsg(null);
                          }}
                          className="text-amber-700 hover:underline font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>عكس القيد</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="px-5 py-3 text-xs text-slate-800 font-medium border-b border-slate-100">
                    {entry.description}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-right">
                      <thead className="text-slate-500 bg-slate-50/50 border-b border-slate-100">
                        <tr>
                          <th className="py-2 px-4 font-semibold">رقم الحساب</th>
                          <th className="py-2 px-4 font-semibold">اسم الحساب</th>
                          <th className="py-2 px-4 font-semibold text-left">مدين</th>
                          <th className="py-2 px-4 font-semibold text-left">دائن</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {entry.lines.map((line, idx) => (
                          <tr key={`${entry.id}-${idx}`}>
                            <td className="py-2 px-4 font-mono-num text-slate-600">
                              {line.accountCode}
                            </td>
                            <td className="py-2 px-4 font-medium text-slate-900">
                              {line.accountName}
                            </td>
                            <td className="py-2 px-4 text-left font-mono-num text-emerald-700 font-semibold">
                              {line.debit > 0 ? formatCurrency(line.debit, currency) : '—'}
                            </td>
                            <td className="py-2 px-4 text-left font-mono-num text-rose-700 font-semibold">
                              {line.credit > 0 ? formatCurrency(line.credit, currency) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 font-bold text-slate-900 border-t border-slate-200">
                        <tr>
                          <td colSpan={2} className="py-2 px-4">
                            الإجمالي المتوازن
                          </td>
                          <td className="py-2 px-4 text-left font-mono-num">
                            {formatCurrency(entry.totalDebit, currency)}
                          </td>
                          <td className="py-2 px-4 text-left font-mono-num">
                            {formatCurrency(entry.totalCredit, currency)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: GENERAL LEDGER */}
      {subTab === 'ledger' && (
        <div className="space-y-4">
          <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">الحساب</label>
                <select
                  value={selectedLedgerAccount?.id || ''}
                  onChange={(e) => setLedgerAccountId(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white min-w-[240px]"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">من تاريخ</label>
                <input
                  type="date"
                  value={ledgerFrom}
                  onChange={(e) => setLedgerFrom(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">إلى تاريخ</label>
                <input
                  type="date"
                  value={ledgerTo}
                  onChange={(e) => setLedgerTo(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={ledgerRows.length === 0}
              onClick={handleExportLedger}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تصدير Excel</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden print-container">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">
                  دفتر الأستاذ: {selectedLedgerAccount?.name || '—'} ({selectedLedgerAccount?.code})
                </h3>
                <div className="text-xs text-slate-500 mt-0.5">
                  الطبيعة: {selectedLedgerAccount?.normalBalance === 'debit' ? 'مدين' : 'دائن'} ·
                  الرصيد الحالي:{' '}
                  <span className="font-mono-num font-bold text-slate-900">
                    {formatCurrency(selectedLedgerAccount?.balance || 0, currency)}
                  </span>
                </div>
              </div>
              <div className="text-xs text-slate-500 font-mono-num">
                عدد الحركات: {ledgerRows.length}
              </div>
            </div>

            {ledgerRows.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                لا توجد حركات مسجلة لهذا الحساب في الفترة المحددة.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-semibold">التاريخ</th>
                      <th className="py-3 px-4 font-semibold">رقم القيد</th>
                      <th className="py-3 px-4 font-semibold">المرجع</th>
                      <th className="py-3 px-4 font-semibold">البيان</th>
                      <th className="py-3 px-4 font-semibold text-left">مدين</th>
                      <th className="py-3 px-4 font-semibold text-left">دائن</th>
                      <th className="py-3 px-4 font-semibold text-left">الرصيد الجاري</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                          {formatDateTime(row.date)}
                        </td>
                        <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-800">
                          {row.entryNumber}
                        </td>
                        <td className="py-2.5 px-4 font-mono-num text-slate-500">
                          {row.sourceNumber || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-800">{row.description}</td>
                        <td className="py-2.5 px-4 text-left font-mono-num text-emerald-700">
                          {row.debit > 0 ? formatCurrency(row.debit, currency) : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-left font-mono-num text-rose-700">
                          {row.credit > 0 ? formatCurrency(row.credit, currency) : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-left font-mono-num font-bold text-slate-900">
                          {formatCurrency(row.runningBalance, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: INCOME STATEMENT & BALANCE SHEET */}
      {subTab === 'statements' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print-container">
          {/* Income Statement */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-bold text-slate-900">قائمة الدخل (الأرباح والخسائر)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {shopSettings?.shopName || 'بقالة الحسام'} — مستخرجة آلياً من أرصدة دفتر الأستاذ
              </p>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="space-y-2">
                <div className="font-bold text-slate-800 pb-1 border-b border-slate-200">
                  الإيرادات
                </div>
                {statements.revenueAccounts.map((acc) => (
                  <div key={acc.id} className="flex justify-between">
                    <span className="text-slate-700">
                      <span className="font-mono-num text-slate-400 ml-1.5">{acc.code}</span>
                      {acc.name}
                    </span>
                    <span
                      className={`font-mono-num font-semibold ${
                        acc.effective < 0 ? 'text-amber-700' : 'text-slate-900'
                      }`}
                    >
                      {formatCurrency(acc.effective, currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-900">
                  <span>صافي الإيرادات</span>
                  <span className="font-mono-num">
                    {formatCurrency(statements.totalRevenue, currency)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="font-bold text-slate-800 pb-1 border-b border-slate-200">
                  التكاليف والمصروفات
                </div>
                {statements.expenseAccounts.map((acc) => (
                  <div key={acc.id} className="flex justify-between">
                    <span className="text-slate-700">
                      <span className="font-mono-num text-slate-400 ml-1.5">{acc.code}</span>
                      {acc.name}
                    </span>
                    <span className="font-mono-num font-semibold text-rose-700">
                      {formatCurrency(acc.effective, currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-rose-700">
                  <span>إجمالي التكاليف والمصروفات</span>
                  <span className="font-mono-num">
                    {formatCurrency(statements.totalExpenses, currency)}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-sm font-bold">
                <span className="text-slate-900">صافي الربح / (الخسارة) المحاسبي</span>
                <span
                  className={`font-mono-num ${
                    statements.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {formatCurrency(statements.netIncome, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Balance Sheet */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">الميزانية العمومية (المركز المالي)</h3>
                <p className="text-xs text-slate-500 mt-0.5">الأصول = الالتزامات + حقوق الملكية</p>
              </div>
              <div
                className={`text-xs font-semibold flex items-center gap-1 ${
                  statements.isBalanced ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{statements.isBalanced ? 'متوازنة' : 'فحص أرصدة افتتاحية'}</span>
              </div>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="space-y-2">
                <div className="font-bold text-slate-800 pb-1 border-b border-slate-200">
                  الأصول
                </div>
                {statements.assetAccounts.map((acc) => (
                  <div key={acc.id} className="flex justify-between">
                    <span className="text-slate-700">
                      <span className="font-mono-num text-slate-400 ml-1.5">{acc.code}</span>
                      {acc.name}
                    </span>
                    <span className="font-mono-num font-semibold text-slate-900">
                      {formatCurrency(acc.effective, currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-900 text-sm">
                  <span>إجمالي الأصول</span>
                  <span className="font-mono-num">
                    {formatCurrency(statements.totalAssets, currency)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="font-bold text-slate-800 pb-1 border-b border-slate-200">
                  الالتزامات (الخصوم)
                </div>
                {statements.liabilityAccounts.map((acc) => (
                  <div key={acc.id} className="flex justify-between">
                    <span className="text-slate-700">
                      <span className="font-mono-num text-slate-400 ml-1.5">{acc.code}</span>
                      {acc.name}
                    </span>
                    <span className="font-mono-num font-semibold text-slate-900">
                      {formatCurrency(acc.effective, currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-800">
                  <span>إجمالي الالتزامات</span>
                  <span className="font-mono-num">
                    {formatCurrency(statements.totalLiabilities, currency)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="font-bold text-slate-800 pb-1 border-b border-slate-200">
                  حقوق الملكية
                </div>
                {statements.equityAccounts.map((acc) => (
                  <div key={acc.id} className="flex justify-between">
                    <span className="text-slate-700">
                      <span className="font-mono-num text-slate-400 ml-1.5">{acc.code}</span>
                      {acc.name}
                    </span>
                    <span className="font-mono-num font-semibold text-slate-900">
                      {formatCurrency(acc.effective, currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-slate-700">أرباح / (خسائر) الفترة المرحلة</span>
                  <span
                    className={`font-mono-num font-semibold ${
                      statements.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {formatCurrency(statements.netIncome, currency)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-800">
                  <span>إجمالي حقوق الملكية</span>
                  <span className="font-mono-num">
                    {formatCurrency(statements.totalEquityWithNet, currency)}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-sm font-bold">
                <span className="text-slate-900">إجمالي الالتزامات وحقوق الملكية</span>
                <span className="font-mono-num text-emerald-700">
                  {formatCurrency(statements.totalLiabAndEquity, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Custom Account */}
      {showAddAccount && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">إضافة حساب جديد للشجرة</h3>
              <button type="button" onClick={() => setShowAddAccount(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  رقم / كود الحساب * (أرقام أو أحرف إنجليزية)
                </label>
                <input
                  type="text"
                  required
                  value={accCode}
                  onChange={(e) => setAccCode(e.target.value)}
                  placeholder="مثال: 5205"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم الحساب *</label>
                <input
                  type="text"
                  required
                  value={accName}
                  onChange={(e) => setAccName(e.target.value)}
                  placeholder="مثال: مصروفات الكهرباء والإيجار"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">نوع الحساب</label>
                  <select
                    value={accType}
                    onChange={(e) => handleAccountTypeChange(e.target.value as AccountType)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
                      <option key={t} value={t}>
                        {ACCOUNT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الطبيعة</label>
                  <select
                    value={accNormal}
                    onChange={(e) => setAccNormal(e.target.value as NormalBalance)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="debit">مدين</option>
                    <option value="credit">دائن</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddAccount(false)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingAcc}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                >
                  {savingAcc ? 'جاري الحفظ...' : 'إضافة الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Manual Journal Entry */}
      {showManualJournal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">إنشاء قيد يومي يدوي</h3>
              <button type="button" onClick={() => setShowManualJournal(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateManualJournal} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  بيان وشرح القيد *
                </label>
                <input
                  type="text"
                  required
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                  placeholder="مثال: إثبات رأس مال افتتاحي أو تسوية عهدة"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">أطراف القيد</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftLines((prev) => [
                        ...prev,
                        { accountId: accounts[0]?.id || 'ACC_1101', debit: '', credit: '' },
                      ])
                    }
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة سطر</span>
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">الحساب</th>
                        <th className="py-2 px-3 w-28">مدين</th>
                        <th className="py-2 px-3 w-28">دائن</th>
                        <th className="py-2 px-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftLines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="p-2">
                            <select
                              value={line.accountId}
                              onChange={(e) =>
                                setDraftLines((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, accountId: e.target.value } : row
                                  )
                                )
                              }
                              className="w-full px-2 py-1.5 border border-slate-200 rounded bg-white"
                            >
                              {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.code} — {a.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.debit}
                              onChange={(e) =>
                                setDraftLines((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, debit: e.target.value, credit: e.target.value ? '' : row.credit }
                                      : row
                                  )
                                )
                              }
                              placeholder="0.00"
                              className="w-full px-2 py-1.5 border border-slate-200 rounded font-mono-num text-left"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.credit}
                              onChange={(e) =>
                                setDraftLines((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, credit: e.target.value, debit: e.target.value ? '' : row.debit }
                                      : row
                                  )
                                )
                              }
                              placeholder="0.00"
                              className="w-full px-2 py-1.5 border border-slate-200 rounded font-mono-num text-left"
                            />
                          </td>
                          <td className="p-2 text-center">
                            {draftLines.length > 2 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftLines((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  إجمالي المدين:{' '}
                  <span className="font-mono-num font-bold">
                    {formatCurrency(draftTotals.debit, currency)}
                  </span>
                </div>
                <div>
                  إجمالي الدائن:{' '}
                  <span className="font-mono-num font-bold">
                    {formatCurrency(draftTotals.credit, currency)}
                  </span>
                </div>
                <div
                  className={`font-semibold ${
                    draftTotals.balanced ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {draftTotals.balanced
                    ? 'القيد متوازن وجاهز للاعتماد'
                    : `الفرق: ${formatNumber(draftTotals.diff)}`}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualJournal(false)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingJournal || !draftTotals.balanced}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg cursor-pointer"
                >
                  {savingJournal ? 'جاري الاعتماد...' : 'اعتماد القيد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reverse Journal Entry */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                عكس القيد المحاسبي ({reverseTarget.entryNumber})
              </h3>
              <button type="button" onClick={() => setReverseTarget(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 leading-relaxed">
              وفق المعايير المحاسبية الصارمة، لا يتم حذف القيود المعتمدة، بل يُنشأ قيد عكسي موثق بنفس المبلغ ({formatCurrency(reverseTarget.totalDebit, currency)}) ويُحدّث ميزان الحسابات وسجل التدقيق تلقائياً.
            </div>
            <form onSubmit={handleReverseJournal} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  سبب العكس المحاسبي *
                </label>
                <textarea
                  required
                  rows={2}
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="اذكر السبب لتوثيقه في سجل التدقيق..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReverseTarget(null)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  تراجع
                </button>
                <button
                  type="submit"
                  disabled={reversing}
                  className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg cursor-pointer"
                >
                  {reversing ? 'جاري التنفيذ...' : 'تأكيد العكس المحاسبي'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
