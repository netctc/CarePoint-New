"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./ClinicalProfileSchemaAdmin.module.css";

type SchemaStatus = "DRAFT" | "ACTIVE" | "RETIRED";
type SchemaRecord = {
  schemaId: string;
  jurisdiction: string;
  version: number;
  status: SchemaStatus;
  immutable: boolean;
  definition: unknown;
  definitionHash: string;
  validationErrors: unknown[];
  validatedAt: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  supersedesSchemaId: string | null;
  createdAt: string;
  updatedAt: string;
};
type ListResponse = {
  generatedAt: string;
  constraints: {
    supportedLocales: string[];
    supportedFieldTypes: string[];
    publishedSchemasImmutable: boolean;
    oneActiveSchemaPerJurisdiction: boolean;
  };
  items: SchemaRecord[];
};

type Copy = {
  boundaryTitle: string;
  boundaryText: string;
  jurisdiction: string;
  status: string;
  all: string;
  refresh: string;
  createDraft: string;
  newJurisdiction: string;
  schemas: string;
  version: string;
  updated: string;
  definition: string;
  definitionHint: string;
  saveDraft: string;
  validate: string;
  publish: string;
  retire: string;
  immutable: string;
  mutable: string;
  validated: string;
  notValidated: string;
  hash: string;
  errors: string;
  noErrors: string;
  empty: string;
  select: string;
  loading: string;
  loadError: string;
  invalidJson: string;
  saved: string;
  created: string;
  published: string;
  retired: string;
  validatedMessage: string;
  confirmPublish: string;
  confirmRetire: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    boundaryTitle: "Versioned clinical configuration",
    boundaryText: "Published schema versions are immutable. A schema must pass server validation before publication, and publishing a new version retires the previous active version for the same jurisdiction.",
    jurisdiction: "Jurisdiction",
    status: "Status",
    all: "All",
    refresh: "Refresh",
    createDraft: "Create draft",
    newJurisdiction: "GLOBAL or country code",
    schemas: "Schema versions",
    version: "Version",
    updated: "Updated",
    definition: "Schema definition",
    definitionHint: "Edit sections and fields as JSON. EN / AR / FR / ES labels are required for every section, field and selectable option.",
    saveDraft: "Save draft",
    validate: "Validate",
    publish: "Publish",
    retire: "Retire active version",
    immutable: "Immutable",
    mutable: "Editable draft",
    validated: "Validated",
    notValidated: "Not validated",
    hash: "Definition hash",
    errors: "Validation errors",
    noErrors: "No validation errors.",
    empty: "No clinical profile schema versions match the current filters.",
    select: "Select a schema version to inspect or edit it.",
    loading: "Loading schema registry…",
    loadError: "The clinical profile schema registry could not be loaded.",
    invalidJson: "The editor must contain valid JSON before it can be saved.",
    saved: "Draft saved.",
    created: "Draft version created.",
    published: "Schema version published.",
    retired: "Active schema version retired.",
    validatedMessage: "Server validation completed.",
    confirmPublish: "Publish this version? The current active version for this jurisdiction will be retired.",
    confirmRetire: "Retire this active schema version? Historical versions remain available.",
  },
  ar: {
    boundaryTitle: "إعداد سريري بإصدارات",
    boundaryText: "إصدارات المخطط المنشورة غير قابلة للتعديل. يجب أن ينجح المخطط في التحقق على الخادم قبل النشر، ويؤدي نشر إصدار جديد إلى إحالة الإصدار النشط السابق لنفس الاختصاص إلى التقاعد.",
    jurisdiction: "الاختصاص",
    status: "الحالة",
    all: "الكل",
    refresh: "تحديث",
    createDraft: "إنشاء مسودة",
    newJurisdiction: "GLOBAL أو رمز الدولة",
    schemas: "إصدارات المخطط",
    version: "الإصدار",
    updated: "آخر تحديث",
    definition: "تعريف المخطط",
    definitionHint: "عدّل الأقسام والحقول بصيغة JSON. التسميات EN / AR / FR / ES مطلوبة لكل قسم وحقل وخيار قابل للاختيار.",
    saveDraft: "حفظ المسودة",
    validate: "تحقق",
    publish: "نشر",
    retire: "إحالة الإصدار النشط للتقاعد",
    immutable: "غير قابل للتعديل",
    mutable: "مسودة قابلة للتعديل",
    validated: "تم التحقق",
    notValidated: "غير متحقق",
    hash: "بصمة التعريف",
    errors: "أخطاء التحقق",
    noErrors: "لا توجد أخطاء تحقق.",
    empty: "لا توجد إصدارات تطابق عوامل التصفية الحالية.",
    select: "اختر إصداراً لعرضه أو تعديله.",
    loading: "جارٍ تحميل سجل المخططات…",
    loadError: "تعذر تحميل سجل مخطط الملف السريري.",
    invalidJson: "يجب أن يحتوي المحرر على JSON صالح قبل الحفظ.",
    saved: "تم حفظ المسودة.",
    created: "تم إنشاء إصدار مسودة.",
    published: "تم نشر إصدار المخطط.",
    retired: "تمت إحالة الإصدار النشط للتقاعد.",
    validatedMessage: "اكتمل التحقق على الخادم.",
    confirmPublish: "نشر هذا الإصدار؟ سيتم إحالة الإصدار النشط الحالي لنفس الاختصاص إلى التقاعد.",
    confirmRetire: "إحالة هذا الإصدار النشط للتقاعد؟ ستبقى الإصدارات التاريخية متاحة.",
  },
  fr: {
    boundaryTitle: "Configuration clinique versionnée",
    boundaryText: "Les versions publiées sont immuables. Un schéma doit réussir la validation serveur avant publication; publier une nouvelle version retire la précédente version active de la même juridiction.",
    jurisdiction: "Juridiction",
    status: "Statut",
    all: "Tous",
    refresh: "Actualiser",
    createDraft: "Créer un brouillon",
    newJurisdiction: "GLOBAL ou code pays",
    schemas: "Versions du schéma",
    version: "Version",
    updated: "Mis à jour",
    definition: "Définition du schéma",
    definitionHint: "Modifiez sections et champs en JSON. Les libellés EN / AR / FR / ES sont requis pour chaque section, champ et option sélectionnable.",
    saveDraft: "Enregistrer",
    validate: "Valider",
    publish: "Publier",
    retire: "Retirer la version active",
    immutable: "Immuable",
    mutable: "Brouillon modifiable",
    validated: "Validé",
    notValidated: "Non validé",
    hash: "Empreinte de définition",
    errors: "Erreurs de validation",
    noErrors: "Aucune erreur de validation.",
    empty: "Aucune version ne correspond aux filtres actuels.",
    select: "Sélectionnez une version pour l’inspecter ou la modifier.",
    loading: "Chargement du registre des schémas…",
    loadError: "Impossible de charger le registre du schéma de profil clinique.",
    invalidJson: "L’éditeur doit contenir un JSON valide avant enregistrement.",
    saved: "Brouillon enregistré.",
    created: "Version brouillon créée.",
    published: "Version du schéma publiée.",
    retired: "Version active retirée.",
    validatedMessage: "Validation serveur terminée.",
    confirmPublish: "Publier cette version ? La version active actuelle de cette juridiction sera retirée.",
    confirmRetire: "Retirer cette version active ? Les versions historiques resteront disponibles.",
  },
  es: {
    boundaryTitle: "Configuración clínica versionada",
    boundaryText: "Las versiones publicadas son inmutables. Un esquema debe superar la validación del servidor antes de publicarse; al publicar una nueva versión se retira la versión activa anterior de la misma jurisdicción.",
    jurisdiction: "Jurisdicción",
    status: "Estado",
    all: "Todos",
    refresh: "Actualizar",
    createDraft: "Crear borrador",
    newJurisdiction: "GLOBAL o código de país",
    schemas: "Versiones del esquema",
    version: "Versión",
    updated: "Actualizado",
    definition: "Definición del esquema",
    definitionHint: "Edite secciones y campos como JSON. Se requieren etiquetas EN / AR / FR / ES para cada sección, campo y opción seleccionable.",
    saveDraft: "Guardar borrador",
    validate: "Validar",
    publish: "Publicar",
    retire: "Retirar versión activa",
    immutable: "Inmutable",
    mutable: "Borrador editable",
    validated: "Validado",
    notValidated: "No validado",
    hash: "Hash de definición",
    errors: "Errores de validación",
    noErrors: "Sin errores de validación.",
    empty: "Ninguna versión coincide con los filtros actuales.",
    select: "Seleccione una versión para inspeccionarla o editarla.",
    loading: "Cargando registro de esquemas…",
    loadError: "No se pudo cargar el registro del esquema de perfil clínico.",
    invalidJson: "El editor debe contener JSON válido antes de guardarlo.",
    saved: "Borrador guardado.",
    created: "Versión borrador creada.",
    published: "Versión del esquema publicada.",
    retired: "Versión activa retirada.",
    validatedMessage: "Validación del servidor completada.",
    confirmPublish: "¿Publicar esta versión? La versión activa actual de esta jurisdicción será retirada.",
    confirmRetire: "¿Retirar esta versión activa? Las versiones históricas seguirán disponibles.",
  },
};

const starterDefinition = {
  sections: [
    {
      key: "demographics",
      labels: { en: "Demographics", ar: "البيانات الديموغرافية", fr: "Démographie", es: "Demografía" },
      enabled: true,
      order: 10,
      fields: [
        {
          key: "preferred_language",
          labels: { en: "Preferred language", ar: "اللغة المفضلة", fr: "Langue préférée", es: "Idioma preferido" },
          type: "SINGLE_SELECT",
          required: false,
          enabled: true,
          options: [
            { value: "ar", labels: { en: "Arabic", ar: "العربية", fr: "Arabe", es: "Árabe" } },
            { value: "en", labels: { en: "English", ar: "الإنجليزية", fr: "Anglais", es: "Inglés" } },
          ],
        },
      ],
    },
  ],
};

function responseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const raw = (payload as { message?: unknown }).message;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object" && "message" in raw && typeof (raw as { message?: unknown }).message === "string") {
      return (raw as { message: string }).message;
    }
  }
  return fallback;
}

function validationErrors(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const direct = (payload as { validationErrors?: unknown }).validationErrors;
  if (Array.isArray(direct)) return direct.filter((item): item is string => typeof item === "string");
  const message = (payload as { message?: unknown }).message;
  if (message && typeof message === "object") {
    const nested = (message as { validationErrors?: unknown }).validationErrors;
    if (Array.isArray(nested)) return nested.filter((item): item is string => typeof item === "string");
  }
  return [];
}

export function ClinicalProfileSchemaAdmin() {
  const { locale } = useI18n();
  const text = copy[locale];
  const [items, setItems] = useState<SchemaRecord[]>([]);
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [newJurisdiction, setNewJurisdiction] = useState("GLOBAL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState(JSON.stringify(starterDefinition, null, 2));
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(() => items.find((item) => item.schemaId === selectedId) ?? null, [items, selectedId]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);

  const load = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (jurisdictionFilter.trim()) params.set("jurisdiction", jurisdictionFilter.trim());
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    try {
      const response = await fetch(`/api/admin/clinical/profile-schema${params.size ? `?${params}` : ""}`, { cache: "no-store", headers: { accept: "application/json" } });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(responseMessage(payload, text.loadError));
      const list = payload as ListResponse;
      setItems(list.items);
      const targetId = preferredId ?? selectedId;
      const target = list.items.find((item) => item.schemaId === targetId) ?? list.items[0] ?? null;
      setSelectedId(target?.schemaId ?? null);
      if (target) setEditor(JSON.stringify(target.definition, null, 2));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : text.loadError);
    } finally {
      setLoading(false);
    }
  }, [jurisdictionFilter, selectedId, statusFilter, text.loadError]);

  useEffect(() => { void load(); }, [jurisdictionFilter, statusFilter]);

  useEffect(() => {
    if (selected) setEditor(JSON.stringify(selected.definition, null, 2));
  }, [selectedId]);

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>, successText: string) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/clinical/profile-schema", {
        method,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (response.status === 401) {
        window.location.assign("/login");
        return null;
      }
      if (!response.ok) {
        const errors = validationErrors(payload);
        const suffix = errors.length ? ` ${errors.join(" · ")}` : "";
        throw new Error(`${responseMessage(payload, text.loadError)}${suffix}`);
      }
      const record = payload as SchemaRecord;
      setNotice(successText);
      await load(record.schemaId);
      return record;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : text.loadError);
      return null;
    } finally {
      setWorking(false);
    }
  }

  async function createDraft() {
    const jurisdiction = newJurisdiction.trim().toUpperCase();
    if (!jurisdiction) return;
    await send("POST", { jurisdiction, definition: starterDefinition }, text.created);
  }

  function parsedEditor(): unknown | null {
    try {
      return JSON.parse(editor) as unknown;
    } catch {
      setError(text.invalidJson);
      return null;
    }
  }

  async function saveDraft() {
    if (!selected || selected.immutable) return;
    const definition = parsedEditor();
    if (!definition) return;
    await send("PATCH", { schemaId: selected.schemaId, action: "UPDATE_DRAFT", definition }, text.saved);
  }

  async function runAction(action: "VALIDATE" | "PUBLISH" | "RETIRE") {
    if (!selected) return;
    if (action === "PUBLISH" && !window.confirm(text.confirmPublish)) return;
    if (action === "RETIRE" && !window.confirm(text.confirmRetire)) return;
    const success = action === "VALIDATE" ? text.validatedMessage : action === "PUBLISH" ? text.published : text.retired;
    await send("PATCH", { schemaId: selected.schemaId, action }, success);
  }

  function choose(item: SchemaRecord) {
    setSelectedId(item.schemaId);
    setEditor(JSON.stringify(item.definition, null, 2));
    setError(null);
    setNotice(null);
  }

  return <>
    <div className={styles.notice}>
      <strong>{text.boundaryTitle}</strong>
      {text.boundaryText}
    </div>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.success} role="status">{notice}</div> : null}

    <div className={styles.toolbar}>
      <div className={styles.filters}>
        <label className={styles.field}>
          <span>{text.jurisdiction}</span>
          <input value={jurisdictionFilter} maxLength={32} onChange={(event) => setJurisdictionFilter(event.target.value.toUpperCase())} placeholder="GLOBAL" />
        </label>
        <label className={styles.field}>
          <span>{text.status}</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">{text.all}</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="RETIRED">RETIRED</option>
          </select>
        </label>
        <button type="button" className={styles.button} onClick={() => void load()} disabled={loading || working}>{text.refresh}</button>
      </div>
    </div>

    <div className={styles.layout}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2>{text.schemas}</h2><span>{items.length}</span></div>
        <div className={styles.newRow}>
          <label className={styles.field}>
            <span>{text.jurisdiction}</span>
            <input value={newJurisdiction} maxLength={32} onChange={(event) => setNewJurisdiction(event.target.value.toUpperCase())} placeholder={text.newJurisdiction} />
          </label>
          <div className={styles.hint}>{text.newJurisdiction}</div>
          <button type="button" className={styles.primary} onClick={() => void createDraft()} disabled={working || !newJurisdiction.trim()}>{text.createDraft}</button>
        </div>
        <div className={styles.schemaList}>
          {loading && items.length === 0 ? <div className={styles.empty}>{text.loading}</div> : null}
          {items.map((item) => <button type="button" className={styles.schemaItem} data-selected={item.schemaId === selectedId} onClick={() => choose(item)} key={item.schemaId}>
            <div className={styles.schemaTop}><strong>{item.jurisdiction} · v{item.version}</strong><span className={styles.status} data-status={item.status}>{item.status}</span></div>
            <div className={styles.schemaMeta}><span>{item.immutable ? text.immutable : text.mutable}</span><span>{dateFormatter.format(new Date(item.updatedAt))}</span></div>
          </button>)}
          {!loading && items.length === 0 ? <div className={styles.empty}>{text.empty}</div> : null}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2>{text.definition}</h2><span>{selected ? `${selected.jurisdiction} · v${selected.version}` : "—"}</span></div>
        {!selected ? <div className={styles.empty}>{text.select}</div> : <div className={styles.editorPanel}>
          <div className={styles.metaGrid}>
            <div className={styles.metaBox}><small>{text.status}</small><strong>{selected.status}</strong></div>
            <div className={styles.metaBox}><small>{text.version}</small><strong>{selected.version}</strong></div>
            <div className={styles.metaBox}><small>{text.validated}</small><strong>{selected.validatedAt ? dateFormatter.format(new Date(selected.validatedAt)) : text.notValidated}</strong></div>
            <div className={styles.metaBox}><small>{text.updated}</small><strong>{dateFormatter.format(new Date(selected.updatedAt))}</strong></div>
          </div>
          <textarea className={styles.editor} value={editor} onChange={(event) => setEditor(event.target.value)} disabled={selected.immutable || working} spellCheck={false} aria-label={text.definition} />
          <div className={styles.hint}>{text.definitionHint}</div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => void saveDraft()} disabled={working || selected.immutable}>{text.saveDraft}</button>
            <button type="button" className={styles.button} onClick={() => void runAction("VALIDATE")} disabled={working}>{text.validate}</button>
            <button type="button" className={styles.primary} onClick={() => void runAction("PUBLISH")} disabled={working || selected.status !== "DRAFT"}>{text.publish}</button>
            <button type="button" className={styles.danger} onClick={() => void runAction("RETIRE")} disabled={working || selected.status !== "ACTIVE"}>{text.retire}</button>
          </div>
          <div className={styles.validation}>
            <strong>{text.errors}</strong>
            {selected.validationErrors.length ? <ul>{selected.validationErrors.map((entry, index) => <li key={`${index}-${String(entry)}`}>{String(entry)}</li>)}</ul> : <div className={styles.hint}>{text.noErrors}</div>}
          </div>
          <div className={styles.validation}>
            <strong>{text.hash}</strong>
            <div className={`${styles.hint} ${styles.hash}`}>{selected.definitionHash}</div>
          </div>
        </div>}
      </section>
    </div>
  </>;
}
