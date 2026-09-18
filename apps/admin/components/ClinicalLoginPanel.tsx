"use client";

import { useState, type FormEvent } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n";
import styles from "./ClinicalWorkspace.module.css";

const copy = {
  en: { eyebrow: "SECURE CLINICAL ACCESS", title: "CarePoint Clinical", text: "Sign in with an active Doctor or Other Provider account.", email: "Email", password: "Password", signIn: "Sign in", code: "Six-digit verification code", verify: "Verify", mfa: "Multi-factor verification required", enroll: "Authenticator enrollment is required. Add this secret to your authenticator, then enter the six-digit code.", denied: "Clinical provider access is required." },
  ar: { eyebrow: "وصول سريري آمن", title: "CarePoint Clinical", text: "سجّل الدخول بحساب طبيب أو مقدم رعاية آخر نشط.", email: "البريد الإلكتروني", password: "كلمة المرور", signIn: "تسجيل الدخول", code: "رمز التحقق من ستة أرقام", verify: "تحقق", mfa: "التحقق متعدد العوامل مطلوب", enroll: "يلزم إعداد تطبيق المصادقة. أضف هذا السر إلى تطبيق المصادقة ثم أدخل الرمز المكوّن من ستة أرقام.", denied: "يلزم حساب مقدم رعاية سريرية." },
  fr: { eyebrow: "ACCÈS CLINIQUE SÉCURISÉ", title: "CarePoint Clinical", text: "Connectez-vous avec un compte Médecin ou Autre Prestataire actif.", email: "E-mail", password: "Mot de passe", signIn: "Se connecter", code: "Code de vérification à six chiffres", verify: "Vérifier", mfa: "Vérification multifacteur requise", enroll: "L’inscription de l’authentificateur est requise. Ajoutez ce secret puis saisissez le code à six chiffres.", denied: "Un accès de prestataire clinique est requis." },
  es: { eyebrow: "ACCESO CLÍNICO SEGURO", title: "CarePoint Clinical", text: "Inicia sesión con una cuenta activa de Doctor u Otro Proveedor.", email: "Correo electrónico", password: "Contraseña", signIn: "Iniciar sesión", code: "Código de verificación de seis dígitos", verify: "Verificar", mfa: "Se requiere verificación multifactor", enroll: "Se requiere configurar el autenticador. Añade este secreto al autenticador e introduce el código de seis dígitos.", denied: "Se requiere acceso de proveedor clínico." },
} as const;

export function ClinicalLoginPanel() {
  const { locale, direction } = useI18n();
  const t = copy[locale];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [enrollmentSecret, setEnrollmentSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/clinical/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : t.denied);
      if (payload.requiresMfa === true && typeof payload.challengeId === "string") {
        setChallengeId(payload.challengeId);
        setEnrollmentSecret(typeof payload.enrollmentSecret === "string" ? payload.enrollmentSecret : null);
        return;
      }
      window.location.replace("/clinical");
    } catch (value) {
      setError(value instanceof Error ? value.message : t.denied);
    } finally { setBusy(false); }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/clinical/auth/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : t.denied);
      window.location.replace("/clinical");
    } catch (value) {
      setError(value instanceof Error ? value.message : t.denied);
    } finally { setBusy(false); }
  }

  return <main className={styles.loginShell} dir={direction}>
    <section className={styles.loginCard} aria-labelledby="clinical-login-title">
      <div className={styles.loginTop}><div><p className={styles.eyebrow}>{t.eyebrow}</p><h1 id="clinical-login-title">{t.title}</h1></div><LanguageSwitcher /></div>
      <p className={styles.loginLead}>{t.text}</p>
      {challengeId ? <form onSubmit={submitMfa} className={styles.formStack}>
        <div className={styles.securityNotice}><strong>{t.mfa}</strong>{enrollmentSecret ? <><span>{t.enroll}</span><code>{enrollmentSecret}</code></> : null}</div>
        <label>{t.code}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g, ""))} required /></label>
        <button className={styles.primaryButton} disabled={busy || code.length !== 6}>{busy ? "…" : t.verify}</button>
      </form> : <form onSubmit={submitLogin} className={styles.formStack}>
        <label>{t.email}<input type="email" autoComplete="username" value={email} onChange={(event)=>setEmail(event.target.value)} required /></label>
        <label>{t.password}<input type="password" autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} required /></label>
        <button className={styles.primaryButton} disabled={busy}>{busy ? "…" : t.signIn}</button>
      </form>}
      {error ? <p className={styles.errorBox} role="alert">{error}</p> : null}
    </section>
  </main>;
}
