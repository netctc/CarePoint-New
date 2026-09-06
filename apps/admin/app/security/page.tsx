"use client";

import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

const copy: Record<Locale, Record<string, string>> = {
  en: {
    access: "IDENTITY & ACCESS", posture: "Identity security posture", postureText: "Revocable sessions, TOTP MFA and account-state controls are the baseline for privileged access.",
    active: "Active accounts", mfa: "MFA coverage", sessions: "Open sessions", locked: "Temporarily locked",
    onboarding: "PROVIDER ONBOARDING", queue: "Credential review queue", doctor: "Doctor", provider: "Other Provider", pending: "Pending review", changes: "Changes requested", ready: "Ready to approve",
    boundary: "Doctors always remain in the Doctor domain. Other Providers never contain doctors.",
    consent: "CONSENT & AUDIT", consentTitle: "Patient-controlled clinical access", consentText: "Grant and revoke events are appended to the audit trail with actor, object, scope and result.",
    actor: "Actor", result: "Result"
  },
  ar: {
    access: "الهوية والوصول", posture: "وضع أمان الهوية", postureText: "الجلسات القابلة للإلغاء وMFA عبر TOTP وضوابط حالة الحساب هي أساس الوصول المميز.",
    active: "الحسابات النشطة", mfa: "تغطية MFA", sessions: "الجلسات المفتوحة", locked: "مقفلة مؤقتاً",
    onboarding: "تأهيل مقدمي الخدمة", queue: "قائمة مراجعة الاعتمادات", doctor: "طبيب", provider: "مقدم رعاية آخر", pending: "قيد المراجعة", changes: "مطلوب تعديلات", ready: "جاهز للموافقة",
    boundary: "يبقى جميع الأطباء دائماً ضمن نطاق الأطباء. نطاق مقدمي الرعاية الآخرين لا يتضمن أطباء.",
    consent: "الموافقة والتدقيق", consentTitle: "وصول سريري تحت تحكم المريض", consentText: "تسجل عمليات منح وإلغاء الموافقة في سجل التدقيق مع الفاعل والعنصر والنطاق والنتيجة.",
    actor: "الفاعل", result: "النتيجة"
  },
  fr: {
    access: "IDENTITÉ & ACCÈS", posture: "Posture de sécurité d’identité", postureText: "Sessions révocables, MFA TOTP et contrôle d’état des comptes constituent la base des accès privilégiés.",
    active: "Comptes actifs", mfa: "Couverture MFA", sessions: "Sessions ouvertes", locked: "Bloqués temporairement",
    onboarding: "ONBOARDING PRESTATAIRES", queue: "File de revue des habilitations", doctor: "Médecin", provider: "Autre prestataire", pending: "En révision", changes: "Modifications demandées", ready: "Prêt à approuver",
    boundary: "Tous les médecins restent dans le domaine Médecins. Les Autres Prestataires n’incluent jamais de médecins.",
    consent: "CONSENTEMENT & AUDIT", consentTitle: "Accès clinique contrôlé par le patient", consentText: "Les octrois et révocations sont ajoutés à l’audit avec acteur, objet, portée et résultat.",
    actor: "Acteur", result: "Résultat"
  },
  es: {
    access: "IDENTIDAD Y ACCESO", posture: "Postura de seguridad de identidad", postureText: "Sesiones revocables, MFA TOTP y controles de estado de cuenta forman la base del acceso privilegiado.",
    active: "Cuentas activas", mfa: "Cobertura MFA", sessions: "Sesiones abiertas", locked: "Bloqueadas temporalmente",
    onboarding: "ONBOARDING DE PROVEEDORES", queue: "Cola de revisión de credenciales", doctor: "Médico", provider: "Otro proveedor", pending: "En revisión", changes: "Cambios solicitados", ready: "Listo para aprobar",
    boundary: "Todos los médicos permanecen siempre en el dominio Médicos. Otros Proveedores nunca incluye médicos.",
    consent: "CONSENTIMIENTO Y AUDITORÍA", consentTitle: "Acceso clínico controlado por el paciente", consentText: "Los eventos de otorgar y revocar consentimiento se añaden al registro de auditoría con actor, objeto, alcance y resultado.",
    actor: "Actor", result: "Resultado"
  }
};

const onboardingRows = [
  ["Dr. Lina Haddad", "DOCTOR", "Cardiology", "READY"],
  ["Dr. Omar Nasser", "DOCTOR", "Neurology", "PENDING"],
  ["Noura Khoury", "OTHER_PROVIDER", "Nursing / ATS", "CHANGES"],
  ["RapidCare EMS", "OTHER_PROVIDER", "Emergency Ambulance", "READY"],
] as const;

export default function SecurityPage() {
  const { locale } = useI18n();
  const c = copy[locale];
  return (
    <AppShell active="08" titleKey="nav.security" eyebrowKey="doctors.credentialGovernance">
      <section className="doctor-hero">
        <div><span>{c.access}</span><h2>{c.posture}</h2><p>{c.postureText}</p></div>
        <div className="doctor-metric"><strong>96%</strong><span>{c.mfa}</span><small>TOTP · privileged roles</small></div>
      </section>
      <section className="kpi-grid" style={{marginTop:16}}>
        {[[c.active,"1,284","+18"],[c.mfa,"96%","+3%"],[c.sessions,"742","rotating"],[c.locked,"3","15 min"]].map(([label,value,detail]) =>
          <article className="kpi-card" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}
      </section>
      <section className="panel" style={{marginTop:18}}>
        <div className="panel-heading"><div><span>{c.onboarding}</span><h3>{c.queue}</h3></div><button>{c.pending}</button></div>
        <p style={{color:"#64748b",marginTop:0}}>{c.boundary}</p>
        <div className="timeline">
          {onboardingRows.map(([name,kind,detail,state]) => <div className="timeline-row" key={name}>
            <b>{kind === "DOCTOR" ? c.doctor : c.provider}</b><i/>
            <div><strong>{name}</strong><span>{detail}</span></div>
            <em>{state === "READY" ? c.ready : state === "CHANGES" ? c.changes : c.pending}</em>
          </div>)}
        </div>
      </section>
      <section className="panel" style={{marginTop:18}}>
        <div className="panel-heading"><div><span>{c.consent}</span><h3>{c.consentTitle}</h3></div></div>
        <p style={{color:"#64748b"}}>{c.consentText}</p>
        <div className="timeline">
          {[["CONSENT_GRANTED","patient-1042","SUCCESS"],["MFA_ENABLED","doctor-208","SUCCESS"],["SESSION_REVOKED","admin-03","SUCCESS"]].map(([action,actor,result]) =>
            <div className="timeline-row" key={`${action}-${actor}`}><b>{result}</b><i/><div><strong>{action}</strong><span>{c.actor}: {actor}</span></div><em>{c.result}: {result}</em></div>)}
        </div>
      </section>
    </AppShell>
  );
}
