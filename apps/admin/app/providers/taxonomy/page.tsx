"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useI18n, type Locale } from "@/lib/i18n";

type Labels = { en?: string; ar?: string; fr?: string; es?: string };
type Category = {
  id: string;
  slug: string;
  family: string;
  labels: Labels;
  enabledModalities?: string[];
  clinicalOrderCapabilities?: string[];
  clinicalSummarySections?: string[];
  observationCodes?: string[];
  questionnaireCodes?: string[];
  workflowCapabilities?: string[];
};
type FormVersion = { id: string; version: number; status: string; schema: unknown };
type ProviderForm = {
  id: string;
  categoryId: string;
  code: string;
  purpose: string;
  labels: Labels;
  active: boolean;
  versions: FormVersion[];
};
type QuestionType = "BOOLEAN" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "NUMBER" | "TEXT" | "DATE";
type BuilderQuestion = {
  id: string;
  type: QuestionType;
  required: boolean;
  en: string;
  ar: string;
  fr: string;
  es: string;
  options: string;
  min: string;
  max: string;
  maxLength: string;
};

const MODALITIES = ["CLINIC", "TELEMEDICINE", "HOME_VISIT"] as const;
const ORDER_CAPS = ["PRESCRIPTION", "LABORATORY", "IMAGING", "LAB_RESULT_ENTRY", "LAB_RESULT_VALIDATE", "SPECIMEN_COLLECTION", "PHYSIOTHERAPY", "NUTRITION"] as const;
const SUMMARY = ["HEALTH_PROFILE", "ALLERGIES", "CONDITIONS", "MEDICATIONS"] as const;
const WORKFLOW = ["CATEGORY_FORMS", "HOME_VISIT_ARRIVAL", "SERVICE_COMPLETION_CHECKLIST", "MEDIA_CAPTURE", "MED_ADMIN", "WOUND_CARE", "PROCEDURE_CHECKLIST", "TRANSPORT_EQUIPMENT_CHECKLIST", "TRANSPORT_REJECT", "TRANSPORT_ACCEPT"] as const;
const PURPOSES = ["GENERAL", "HOME_VISIT", "SERVICE_COMPLETION", "PROCEDURE_CHECKLIST", "TRANSPORT_EQUIPMENT"] as const;
const TYPES: QuestionType[] = ["BOOLEAN", "SINGLE_CHOICE", "MULTI_CHOICE", "NUMBER", "TEXT", "DATE"];

const copy: Record<Locale, Record<string, string>> = {
  en: { title: "Provider taxonomy", eyebrow: "P0 · ADM-106 / ADM-107", subtitle: "Versioned category forms and server-enforced capability matrix.", category: "Category", capabilities: "Capabilities", save: "Save capabilities", saving: "Saving…", saved: "Saved.", forms: "Versioned forms", newForm: "New form", code: "Code", purpose: "Purpose", create: "Create form", labels: "Labels", questions: "Questions", addQuestion: "Add question", draft: "Create draft version", activate: "Activate", required: "Required", options: "Choice options", observations: "Observation codes", questionnaires: "Questionnaire codes", offlineHint: "HOME_VISIT enables offline field-sync eligibility; server appointment checks still apply.", signatureHint: "SERVICE_COMPLETION_CHECKLIST governs service receipt/signature together with server evidence checks.", empty: "No forms for this category.", reload: "Reload", error: "Request failed." },
  ar: { title: "تصنيف مقدمي الخدمة", eyebrow: "P0 · ADM-106 / ADM-107", subtitle: "نماذج حسب الفئة بإصدارات ومصفوفة صلاحيات يفرضها الخادم.", category: "الفئة", capabilities: "الصلاحيات", save: "حفظ الصلاحيات", saving: "جارٍ الحفظ…", saved: "تم الحفظ.", forms: "النماذج ذات الإصدارات", newForm: "نموذج جديد", code: "الرمز", purpose: "الغرض", create: "إنشاء النموذج", labels: "التسميات", questions: "الأسئلة", addQuestion: "إضافة سؤال", draft: "إنشاء نسخة مسودة", activate: "تفعيل", required: "إلزامي", options: "خيارات الاختيار", observations: "رموز القياسات", questionnaires: "رموز الاستبيانات", offlineHint: "HOME_VISIT يتيح أهلية المزامنة دون اتصال مع بقاء تحقق الخادم من الموعد.", signatureHint: "SERVICE_COMPLETION_CHECKLIST يحكم توقيع/استلام الخدمة مع تحقق الأدلة في الخادم.", empty: "لا توجد نماذج لهذه الفئة.", reload: "تحديث", error: "فشل الطلب." },
  fr: { title: "Taxonomie des prestataires", eyebrow: "P0 · ADM-106 / ADM-107", subtitle: "Formulaires versionnés par catégorie et matrice de capacités imposée par le serveur.", category: "Catégorie", capabilities: "Capacités", save: "Enregistrer les capacités", saving: "Enregistrement…", saved: "Enregistré.", forms: "Formulaires versionnés", newForm: "Nouveau formulaire", code: "Code", purpose: "But", create: "Créer le formulaire", labels: "Libellés", questions: "Questions", addQuestion: "Ajouter une question", draft: "Créer une version brouillon", activate: "Activer", required: "Obligatoire", options: "Options de choix", observations: "Codes d’observation", questionnaires: "Codes de questionnaire", offlineHint: "HOME_VISIT autorise l’éligibilité à la synchro hors ligne; le serveur vérifie toujours le rendez-vous.", signatureHint: "SERVICE_COMPLETION_CHECKLIST gouverne la signature/réception avec contrôle serveur des preuves.", empty: "Aucun formulaire pour cette catégorie.", reload: "Actualiser", error: "Échec de la requête." },
  es: { title: "Taxonomía de proveedores", eyebrow: "P0 · ADM-106 / ADM-107", subtitle: "Formularios versionados por categoría y matriz de capabilities impuesta por servidor.", category: "Categoría", capabilities: "Capabilities", save: "Guardar capabilities", saving: "Guardando…", saved: "Guardado.", forms: "Formularios versionados", newForm: "Nuevo formulario", code: "Código", purpose: "Propósito", create: "Crear formulario", labels: "Etiquetas", questions: "Preguntas", addQuestion: "Añadir pregunta", draft: "Crear versión borrador", activate: "Activar", required: "Obligatorio", options: "Opciones de elección", observations: "Códigos de observación", questionnaires: "Códigos de cuestionario", offlineHint: "HOME_VISIT habilita elegibilidad para sincronización offline; el servidor sigue validando la cita.", signatureHint: "SERVICE_COMPLETION_CHECKLIST gobierna firma/recepción del servicio junto con la evidencia del servidor.", empty: "No hay formularios para esta categoría.", reload: "Actualizar", error: "Error en la solicitud." },
};

function blankQuestion(): BuilderQuestion {
  return { id: "", type: "TEXT", required: false, en: "", ar: "", fr: "", es: "", options: "", min: "", max: "", maxLength: "2000" };
}
function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function codeList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

export default function ProviderTaxonomyPage() {
  const { locale } = useI18n();
  const t = copy[locale];
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [forms, setForms] = useState<ProviderForm[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [orderCaps, setOrderCaps] = useState<string[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [workflow, setWorkflow] = useState<string[]>([]);
  const [observationCodes, setObservationCodes] = useState("");
  const [questionnaireCodes, setQuestionnaireCodes] = useState("");
  const [formCode, setFormCode] = useState("");
  const [purpose, setPurpose] = useState("GENERAL");
  const [labels, setLabels] = useState({ en: "", ar: "", fr: "", es: "" });
  const [questions, setQuestions] = useState<BuilderQuestion[]>([blankQuestion()]);
  const selected = useMemo(() => categories.find((item) => item.id === selectedId) ?? null, [categories, selectedId]);

  useEffect(() => { void loadCategories(); }, []);
  useEffect(() => { if (selectedId) void loadForms(selectedId); }, [selectedId]);
  useEffect(() => {
    if (!selected) return;
    setModalities(list(selected.enabledModalities));
    setOrderCaps(list(selected.clinicalOrderCapabilities));
    setSummary(list(selected.clinicalSummarySections));
    setWorkflow(list(selected.workflowCapabilities));
    setObservationCodes(list(selected.observationCodes).join(", "));
    setQuestionnaireCodes(list(selected.questionnaireCodes).join(", "));
  }, [selected]);

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : t.error);
    return body;
  }

  async function loadCategories() {
    setBusy(true);
    setMessage("");
    try {
      const body = await request("/api/admin/provider-taxonomy/categories");
      const items: Category[] = Array.isArray(body?.items) ? body.items : [];
      setCategories(items);
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? ""));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadForms(categoryId: string) {
    try {
      const body = await request("/api/admin/provider-taxonomy/forms?categoryId=" + encodeURIComponent(categoryId));
      setForms(Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []));
    } catch (error) {
      setMessage(String(error));
    }
  }

  function toggle(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function saveCapabilities() {
    if (!selected) return;
    setMessage(t.saving);
    try {
      const updated = await request("/api/admin/provider-taxonomy/categories/" + encodeURIComponent(selected.id) + "/capabilities", {
        method: "PATCH",
        body: JSON.stringify({
          enabledModalities: modalities,
          clinicalOrderCapabilities: orderCaps,
          clinicalSummarySections: summary,
          observationCodes: codeList(observationCodes),
          questionnaireCodes: codeList(questionnaireCodes),
          workflowCapabilities: workflow,
        }),
      });
      setCategories((current) => current.map((item) => item.id === selected.id ? { ...item, ...updated } : item));
      setMessage(t.saved);
    } catch (error) {
      setMessage(String(error));
    }
  }

  function buildSchema() {
    return {
      schemaVersion: 1,
      questions: questions.map((question) => {
        const output: Record<string, unknown> = {
          id: question.id.trim(),
          type: question.type,
          required: question.required,
          labels: {
            en: question.en.trim(),
            ...(question.ar.trim() ? { ar: question.ar.trim() } : {}),
            ...(question.fr.trim() ? { fr: question.fr.trim() } : {}),
            ...(question.es.trim() ? { es: question.es.trim() } : {}),
          },
        };
        if (question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE") {
          output.options = question.options.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
            const [value, en, ar, fr, es] = line.split("|").map((part) => part.trim());
            return { value, labels: { en: en || value, ...(ar ? { ar } : {}), ...(fr ? { fr } : {}), ...(es ? { es } : {}) } };
          });
        }
        if (question.type === "NUMBER") {
          if (question.min.trim()) output.min = Number(question.min);
          if (question.max.trim()) output.max = Number(question.max);
        }
        if (question.type === "TEXT" && question.maxLength.trim()) output.maxLength = Number(question.maxLength);
        return output;
      }),
    };
  }

  async function createForm() {
    if (!selected) return;
    try {
      await request("/api/admin/provider-taxonomy/forms", {
        method: "POST",
        body: JSON.stringify({ categoryId: selected.id, code: formCode.trim().toUpperCase(), purpose, labels }),
      });
      setFormCode("");
      setLabels({ en: "", ar: "", fr: "", es: "" });
      await loadForms(selected.id);
      setMessage(t.saved);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function createVersion(form: ProviderForm) {
    try {
      await request("/api/admin/provider-taxonomy/forms/" + encodeURIComponent(form.id) + "/versions", {
        method: "POST",
        body: JSON.stringify({ schema: buildSchema() }),
      });
      await loadForms(selectedId);
      setMessage(t.saved);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function activate(formId: string, version: number) {
    try {
      await request("/api/admin/provider-taxonomy/forms/" + encodeURIComponent(formId) + "/versions/" + version + "/activate", {
        method: "POST",
        body: "{}",
      });
      await loadForms(selectedId);
      setMessage(t.saved);
    } catch (error) {
      setMessage(String(error));
    }
  }

  const box = { background: "#fff", border: "1px solid #dbe4ee", borderRadius: 16, padding: 16 } as const;
  const grid = { display: "grid", gap: 12 } as const;

  return <AppShell active="02" eyebrow={t.eyebrow} title={t.title}>
    <section className="notice-card">
      <div><span>{t.subtitle}</span><p>{message}</p></div>
      <button className="secondary-button" onClick={() => void loadCategories()}>{t.reload}</button>
    </section>

    {busy ? <p>Loading…</p> : <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,280px) 1fr", gap: 18 }}>
      <aside style={{ ...box, ...grid, alignContent: "start" }}>
        <h3>{t.category}</h3>
        {categories.map((category) => <button
          key={category.id}
          className={category.id === selectedId ? "primary-button" : "secondary-button"}
          onClick={() => setSelectedId(category.id)}
          style={{ textAlign: "start" }}
        >
          {(category.labels?.[locale] || category.labels?.en || category.slug) as string}
          <br /><small>{category.family}</small>
        </button>)}
      </aside>

      <div style={grid}>
        {selected && <>
          <section style={box}>
            <h2>{t.capabilities}</h2>
            <CapabilityGroup label="Service modalities" values={MODALITIES} selected={modalities} onToggle={(value) => toggle(modalities, value, setModalities)} />
            <CapabilityGroup label="Clinical orders" values={ORDER_CAPS} selected={orderCaps} onToggle={(value) => toggle(orderCaps, value, setOrderCaps)} />
            <CapabilityGroup label="Clinical summary" values={SUMMARY} selected={summary} onToggle={(value) => toggle(summary, value, setSummary)} />
            <CapabilityGroup label="Workflow" values={WORKFLOW} selected={workflow} onToggle={(value) => toggle(workflow, value, setWorkflow)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>{t.observations}<input value={observationCodes} onChange={(event) => setObservationCodes(event.target.value)} placeholder="HEART_RATE, SPO2" /></label>
              <label>{t.questionnaires}<input value={questionnaireCodes} onChange={(event) => setQuestionnaireCodes(event.target.value)} placeholder="INTAKE_GENERAL" /></label>
            </div>
            <p><small>{t.offlineHint}</small></p>
            <p><small>{t.signatureHint}</small></p>
            <button className="primary-button" onClick={() => void saveCapabilities()}>{t.save}</button>
          </section>

          <section style={box}>
            <h2>{t.forms}</h2>
            {forms.length === 0 && <p>{t.empty}</p>}
            {forms.map((form) => {
              const latest = [...(form.versions ?? [])].sort((left, right) => right.version - left.version)[0];
              const status = latest ? "v" + latest.version + " " + latest.status : "no version";
              return <div key={form.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #e2e8f0" }}>
                <div><strong>{form.code}</strong><br /><small>{form.purpose} · {status}</small></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="secondary-button" onClick={() => void createVersion(form)}>{t.draft}</button>
                  {latest?.status === "DRAFT" && <button className="primary-button" onClick={() => void activate(form.id, latest.version)}>{t.activate}</button>}
                </div>
              </div>;
            })}
          </section>

          <section style={box}>
            <h2>{t.newForm}</h2>
            <div style={{ ...grid, gridTemplateColumns: "1fr 1fr" }}>
              <label>{t.code}<input value={formCode} onChange={(event) => setFormCode(event.target.value)} placeholder="HOME_VISIT_ASSESSMENT" /></label>
              <label>{t.purpose}<select value={purpose} onChange={(event) => setPurpose(event.target.value)}>{PURPOSES.map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <div style={{ ...grid, gridTemplateColumns: "repeat(4,1fr)" }}>
              {(["en","ar","fr","es"] as const).map((language) => <label key={language}>{t.labels} {language.toUpperCase()}<input value={labels[language]} onChange={(event) => setLabels({ ...labels, [language]: event.target.value })} /></label>)}
            </div>
            <h3>{t.questions}</h3>
            {questions.map((question, index) => <div key={index} style={{ ...box, marginBottom: 12 }}>
              <div style={{ ...grid, gridTemplateColumns: "1fr 1fr auto" }}>
                <label>ID<input value={question.id} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} /></label>
                <label>Type<select value={question.type} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, type: event.target.value as QuestionType } : item))}>{TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><input type="checkbox" checked={question.required} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} /> {t.required}</label>
              </div>
              <div style={{ ...grid, gridTemplateColumns: "repeat(4,1fr)" }}>
                {(["en","ar","fr","es"] as const).map((language) => <label key={language}>Label {language.toUpperCase()}<input value={question[language]} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, [language]: event.target.value } : item))} /></label>)}
              </div>
              {(question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE") && <label>{t.options}<textarea rows={4} value={question.options} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, options: event.target.value } : item))} placeholder={"VALUE|English|العربية|Français|Español\nVALUE2|..."} /></label>}
              {question.type === "NUMBER" && <div style={{ ...grid, gridTemplateColumns: "1fr 1fr" }}><label>Min<input value={question.min} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, min: event.target.value } : item))} /></label><label>Max<input value={question.max} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, max: event.target.value } : item))} /></label></div>}
              {question.type === "TEXT" && <label>Max length<input value={question.maxLength} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, maxLength: event.target.value } : item))} /></label>}
              {questions.length > 1 && <button className="secondary-button" onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}>Remove question</button>}
            </div>)}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="secondary-button" onClick={() => setQuestions((current) => [...current, blankQuestion()])}>{t.addQuestion}</button>
              <button className="primary-button" onClick={() => void createForm()}>{t.create}</button>
            </div>
            <p><small>Creating a definition does not publish it. Create a DRAFT version, then activate after server validation. Responses stay pinned to the exact schema version.</small></p>
          </section>
        </>}
      </div>
    </div>}
  </AppShell>;
}

function CapabilityGroup({ label, values, selected, onToggle }: { label: string; values: readonly string[]; selected: string[]; onToggle: (value: string) => void }) {
  return <fieldset style={{ border: "1px solid #e2e8f0", borderRadius: 12, margin: "12px 0" }}>
    <legend><strong>{label}</strong></legend>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {values.map((value) => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} /> {value}</label>)}
    </div>
  </fieldset>;
}
