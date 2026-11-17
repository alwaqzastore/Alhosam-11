import { ShieldCheck, LogIn, RefreshCw, LogOut, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const {
    firebaseUser,
    loading,
    authError,
    accessDeniedReason,
    signInWithGoogle,
    signOut,
    refreshProfile,
  } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
          <div className="w-10 h-10 mx-auto border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <h2 className="text-lg font-bold text-slate-900">جاري التحقق من الحساب والصلاحيات...</h2>
          <p className="text-sm text-slate-500">يتم الآن الاتصال بقاعدة البيانات السحابية</p>
        </div>
      </div>
    );
  }

  if (firebaseUser && accessDeniedReason === 'suspended') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
        <div className="bg-white border border-rose-200 rounded-xl p-8 max-w-md w-full space-y-5">
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">الحساب موقوف مؤقتاً</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              تم إيقاف صلاحية الدخول للحساب <span className="font-mono-num text-slate-900">{firebaseUser.email}</span> من قِبل المسؤول الرئيسي.
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full py-2.5 px-4 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    );
  }

  if (firebaseUser && accessDeniedReason === 'not_invited') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-lg w-full space-y-5">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">حسابك بانتظار التفعيل من المسؤول</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              الحساب المسجل حالياً (<span className="font-mono-num font-medium text-slate-900">{firebaseUser.email}</span>) غير مضاف في قائمة موظفي المتجر.
            </p>
            <p className="text-sm text-slate-500">
              يرجى تزويد المسؤول الرئيسي بهذا البريد الإلكتروني لإضافتك في قسم الموظفين، ثم الضغط على تحديث الحالة.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={refreshProfile}
              className="flex-1 py-2.5 px-4 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>تحديث حالة الحساب</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="py-2.5 px-4 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>تبديل الحساب</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-8 lg:p-10 flex flex-col justify-between space-y-8">
          <div className="space-y-4">
            <div className="text-xs font-medium text-emerald-700">
              بقالة الحسام · نظام محاسبي وتجاري متكامل
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 leading-tight">
              بقالة الحسام للمحاسبة ونقاط البيع
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              إدارة متكاملة للمبيعات الفورية، المنتجات وتواريخ الصلاحية، المستودعات والمرتجعات، العملاء والموردين، الصندوق والقيود اليومية بصلاحيات محكمة ومزامنة سحابية لحظية.
            </p>
          </div>

          <div className="space-y-4">
            {authError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {authError}
              </div>
            )}
            <button
              type="button"
              onClick={signInWithGoogle}
              className="w-full py-3.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-3 cursor-pointer"
            >
              <LogIn className="w-5 h-5" />
              <span>تسجيل الدخول بحساب Google</span>
            </button>
            <p className="text-xs text-slate-500 text-center">
              يعمل كتطبيق ويب وهاتف (Android / Desktop) مع حفظ البيانات سحابياً
            </p>
          </div>
        </div>

        <div className="bg-slate-900 text-slate-100 p-8 lg:p-10 flex flex-col justify-between space-y-6">
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-white">مرتكزات نظام بقالة الحسام</h2>
            <p className="text-xs text-slate-400">بيئة عمل مترابطة للمسؤول والبائعين</p>
          </div>

          <div className="space-y-4 text-sm">
            <div className="pb-3 border-b border-slate-800">
              <div className="font-semibold text-white">ترابط محاسبي ومخزوني كامل</div>
              <div className="text-xs text-slate-400 mt-1">
                توليد قيود يومية متوازنة تلقائياً مع كل فاتورة بيع أو شراء أو مرتجع أو سند مالي
              </div>
            </div>
            <div className="pb-3 border-b border-slate-800">
              <div className="font-semibold text-white">مراقبة الصلاحية والمرتجعات التالفة</div>
              <div className="text-xs text-slate-400 mt-1">
                تنبيهات للمواد الغذائية قريبة الانتهاء وعزل البضاعة المرتجعة التالفة عن المخزون القابل للبيع
              </div>
            </div>
            <div>
              <div className="font-semibold text-white">فواتير PDF وإرسال مباشر عبر واتساب</div>
              <div className="text-xs text-slate-400 mt-1">
                دعم العملة اليمنية والعملات الأخرى مع نسخ احتياطي واستعادة آمنة
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400">
            يعمل بسلاسة على الهواتف والأجهزة اللوحية وأجهزة الكاشير والكمبيوتر
          </div>
        </div>
      </div>
    </div>
  );
}
