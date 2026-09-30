"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n, type Locale } from "@/lib/i18n";

const copy: Record<Locale, {
  eyebrow: string; title: string; intro: string; email: string; password: string; signIn: string; signingIn: string;
  mfaEyebrow: string; mfaTitle: string; mfaText: string; enrollTitle: string; enrollText: string; setupKey: string;
  code: string; verify: string; verifying: string; back: string; invalid: string; adminOnly: string; rateLimited: string; unavailable: string; protected: string;
}> = {
  en: {
    eyebrow: "SECURE OPERATIONS ACCESS", title: "Administrator sign in", intro: "Use your CarePoint administrator identity. Session tokens remain server-side in secure HttpOnly cookies.",
    email: "Email", password: "Password", signIn: "Sign in securely", signingIn: "Signing in…",
    mfaEyebrow: "MULTI-FACTOR VERIFICATION", mfaTitle: "Verify your authenticator", mfaText: "Enter the current six-digit code from your authenticator app.",
    enrollTitle: "Set up multi-factor authentication", enrollText: "MFA is required for administrator access. Add this setup key to your authenticator app, then enter the generated six-digit code.", setupKey: "Authenticator setup key",
    code: "Verification code", verify: "Verify and continue", verifying: "Verifying…", back: "Use a different account",
    invalid: "Authentication failed. Check your credentials or verification code.", adminOnly: "This portal is restricted to active CarePoint administrators.", rateLimited: "Too many attempts. Please try again later.", unavailable: "CarePoint authentication is temporarily unavailable.", protected: "Protected by revocable sessions and enforced MFA for privileged production access.",
  },
  ar: {
    eyebrow: "وصول آمن للعمليات", title: "تسجيل دخول المسؤول", intro: "استخدم هوية مسؤول CarePoint. تبقى رموز الجلسة على الخادم داخل ملفات تعريف ارتباط HttpOnly آمنة.",
    email: "البريد الإلكتروني", password: "كلمة المرور", signIn: "تسجيل دخول آمن", signingIn: "جارٍ تسجيل الدخول…",
    mfaEyebrow: "التحقق متعدد العوامل", mfaTitle: "تحقق من تطبيق المصادقة", mfaText: "أدخل الرمز الحالي المكون من ستة أرقام من تطبيق المصادقة.",
    enrollTitle: "إعداد التحقق متعدد العوامل", enrollText: "التحقق متعدد العوامل مطلوب لوصول المسؤول. أضف مفتاح الإعداد هذا إلى تطبيق المصادقة ثم أدخل الرمز المكون من ستة أرقام.", setupKey: "مفتاح إعداد تطبيق المصادقة",
    code: "رمز التحقق", verify: "تحقق وتابع", verifying: "جارٍ التحقق…", back: "استخدام حساب مختلف",
    invalid: "فشل التحقق. راجع بيانات الدخول أو رمز التحقق.", adminOnly: "هذه البوابة مخصصة لمسؤولي CarePoint النشطين فقط.", rateLimited: "محاولات كثيرة جداً. حاول لاحقاً.", unavailable: "خدمة مصادقة CarePoint غير متاحة مؤقتاً.", protected: "محمي بجلسات قابلة للإلغاء وMFA إلزامي للوصول المميز في الإنتاج.",
  },
  fr: {
    eyebrow: "ACCÈS SÉCURISÉ AUX OPÉRATIONS", title: "Connexion administrateur", intro: "Utilisez votre identité administrateur CarePoint. Les jetons de session restent côté serveur dans des cookies HttpOnly sécurisés.",
    email: "E-mail", password: "Mot de passe", signIn: "Se connecter en sécurité", signingIn: "Connexion…",
    mfaEyebrow: "VÉRIFICATION MULTIFACTEUR", mfaTitle: "Vérifiez votre authentificateur", mfaText: "Saisissez le code actuel à six chiffres de votre application d’authentification.",
    enrollTitle: "Configurer l’authentification multifacteur", enrollText: "La MFA est obligatoire pour l’accès administrateur. Ajoutez cette clé à votre application d’authentification, puis saisissez le code à six chiffres généré.", setupKey: "Clé de configuration de l’authentificateur",
    code: "Code de vérification", verify: "Vérifier et continuer", verifying: "Vérification…", back: "Utiliser un autre compte",
    invalid: "Échec de l’authentification. Vérifiez vos identifiants ou votre code.", adminOnly: "Ce portail est réservé aux administrateurs CarePoint actifs.", rateLimited: "Trop de tentatives. Réessayez plus tard.", unavailable: "L’authentification CarePoint est temporairement indisponible.", protected: "Protégé par des sessions révocables et une MFA obligatoire pour les accès privilégiés en production.",
  },
  es: {
    eyebrow: "ACCESO SEGURO A OPERACIONES", title: "Acceso de administrador", intro: "Utiliza tu identidad de administrador de CarePoint. Los tokens de sesión permanecen en el servidor dentro de cookies HttpOnly seguras.",
    email: "Correo electrónico", password: "Contraseña", signIn: "Acceder de forma segura", signingIn: "Accediendo…",
    mfaEyebrow: "VERIFICACIÓN MULTIFACTOR", mfaTitle: "Verifica tu autenticador", mfaText: "Introduce el código actual de seis dígitos de tu aplicación de autenticación.",
    enrollTitle: "Configurar autenticación multifactor", enrollText: "MFA es obligatorio para el acceso de administrador. Añade esta clave a tu aplicación de autenticación y después introduce el código de seis dígitos generado.", setupKey: "Clave de configuración del autenticador",
    code: "Código de verificación", verify: "Verificar y continuar", verifying: "Verificando…", back: "Usar otra cuenta",
    invalid: "La autenticación falló. Revisa tus credenciales o el código de verificación.", adminOnly: "Este portal está restringido a administradores activos de CarePoint.", rateLimited: "Demasiados intentos. Inténtalo de nuevo más tarde.", unavailable: "La autenticación de CarePoint no está disponible temporalmente.", protected: "Protegido mediante sesiones revocables y MFA obligatorio para accesos privilegiados en producción.",
  },
};

export function AdminLoginPanel({ nextPath }: Readonly<{ nextPath: string }>) {
  const router = useRouter();
  const { locale, direction } = useI18n();
  const c = copy[locale];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [enrollmentSecret, setEnrollmentSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        setError(messageForStatus(response.status, c));
        return;
      }
      if (payload.requiresMfa === true && typeof payload.challengeId === "string") {
        setChallengeId(payload.challengeId);
        setEnrollmentSecret(payload.enrollmentRequired === true && typeof payload.enrollmentSecret === "string" ? payload.enrollmentSecret : null);
        setPassword("");
        setCode("");
        return;
      }
      if (payload.authenticated === true) {
        router.replace(nextPath);
        router.refresh();
        return;
      }
      setError(c.unavailable);
    } catch {
      setError(c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ challengeId, code }),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        setError(messageForStatus(response.status, c));
        return;
      }
      if (payload.authenticated === true) {
        setEnrollmentSecret(null);
        router.replace(nextPath);
        router.refresh();
        return;
      }
      setError(c.unavailable);
    } catch {
      setError(c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  function resetChallenge() {
    setChallengeId(null);
    setEnrollmentSecret(null);
    setCode("");
    setError("");
  }

  return (
    <main className="admin-login" data-direction={direction}>
      <section className="admin-login-brand">
        <div className="admin-login-logo">C+</div>
        <div><strong>CarePoint</strong><span>Clinical Operations</span></div>
        <p>{c.protected}</p>
      </section>
      <section className="admin-login-card">
        <div className="admin-login-language"><LanguageSwitcher /></div>
        {!challengeId ? (
          <form onSubmit={submitCredentials}>
            <span className="admin-login-eyebrow">{c.eyebrow}</span>
            <h1>{c.title}</h1>
            <p>{c.intro}</p>
            <label><span>{c.email}</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} disabled={busy} /></label>
            <label><span>{c.password}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={512} disabled={busy} /></label>
            {error ? <div className="admin-login-error" role="alert">{error}</div> : null}
            <button className="admin-login-primary" type="submit" disabled={busy}>{busy ? c.signingIn : c.signIn}</button>
          </form>
        ) : (
          <form onSubmit={submitMfa}>
            <span className="admin-login-eyebrow">{c.mfaEyebrow}</span>
            <h1>{enrollmentSecret ? c.enrollTitle : c.mfaTitle}</h1>
            <p>{enrollmentSecret ? c.enrollText : c.mfaText}</p>
            {enrollmentSecret ? (
              <label>
                <span>{c.setupKey}</span>
                <input value={enrollmentSecret} readOnly autoComplete="off" aria-label={c.setupKey} />
              </label>
            ) : null}
            <label><span>{c.code}</span><input className="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={busy} autoFocus /></label>
            {error ? <div className="admin-login-error" role="alert">{error}</div> : null}
            <button className="admin-login-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? c.verifying : c.verify}</button>
            <button className="admin-login-link" type="button" disabled={busy} onClick={resetChallenge}>{c.back}</button>
          </form>
        )}
      </section>
    </main>
  );
}

function messageForStatus(status: number, c: typeof copy.en): string {
  if (status === 401 || status === 400 || status === 409) return c.invalid;
  if (status === 403) return c.adminOnly;
  if (status === 429) return c.rateLimited;
  return c.unavailable;
}
