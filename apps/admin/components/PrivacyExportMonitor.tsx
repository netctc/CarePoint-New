"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import styles from "./PrivacyOperations.module.css";

type ExportItem = {
  id: string;
  requesterAccountId: string;
  patientReference: string;
  format: string;
  scope: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  cleanedAt?: string | null;
  byteLength?: number | null;
  mediaType?: string | null;
  errorCode?: string | null;
};

type ExportResponse = {
  items?: ExportItem[];
  privacyBoundary?: {
    clinicalPayloadReturned?: boolean;
    downloadCapabilityReturned?: boolean;
    rawPatientIdReturned?: boolean;
  };
  message?: string;
};

const copy = {
  en: { exports:"Patient exports", retention:"Retention & legal hold", intro:"Operational export jobs only. Clinical payloads and download capability are intentionally unavailable to Admin.", status:"Status", all:"All", refresh:"Refresh", job:"Job", patient:"Patient reference", requester:"Requester", format:"Format", created:"Created", expiry:"Expires", empty:"No export jobs match this filter.", boundary:"Privacy boundary active: no clinical payload, raw patient identifier, or download token is returned.", loadError:"Could not load patient export jobs." },
  ar: { exports:"تصدير بيانات المريض", retention:"الاحتفاظ والتعليق القانوني", intro:"تعرض هذه الصفحة حالة مهام التصدير التشغيلية فقط. لا تتوفر المحتويات السريرية أو صلاحية التنزيل للإدارة.", status:"الحالة", all:"الكل", refresh:"تحديث", job:"المهمة", patient:"مرجع المريض", requester:"مقدم الطلب", format:"التنسيق", created:"تاريخ الإنشاء", expiry:"تنتهي", empty:"لا توجد مهام تصدير مطابقة.", boundary:"حد الخصوصية مفعل: لا يتم إرجاع محتوى سريري أو معرف مريض خام أو رمز تنزيل.", loadError:"تعذر تحميل مهام تصدير المرضى." },
  fr: { exports:"Exports patient", retention:"Rétention et legal hold", intro:"Uniquement les jobs opérationnels. Le contenu clinique et le téléchargement restent indisponibles pour l’Admin.", status:"Statut", all:"Tous", refresh:"Actualiser", job:"Job", patient:"Référence patient", requester:"Demandeur", format:"Format", created:"Créé", expiry:"Expire", empty:"Aucun job d’export ne correspond au filtre.", boundary:"Barrière de confidentialité active : aucun contenu clinique, identifiant patient brut ou jeton de téléchargement.", loadError:"Impossible de charger les exports patient." },
  es: { exports:"Exportaciones del paciente", retention:"Retención y legal hold", intro:"Solo se muestran jobs operativos. El contenido clínico y la capacidad de descarga permanecen deliberadamente fuera del acceso Admin.", status:"Estado", all:"Todos", refresh:"Actualizar", job:"Job", patient:"Referencia del paciente", requester:"Solicitante", format:"Formato", created:"Creado", expiry:"Caduca", empty:"No hay jobs de exportación para este filtro.", boundary:"Límite de privacidad activo: no se devuelve contenido clínico, identificador bruto de paciente ni token de descarga.", loadError:"No se pudieron cargar las exportaciones del paciente." },
} as const;

export function PrivacyExportMonitor() {
  const { locale } = useI18n();
  const t = copy[locale];
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<ExportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boundary, setBoundary] = useState<ExportResponse["privacyBoundary"]>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    try {
      const response = await fetch(`/api/admin/privacy/exports${query}`, { cache: "no-store", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as ExportResponse;
      if (!response.ok) throw new Error(body.message || t.loadError);
      setItems(Array.isArray(body.items) ? body.items : []);
      setBoundary(body.privacyBoundary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, [status, t.loadError]);

  useEffect(() => { void load(); }, [load]);

  return <div className={styles.stack}>
    <div className={styles.tabs}>
      <Link className={`${styles.tab} ${styles.tabActive}`} href="/privacy/exports">{t.exports}</Link>
      <Link className={styles.tab} href="/privacy/retention">{t.retention}</Link>
    </div>
    <p className={styles.muted}>{t.intro}</p>
    {boundary && boundary.clinicalPayloadReturned === false && boundary.downloadCapabilityReturned === false && boundary.rawPatientIdReturned === false ? <div className={styles.notice}>{t.boundary}</div> : null}
    <div className={styles.toolbar}>
      <label className={styles.field}><span>{t.status}</span><select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t.all}</option><option>PENDING</option><option>PROCESSING</option><option>READY</option><option>FAILED</option><option>EXPIRED</option></select></label>
      <button className={styles.buttonSecondary} type="button" onClick={() => void load()} disabled={loading}>{t.refresh}</button>
    </div>
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t.job}</th><th>{t.patient}</th><th>{t.requester}</th><th>{t.format}</th><th>{t.status}</th><th>{t.created}</th><th>{t.expiry}</th></tr></thead><tbody>
      {!loading && items.length === 0 ? <tr><td className={styles.empty} colSpan={7}>{t.empty}</td></tr> : items.map((item) => <tr key={item.id}><td><code>{item.id.slice(0, 14)}</code></td><td>{item.patientReference}</td><td><code>{item.requesterAccountId.slice(0, 14)}</code></td><td>{item.format}</td><td><span className={styles.status}>{item.status}</span>{item.errorCode ? <div className={styles.muted}>{item.errorCode}</div> : null}</td><td>{new Date(item.createdAt).toLocaleString(locale)}</td><td>{new Date(item.expiresAt).toLocaleString(locale)}</td></tr>)}
    </tbody></table></div>
  </div>;
}
