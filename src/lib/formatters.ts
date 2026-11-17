import { Timestamp } from 'firebase/firestore';

export function formatCurrency(amount: number, currency = 'ر.ي'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

export function formatNumber(num: number): string {
  const safe = Number.isFinite(num) ? num : 0;
  return safe.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
}

export function toDate(ts?: Timestamp | Date | { seconds: number } | null): Date {
  if (!ts) return new Date();
  if (ts instanceof Date) return ts;
  if (typeof (ts as Timestamp).toDate === 'function') {
    return (ts as Timestamp).toDate();
  }
  if (typeof (ts as { seconds: number }).seconds === 'number') {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  return new Date();
}

export function formatDateTime(ts?: Timestamp | Date | { seconds: number } | null): string {
  if (!ts) return 'قيد المزامنة...';
  const d = toDate(ts);
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  });
}

export function formatDateOnly(ts?: Timestamp | Date | { seconds: number } | null): string {
  if (!ts) return '—';
  const d = toDate(ts);
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    numberingSystem: 'latn',
  });
}

export function isSameDay(ts: Timestamp | Date | null | undefined, target: Date): boolean {
  if (!ts) return false;
  const d = toDate(ts);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

export function isSameMonth(ts: Timestamp | Date | null | undefined, target: Date): boolean {
  if (!ts) return false;
  const d = toDate(ts);
  return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth();
}

export function isSameYear(ts: Timestamp | Date | null | undefined, target: Date): boolean {
  if (!ts) return false;
  const d = toDate(ts);
  return d.getFullYear() === target.getFullYear();
}

export function getExpiryStatus(
  expiryDate?: string
): { status: 'none' | 'ok' | 'expiring_soon' | 'expired'; daysLeft: number | null } {
  if (!expiryDate) return { status: 'none', daysLeft: null };
  const target = new Date(`${expiryDate}T23:59:59`);
  if (Number.isNaN(target.getTime())) return { status: 'none', daysLeft: null };
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { status: 'expired', daysLeft: diffDays };
  if (diffDays <= 30) return { status: 'expiring_soon', daysLeft: diffDays };
  return { status: 'ok', daysLeft: diffDays };
}

export function buildWhatsAppUrl(phone: string | undefined, message: string): string {
  const encoded = encodeURIComponent(message);
  if (!phone || !phone.trim()) {
    return `https://wa.me/?text=${encoded}`;
  }
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);
  else if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  // Normalize local Yemeni 9-digit mobile numbers starting with 7 (e.g. 77xxxxxxx -> 96777xxxxxxx)
  else if (/^7[0-9]{8}$/.test(cleaned)) cleaned = `967${cleaned}`;
  // Normalize local 07xxxxxxxx -> 9677xxxxxxxx
  else if (/^07[0-9]{8}$/.test(cleaned)) cleaned = `967${cleaned.slice(1)}`;
  // Normalize local Saudi 05xxxxxxxx -> 9665xxxxxxxx
  else if (/^05[0-9]{8}$/.test(cleaned)) cleaned = `966${cleaned.slice(1)}`;

  return `https://wa.me/${cleaned}?text=${encoded}`;
}

export function sanitizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_\-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

export function generateDocId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}_${ts}_${rnd}`;
}
