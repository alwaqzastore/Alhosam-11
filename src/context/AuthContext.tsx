import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { ensureStandardAccountsAndWarehouse } from '../services/accountingService';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  FULL_ADMIN_PERMISSIONS,
  StaffInvite,
  UserAccount,
} from '../types/accounting';

interface AuthContextValue {
  firebaseUser: User | null;
  userAccount: UserAccount | null;
  loading: boolean;
  authError: string | null;
  accessDeniedReason: 'not_invited' | 'suspended' | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accessDeniedReason, setAccessDeniedReason] = useState<'not_invited' | 'suspended' | null>(
    null
  );

  const resolveUserAccount = async (user: User) => {
    setAuthError(null);
    setAccessDeniedReason(null);

    const userRef = doc(db, 'users', user.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
    }

    if (userSnap.exists()) {
      const data = userSnap.data() as UserAccount;
      if (data.status === 'suspended') {
        setUserAccount(data);
        setAccessDeniedReason('suspended');
        return;
      }
      // Update lastLoginAt quietly
      try {
        await updateDoc(userRef, {
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore offline/transient update errors on login stamp
      }
      setUserAccount(data);
      void ensureStandardAccountsAndWarehouse({
        uid: data.uid,
        displayName: data.displayName,
        role: data.role,
      });
      return;
    }

    const emailLower = (user.email || '').trim().toLowerCase();

    // 1. Bootstrapped Primary Admin
    if (emailLower === BOOTSTRAPPED_ADMIN_EMAIL) {
      const adminPayload = {
        uid: user.uid,
        email: emailLower,
        displayName: (user.displayName || 'المسؤول الرئيسي').slice(0, 100),
        role: 'admin',
        status: 'active',
        permissions: FULL_ADMIN_PERMISSIONS,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      };
      try {
        await setDoc(userRef, adminPayload);
        // Ensure shop & treasury docs exist on initial bootstrap
        const shopRef = doc(db, 'settings', 'shop');
        const shopSnap = await getDoc(shopRef);
        if (!shopSnap.exists()) {
          await setDoc(shopRef, {
            shopName: 'بقالة الحسام',
            currency: 'ر.ي',
            lowStockDefault: 5,
            invoiceFooter: 'شكراً لتعاملكم مع بقالة الحسام',
            updatedAt: serverTimestamp(),
          });
        }
        const treasuryRef = doc(db, 'settings', 'treasury');
        const treasurySnap = await getDoc(treasuryRef);
        if (!treasurySnap.exists()) {
          await setDoc(treasuryRef, {
            cashBalance: 0,
            totalCashIn: 0,
            totalCashOut: 0,
            updatedAt: serverTimestamp(),
          });
        }
        const createdSnap = await getDoc(userRef);
        const createdUser = createdSnap.data() as UserAccount;
        setUserAccount(createdUser);
        void ensureStandardAccountsAndWarehouse({
          uid: createdUser.uid,
          displayName: createdUser.displayName,
          role: createdUser.role,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}`);
      }
      return;
    }

    // 2. Check Staff Invites for this verified email
    try {
      const invitesQ = query(
        collection(db, 'staffInvites'),
        where('email', '==', emailLower)
      );
      const inviteSnaps = await getDocs(invitesQ);
      if (inviteSnaps.empty) {
        setUserAccount(null);
        setAccessDeniedReason('not_invited');
        return;
      }

      const invite = inviteSnaps.docs[0].data() as StaffInvite;
      if (invite.status === 'suspended') {
        setUserAccount(null);
        setAccessDeniedReason('suspended');
        return;
      }

      const newStaffPayload: Record<string, unknown> = {
        uid: user.uid,
        email: emailLower,
        displayName: (invite.displayName || user.displayName || 'موظف').slice(0, 100),
        role: invite.role,
        status: invite.status,
        inviteId: invite.id,
        permissions: invite.permissions,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      };
      if (invite.phone) newStaffPayload.phone = invite.phone;

      await setDoc(userRef, newStaffPayload);
      await updateDoc(doc(db, 'staffInvites', invite.id), {
        claimedUid: user.uid,
        updatedAt: serverTimestamp(),
      });

      const createdSnap = await getDoc(userRef);
      const createdStaff = createdSnap.data() as UserAccount;
      setUserAccount(createdStaff);
      void ensureStandardAccountsAndWarehouse({
        uid: createdStaff.uid,
        displayName: createdStaff.displayName,
        role: createdStaff.role,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'staffInvites');
    }
  };

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      setFirebaseUser(user);
      if (!user) {
        setUserAccount(null);
        setAccessDeniedReason(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        await resolveUserAccount(user);
        // Live listener on own user profile so suspensions/permission changes take effect immediately
        unsubProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snap) => {
            if (snap.exists()) {
              const data = snap.data() as UserAccount;
              setUserAccount(data);
              setAccessDeniedReason(data.status === 'suspended' ? 'suspended' : null);
            }
          },
          () => {
            // Silent if uninvited user doesn't have a user doc yet
          }
        );
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'تعذر التحقق من الحساب');
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل تسجيل الدخول عبر Google.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError('حدث خطأ أثناء تسجيل الدخول عبر Google. يرجى المحاولة مجدداً.');
      }
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUserAccount(null);
    setAccessDeniedReason(null);
  };

  const refreshProfile = async () => {
    if (firebaseUser) {
      setLoading(true);
      await resolveUserAccount(firebaseUser);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userAccount,
        loading,
        authError,
        accessDeniedReason,
        signInWithGoogle,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
