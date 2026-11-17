import { auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatReadableError(err: unknown): string {
  if (!(err instanceof Error)) return 'حدث خطأ غير متوقع أثناء تنفيذ العملية.';
  try {
    const parsed = JSON.parse(err.message) as FirestoreErrorInfo;
    if (parsed.error?.includes('Missing or insufficient permissions') || parsed.error?.includes('permission-denied')) {
      return `صلاحياتك غير كافية لتنفيذ هذه العملية (${parsed.operationType} على ${parsed.path || 'البيانات'}).`;
    }
    if (parsed.error?.includes('Quota exceeded')) {
      return 'تم تجاوز الحد اليومي المجاني لقاعدة البيانات. يرجى المحاولة غداً أو ترقية الخطة.';
    }
    return parsed.error || err.message;
  } catch {
    return err.message;
  }
}
