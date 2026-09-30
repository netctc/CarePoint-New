"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AdminPagination, paginateItems } from "@/components/AdminPagination";
import { useI18n, type Locale } from "@/lib/i18n";
import { useRuntimeFeatures } from "@/lib/use-runtime-features";
import { isTransportProviderFamily } from "@/lib/transport-provider-scope";

type Labels = { en: string; ar: string; fr: string; es: string };
type Specialty = {
  id: string; code: string; labels: Labels; parentId?: string | null; active: boolean;
  _count?: { doctors?: number; onboardings?: number; children?: number };
};
type ProviderCategory = {
  id: string; slug: string; labels: Labels; family: string; active: boolean;
  requiredCredentialTypes?: string[];
  _count?: { providers?: number; onboardings?: number; forms?: number };
};
const FAMILIES = ["ALLIED_HEALTH", "DIAGNOSTIC", "NURSING", "PHARMACY", "LABORATORY", "THERAPY", "NON_DOCTOR_HEALTHCARE", "MEDICAL_TRANSPORT_GROUND", "MEDICAL_TRANSPORT_AIR", "EMERGENCY_AMBULANCE"] as const;
const EMPTY_LABELS: Labels = { en: "", ar: "", fr: "", es: "" };

const text = {
  en: { title:"Master Data Maintenance", eyebrow:"ADMIN · GOVERNED MASTER DATA", intro:"Govern current catalogs with audited create, edit, activate and deactivate operations.", specialties:"Medical specialties", providers:"Provider types", add:"Add", edit:"Edit", save:"Save", cancel:"Cancel", deactivate:"Deactivate", reactivate:"Reactivate", code:"Code", slug:"Slug", family:"Family", required:"Required credentials", labels:"Labels", parent:"Parent specialty", active:"Active", usage:"Usage", loading:"Loading master data…", noRows:"No records.", confirmDeactivate:"Deactivate this catalog item? Existing historical references will remain.", saved:"Saved.", taxonomy:"Capability & form taxonomy", related:"Other governed catalogs", medication:"Medication catalog", education:"Patient education", questionnaires:"Questionnaire builder", devices:"Medical devices", profileSchema:"Clinical profile schema", metrics:"Clinical metrics & units", alerts:"Clinical alert policies" },
  es: { title:"Mantenimiento de Datos Maestros", eyebrow:"ADMIN · DATOS MAESTROS GOBERNADOS", intro:"Gobernar los catálogos actuales con alta, edición, activación y desactivación auditadas.", specialties:"Especialidades médicas", providers:"Tipos de proveedor", add:"Añadir", edit:"Editar", save:"Guardar", cancel:"Cancelar", deactivate:"Desactivar", reactivate:"Reactivar", code:"Código", slug:"Slug", family:"Familia", required:"Credenciales obligatorias", labels:"Etiquetas", parent:"Especialidad padre", active:"Activo", usage:"Uso", loading:"Cargando datos maestros…", noRows:"Sin registros.", confirmDeactivate:"¿Desactivar este elemento? Las referencias históricas existentes se conservarán.", saved:"Guardado.", taxonomy:"Taxonomía de capacidades y formularios", related:"Otros catálogos gobernados", medication:"Catálogo de medicamentos", education:"Educación del paciente", questionnaires:"Constructor de cuestionarios", devices:"Dispositivos médicos", profileSchema:"Esquema del perfil clínico", metrics:"Métricas y unidades clínicas", alerts:"Políticas de alertas clínicas" },
  fr: { title:"Maintenance des données de référence", eyebrow:"ADMIN · DONNÉES DE RÉFÉRENCE GOUVERNÉES", intro:"Gérer les catalogues avec création, modification, activation et désactivation auditées.", specialties:"Spécialités médicales", providers:"Types de prestataire", add:"Ajouter", edit:"Modifier", save:"Enregistrer", cancel:"Annuler", deactivate:"Désactiver", reactivate:"Réactiver", code:"Code", slug:"Slug", family:"Famille", required:"Justificatifs requis", labels:"Libellés", parent:"Spécialité parente", active:"Actif", usage:"Utilisation", loading:"Chargement…", noRows:"Aucun enregistrement.", confirmDeactivate:"Désactiver cet élément ? Les références historiques seront conservées.", saved:"Enregistré.", taxonomy:"Taxonomie capacités et formulaires", related:"Autres catalogues gouvernés", medication:"Catalogue des médicaments", education:"Éducation du patient", questionnaires:"Créateur de questionnaires", devices:"Dispositifs médicaux", profileSchema:"Schéma du profil clinique", metrics:"Métriques et unités cliniques", alerts:"Politiques d’alertes cliniques" },
  ar: { title:"صيانة البيانات الرئيسية", eyebrow:"الإدارة · بيانات رئيسية محكومة", intro:"إدارة الكتالوجات الحالية بعمليات إنشاء وتعديل وتفعيل وتعطيل مدققة.", specialties:"التخصصات الطبية", providers:"أنواع مقدمي الخدمة", add:"إضافة", edit:"تعديل", save:"حفظ", cancel:"إلغاء", deactivate:"تعطيل", reactivate:"إعادة التفعيل", code:"الرمز", slug:"المعرّف", family:"الفئة", required:"الاعتمادات المطلوبة", labels:"التسميات", parent:"التخصص الأب", active:"نشط", usage:"الاستخدام", loading:"جارٍ التحميل…", noRows:"لا توجد سجلات.", confirmDeactivate:"تعطيل هذا العنصر؟ ستبقى المراجع التاريخية محفوظة.", saved:"تم الحفظ.", taxonomy:"تصنيف القدرات والنماذج", related:"كتالوجات محكومة أخرى", medication:"كتالوج الأدوية", education:"تثقيف المريض", questionnaires:"منشئ الاستبيانات", devices:"الأجهزة الطبية", profileSchema:"مخطط الملف السريري", metrics:"المقاييس والوحدات السريرية", alerts:"سياسات التنبيهات السريرية" },
} satisfies Record<Locale, Record<string, string>>;

export default function MasterDataPage() {
  const { locale } = useI18n();
  const t = text[locale];
  const { transportModuleEnabled } = useRuntimeFeatures();
  const [tab, setTab] = useState<"specialties"|"providers">("specialties");
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [categories, setCategories] = useState<ProviderCategory[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [specialtyEdit, setSpecialtyEdit] = useState<Partial<Specialty> & { labels: Labels }>({ labels: { ...EMPTY_LABELS }, active: true });
  const [categoryEdit, setCategoryEdit] = useState<Partial<ProviderCategory> & { labels: Labels; required: string }>({ labels: { ...EMPTY_LABELS }, active: true, family: FAMILIES[0], required: "" });

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { cache:"no-store", ...init, headers:{ "content-type":"application/json", ...(init?.headers ?? {}) } });
    if (response.status === 401) { window.location.assign("/login?next=/master-data"); throw new Error("Authentication required."); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : "Request failed.");
    return body;
  }

  async function load() {
    setBusy(true); setMessage("");
    try {
      const [s, c] = await Promise.all([
        request("/api/admin/master-data/specialties"),
        request("/api/admin/master-data/provider-categories"),
      ]);
      setSpecialties(Array.isArray(s) ? s : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);

  const specialtyParents = useMemo(() => specialties.filter((item) => item.id !== specialtyEdit.id), [specialties, specialtyEdit.id]);
  const visibleCategories = useMemo(() => transportModuleEnabled ? categories : categories.filter((item) => !isTransportProviderFamily(item.family)), [categories, transportModuleEnabled]);
  const visibleFamilies = useMemo(() => transportModuleEnabled ? [...FAMILIES] : FAMILIES.filter((item) => !isTransportProviderFamily(item)), [transportModuleEnabled]);

  async function saveSpecialty() {
    const editing = Boolean(specialtyEdit.id);
    try {
      await request("/api/admin/master-data/specialties" + (editing ? "/" + encodeURIComponent(specialtyEdit.id!) : ""), {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          code: specialtyEdit.code,
          labels: specialtyEdit.labels,
          parentId: specialtyEdit.parentId || null,
          active: specialtyEdit.active ?? true,
        }),
      });
      setSpecialtyEdit({ labels:{...EMPTY_LABELS}, active:true });
      setMessage(t.saved); await load();
    } catch (error) { setMessage(String(error)); }
  }

  async function saveCategory() {
    const editing = Boolean(categoryEdit.id);
    try {
      await request("/api/admin/master-data/provider-categories" + (editing ? "/" + encodeURIComponent(categoryEdit.id!) : ""), {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          slug: categoryEdit.slug,
          labels: categoryEdit.labels,
          family: categoryEdit.family,
          active: categoryEdit.active ?? true,
          requiredCredentialTypes: categoryEdit.required.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
        }),
      });
      setCategoryEdit({ labels:{...EMPTY_LABELS}, active:true, family:FAMILIES[0], required:"" });
      setMessage(t.saved); await load();
    } catch (error) { setMessage(String(error)); }
  }

  async function toggleActive(kind: "specialties"|"provider-categories", id: string, active: boolean) {
    if (active && !window.confirm(t.confirmDeactivate)) return;
    try {
      if (active) {
        await request("/api/admin/master-data/" + kind + "/" + encodeURIComponent(id), { method:"DELETE" });
      } else {
        await request("/api/admin/master-data/" + kind + "/" + encodeURIComponent(id), { method:"PATCH", body:JSON.stringify({ active:true }) });
      }
      await load();
    } catch (error) { setMessage(String(error)); }
  }

  const card = { background:"#fff", border:"1px solid #dbe4ee", borderRadius:16, padding:18 } as const;
  const grid = { display:"grid", gap:12 } as const;
  return <AppShell active="26" eyebrow={t.eyebrow} title={t.title}>
    <section className="notice-card">
      <div><span>{t.intro}</span><p>{message}</p></div>
      <a className="secondary-button" href="/providers/taxonomy">{t.taxonomy}</a>
    </section>
    <section style={{background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:18,marginTop:18}}>
      <h2 style={{marginTop:0}}>{t.related}</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
        {([
          ["/providers/taxonomy", t.taxonomy],
          ["/medication-catalog", t.medication],
          ["/patient-education", t.education],
          ["/questionnaires", t.questionnaires],
          ["/devices", t.devices],
          ["/clinical-config/profile-schema", t.profileSchema],
          ["/clinical-config/observations", t.metrics],
          ["/clinical-config/alert-policies", t.alerts],
        ] as const).map(([href,label])=><Link key={href} className="secondary-button" href={href}>{label}</Link>)}
      </div>
    </section>
    <div style={{display:"flex",gap:8,margin:"18px 0"}}>
      <button className={tab==="specialties"?"primary-button":"secondary-button"} onClick={()=>setTab("specialties")}>{t.specialties}</button>
      <button className={tab==="providers"?"primary-button":"secondary-button"} onClick={()=>setTab("providers")}>{t.providers}</button>
    </div>
    {busy ? <p>{t.loading}</p> : tab === "specialties" ? <>
      <section style={{...card,marginBottom:18}}>
        <h2>{specialtyEdit.id ? t.edit : t.add} · {t.specialties}</h2>
        <div style={{...grid,gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))"}}>
          <label>{t.code}<input value={specialtyEdit.code ?? ""} onChange={e=>setSpecialtyEdit({...specialtyEdit,code:e.target.value})}/></label>
          <label>{t.parent}<select value={specialtyEdit.parentId ?? ""} onChange={e=>setSpecialtyEdit({...specialtyEdit,parentId:e.target.value||null})}><option value="">—</option>{specialtyParents.map(item=><option key={item.id} value={item.id}>{label(item.labels,locale)} · {item.code}</option>)}</select></label>
          {(["en","ar","fr","es"] as const).map(lang=><label key={lang}>{t.labels} {lang.toUpperCase()}<input value={specialtyEdit.labels[lang] ?? ""} onChange={e=>setSpecialtyEdit({...specialtyEdit,labels:{...specialtyEdit.labels,[lang]:e.target.value}})}/></label>)}
        </div>
        <div style={{display:"flex",gap:8,marginTop:14}}>
          <button className="primary-button" onClick={()=>void saveSpecialty()}>{t.save}</button>
          {specialtyEdit.id && <button className="secondary-button" onClick={()=>setSpecialtyEdit({labels:{...EMPTY_LABELS},active:true})}>{t.cancel}</button>}
        </div>
      </section>
      <CatalogTable rows={specialties} locale={locale} kind="specialties" onEdit={(item:any)=>setSpecialtyEdit({...item,labels:normalizeLabels(item.labels)})} onToggle={toggleActive} t={t}/>
    </> : <>
      <section style={{...card,marginBottom:18}}>
        <h2>{categoryEdit.id ? t.edit : t.add} · {t.providers}</h2>
        <div style={{...grid,gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))"}}>
          <label>{t.slug}<input value={categoryEdit.slug ?? ""} onChange={e=>setCategoryEdit({...categoryEdit,slug:e.target.value.toLowerCase()})}/></label>
          <label>{t.family}<input list="provider-family-options" value={categoryEdit.family ?? FAMILIES[0]} onChange={e=>setCategoryEdit({...categoryEdit,family:e.target.value.toUpperCase()})}/><datalist id="provider-family-options">{visibleFamilies.map(item=><option key={item} value={item}/>)}</datalist></label>
          <label>{t.required}<input value={categoryEdit.required} onChange={e=>setCategoryEdit({...categoryEdit,required:e.target.value})} placeholder="license, certification"/></label>
          {(["en","ar","fr","es"] as const).map(lang=><label key={lang}>{t.labels} {lang.toUpperCase()}<input value={categoryEdit.labels[lang] ?? ""} onChange={e=>setCategoryEdit({...categoryEdit,labels:{...categoryEdit.labels,[lang]:e.target.value}})}/></label>)}
        </div>
        <div style={{display:"flex",gap:8,marginTop:14}}>
          <button className="primary-button" onClick={()=>void saveCategory()}>{t.save}</button>
          {categoryEdit.id && <button className="secondary-button" onClick={()=>setCategoryEdit({labels:{...EMPTY_LABELS},active:true,family:FAMILIES[0],required:""})}>{t.cancel}</button>}
        </div>
      </section>
      <CatalogTable rows={visibleCategories} locale={locale} kind="provider-categories" onEdit={(item:any)=>setCategoryEdit({...item,labels:normalizeLabels(item.labels),required:Array.isArray(item.requiredCredentialTypes)?item.requiredCredentialTypes.join(", "):""})} onToggle={toggleActive} t={t}/>
    </>}
  </AppShell>;
}

function CatalogTable({ rows, locale, kind, onEdit, onToggle, t }: any) {
  const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState(10);
  return <section style={{background:"#fff",border:"1px solid #dbe4ee",borderRadius:16,padding:18,overflowX:"auto"}}>
    {rows.length===0 ? <p>{t.noRows}</p> : <table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead><tr><th align="left">{kind==="specialties"?t.code:t.slug}</th><th align="left">{t.labels}</th><th align="left">{t.active}</th><th align="left">{t.usage}</th><th/></tr></thead>
      <tbody>{paginateItems(rows,page,pageSize).map((item:any)=><tr key={item.id} style={{borderTop:"1px solid #e2e8f0"}}>
        <td style={{padding:"12px 8px"}}><strong>{item.code ?? item.slug}</strong>{item.family&&<><br/><small>{item.family}</small></>}</td>
        <td style={{padding:"12px 8px"}}>{label(item.labels,locale)}</td>
        <td style={{padding:"12px 8px"}}><span style={{fontWeight:700}}>{item.active?"✓":"—"}</span></td>
        <td style={{padding:"12px 8px"}}><small>{Object.entries(item._count??{}).map(([key,value])=>key+":"+String(value)).join(" · ")||"—"}</small></td>
        <td style={{padding:"12px 8px",whiteSpace:"nowrap"}}><button className="secondary-button" onClick={()=>onEdit(item)}>{t.edit}</button>{" "}<button className="secondary-button" onClick={()=>void onToggle(kind,item.id,item.active)}>{item.active?t.deactivate:t.reactivate}</button></td>
      </tr>)}</tbody>
    </table>}
    <AdminPagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={(size)=>{setPageSize(size);setPage(1);}}/>
  </section>;
}
function normalizeLabels(raw:any): Labels {
  return { en:String(raw?.en??""), ar:String(raw?.ar??""), fr:String(raw?.fr??""), es:String(raw?.es??"") };
}
function label(raw:any, locale:Locale): string {
  return String(raw?.[locale] || raw?.en || raw?.ar || raw?.fr || raw?.es || "—");
}
