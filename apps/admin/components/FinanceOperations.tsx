"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import styles from "./FinanceOperations.module.css";

type ProviderRef = { id: string; class: string; displayName: string; status: string };
type MoneySummary = { currency: string; count: number; amountMinor: number };
type InvoiceItem = { invoiceId: string; number: string; provider: ProviderRef; currency: string; totalMinor: number; patientResponsibilityMinor: number; insurerResponsibilityMinor: number; amountPaidMinor: number; amountRefundedMinor: number; balanceDueMinor: number; status: string; issuedAt: string; updatedAt: string };
type PaymentItem = { paymentIntentId: string; invoiceId: string; provider: ProviderRef; amountMinor: number; refundedMinor: number; refundableMinor: number; currency: string; status: string; failureCode: string | null; createdAt: string; updatedAt: string; succeededAt: string | null };
type ClaimItem = { claimId: string; invoiceId: string; provider: ProviderRef; previousClaimId: string | null; version: number; status: string; reconciliationStatus: string; submittedAmountMinor: number; currency: string; allowedMinor: number | null; insurerPaidMinor: number | null; patientResponsibilityMinor: number | null; adjustmentMinor: number | null; denialCode: string | null; denialPublicMessage: string | null; reworkReasonCode: string | null; submittedAt: string; adjudicatedAt: string | null; paidAt: string | null };
type PayoutItem = { payoutId: string; provider: ProviderRef; amountMinor: number; currency: string; status: string; periodStart: string | null; periodEnd: string | null; createdAt: string; updatedAt: string; paidAt: string | null };
type PayoutCapacity = { provider: ProviderRef; currency: string; ledgerBalanceMinor: number; committedPayoutMinor: number; availableForPayoutMinor: number };
type FinanceWorkspace = {
  generatedAt: string;
  privacy: { phiNeutral: boolean; patientIdentityExcluded: boolean; policyIdentifiersExcluded: boolean; gatewayReferencesExcluded: boolean; clinicalContentExcluded: boolean };
  summary: { outstandingInvoices: MoneySummary[]; refundablePayments: MoneySummary[]; pendingPayouts: MoneySummary[]; claimsInFlight: number; claimsAttention: number };
  queues: { invoices: InvoiceItem[]; paymentIntents: PaymentItem[]; claims: ClaimItem[]; payouts: PayoutItem[]; payoutCapacity: PayoutCapacity[] };
};

type Copy = {
  live: string; refresh: string; refreshing: string; unavailable: string; privacy: string; invoices: string; payments: string; claims: string; payouts: string; outstanding: string; refundable: string; pendingPayouts: string; claimsFlight: string; claimsAttention: string; provider: string; amount: string; balance: string; status: string; issued: string; invoice: string; payment: string; reconciliation: string; submitted: string; denial: string; actions: string; refreshAction: string; refund: string; rework: string; createPayout: string; available: string; committed: string; payoutAmount: string; selectCapacity: string; execute: string; success: string; failed: string; empty: string; reasonCodePrompt: string; refundAmountPrompt: string; refundReasonPrompt: string; invalidAmount: string; confirmPayout: string; lastUpdated: string;
};

const copy: Record<Locale, Copy> = {
  en: { live:"LIVE FINANCIAL OPERATIONS",refresh:"Refresh",refreshing:"Refreshing…",unavailable:"Finance operations are temporarily unavailable.",privacy:"PHI-neutral workspace: patient identity, policy identifiers, gateway references and clinical content are excluded.",invoices:"Outstanding invoices",payments:"Payment operations",claims:"Claims & reconciliation",payouts:"Provider payouts",outstanding:"Outstanding",refundable:"Refundable",pendingPayouts:"Pending payouts",claimsFlight:"Claims in flight",claimsAttention:"Claims needing attention",provider:"Provider",amount:"Amount",balance:"Balance due",status:"Status",issued:"Issued",invoice:"Invoice",payment:"Payment",reconciliation:"Reconciliation",submitted:"Submitted",denial:"Denial",actions:"Actions",refreshAction:"Refresh status",refund:"Refund…",rework:"Rework…",createPayout:"Create payout",available:"Available",committed:"Committed",payoutAmount:"Payout amount (minor units)",selectCapacity:"Select provider / currency",execute:"Execute payout",success:"Financial operation completed.",failed:"The financial operation could not be completed.",empty:"No items currently require operational attention.",reasonCodePrompt:"Rework reason code",refundAmountPrompt:"Refund amount in minor units",refundReasonPrompt:"Refund reason (optional)",invalidAmount:"Enter a positive amount within the refundable/available balance.",confirmPayout:"Create this provider payout?",lastUpdated:"Last updated" },
  ar: { live:"العمليات المالية المباشرة",refresh:"تحديث",refreshing:"جارٍ التحديث…",unavailable:"العمليات المالية غير متاحة مؤقتاً.",privacy:"مساحة عمل خالية من PHI: تم استبعاد هوية المريض ومعرّفات وثيقة التأمين ومراجع بوابة الدفع والمحتوى السريري.",invoices:"الفواتير المستحقة",payments:"عمليات الدفع",claims:"المطالبات والتسوية",payouts:"مدفوعات مقدمي الخدمة",outstanding:"مستحق",refundable:"قابل للاسترداد",pendingPayouts:"مدفوعات معلقة",claimsFlight:"مطالبات قيد المعالجة",claimsAttention:"مطالبات تحتاج مراجعة",provider:"مقدم الخدمة",amount:"المبلغ",balance:"الرصيد المستحق",status:"الحالة",issued:"تاريخ الإصدار",invoice:"الفاتورة",payment:"الدفع",reconciliation:"التسوية",submitted:"تاريخ الإرسال",denial:"الرفض",actions:"الإجراءات",refreshAction:"تحديث الحالة",refund:"استرداد…",rework:"إعادة معالجة…",createPayout:"إنشاء دفعة",available:"المتاح",committed:"الملتزم",payoutAmount:"مبلغ الدفعة بالوحدات الصغرى",selectCapacity:"اختر مقدم الخدمة / العملة",execute:"تنفيذ الدفعة",success:"تمت العملية المالية بنجاح.",failed:"تعذر إتمام العملية المالية.",empty:"لا توجد عناصر تحتاج تدخلاً تشغيلياً حالياً.",reasonCodePrompt:"رمز سبب إعادة المعالجة",refundAmountPrompt:"مبلغ الاسترداد بالوحدات الصغرى",refundReasonPrompt:"سبب الاسترداد (اختياري)",invalidAmount:"أدخل مبلغاً موجباً ضمن الرصيد القابل للاسترداد/المتاح.",confirmPayout:"إنشاء دفعة مقدم الخدمة؟",lastUpdated:"آخر تحديث" },
  fr: { live:"OPÉRATIONS FINANCIÈRES EN DIRECT",refresh:"Actualiser",refreshing:"Actualisation…",unavailable:"Les opérations financières sont temporairement indisponibles.",privacy:"Espace sans PHI : identité patient, identifiants de police, références passerelle et contenu clinique sont exclus.",invoices:"Factures à recouvrer",payments:"Opérations de paiement",claims:"Sinistres & rapprochement",payouts:"Versements prestataires",outstanding:"À recouvrer",refundable:"Remboursable",pendingPayouts:"Versements en attente",claimsFlight:"Sinistres en cours",claimsAttention:"Sinistres à examiner",provider:"Prestataire",amount:"Montant",balance:"Solde dû",status:"Statut",issued:"Émise",invoice:"Facture",payment:"Paiement",reconciliation:"Rapprochement",submitted:"Soumis",denial:"Refus",actions:"Actions",refreshAction:"Actualiser le statut",refund:"Rembourser…",rework:"Corriger…",createPayout:"Créer un versement",available:"Disponible",committed:"Engagé",payoutAmount:"Montant du versement (unités mineures)",selectCapacity:"Choisir prestataire / devise",execute:"Exécuter le versement",success:"Opération financière terminée.",failed:"L’opération financière n’a pas pu être terminée.",empty:"Aucun élément ne nécessite actuellement d’intervention.",reasonCodePrompt:"Code motif de correction",refundAmountPrompt:"Montant du remboursement en unités mineures",refundReasonPrompt:"Motif du remboursement (facultatif)",invalidAmount:"Saisissez un montant positif dans la limite remboursable/disponible.",confirmPayout:"Créer ce versement prestataire ?",lastUpdated:"Dernière mise à jour" },
  es: { live:"OPERACIONES FINANCIERAS EN VIVO",refresh:"Actualizar",refreshing:"Actualizando…",unavailable:"Las operaciones financieras no están disponibles temporalmente.",privacy:"Workspace sin PHI: se excluyen identidad del paciente, identificadores de póliza, referencias del gateway y contenido clínico.",invoices:"Facturas pendientes",payments:"Operaciones de pago",claims:"Claims y conciliación",payouts:"Payouts a proveedores",outstanding:"Pendiente",refundable:"Reembolsable",pendingPayouts:"Payouts pendientes",claimsFlight:"Claims en proceso",claimsAttention:"Claims que requieren revisión",provider:"Proveedor",amount:"Importe",balance:"Saldo pendiente",status:"Estado",issued:"Emitida",invoice:"Factura",payment:"Pago",reconciliation:"Conciliación",submitted:"Enviado",denial:"Denegación",actions:"Acciones",refreshAction:"Actualizar estado",refund:"Reembolsar…",rework:"Reprocesar…",createPayout:"Crear payout",available:"Disponible",committed:"Comprometido",payoutAmount:"Importe del payout (unidades menores)",selectCapacity:"Seleccionar proveedor / moneda",execute:"Ejecutar payout",success:"Operación financiera completada.",failed:"No se pudo completar la operación financiera.",empty:"No hay elementos que requieran intervención operativa.",reasonCodePrompt:"Código de motivo para reprocesar",refundAmountPrompt:"Importe del reembolso en unidades menores",refundReasonPrompt:"Motivo del reembolso (opcional)",invalidAmount:"Introduce un importe positivo dentro del saldo reembolsable/disponible.",confirmPayout:"¿Crear este payout al proveedor?",lastUpdated:"Última actualización" },
};

export const financePageCopy: Record<Locale, { title: string; eyebrow: string }> = {
  en: { title: "Finance & Revenue Operations", eyebrow: "REVENUE CYCLE · FINANCIAL CONTROL" },
  ar: { title: "عمليات المالية ودورة الإيرادات", eyebrow: "دورة الإيرادات · الرقابة المالية" },
  fr: { title: "Finance & opérations de revenus", eyebrow: "CYCLE DE REVENUS · CONTRÔLE FINANCIER" },
  es: { title: "Operaciones financieras e ingresos", eyebrow: "CICLO DE INGRESOS · CONTROL FINANCIERO" },
};

type Queue = "INVOICES" | "PAYMENTS" | "CLAIMS" | "PAYOUTS";

export function FinanceOperations() {
  const { locale } = useI18n();
  const c = copy[locale];
  const [workspace, setWorkspace] = useState<FinanceWorkspace | null>(null);
  const [queue, setQueue] = useState<Queue>("INVOICES");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capacityKey, setCapacityKey] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/finance/workspace", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : c.unavailable);
      setWorkspace(payload as FinanceWorkspace);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c.unavailable);
    } finally {
      setLoading(false);
    }
  }, [c.unavailable]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 45_000); return () => window.clearInterval(timer); }, [load]);

  const selectedCapacity = useMemo(() => workspace?.queues.payoutCapacity.find((item) => `${item.provider.id}:${item.currency}` === capacityKey) ?? null, [capacityKey, workspace]);

  async function action(body: Record<string, unknown>) {
    setMutating(true); setMessage(null); setError(null);
    try {
      const response = await fetch("/api/admin/finance/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : c.failed);
      setMessage(c.success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c.failed);
    } finally {
      setMutating(false);
    }
  }

  async function refund(item: PaymentItem) {
    const raw = window.prompt(c.refundAmountPrompt, String(item.refundableMinor));
    if (raw === null) return;
    const amountMinor = Number(raw);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > item.refundableMinor) { setError(c.invalidAmount); return; }
    const reason = window.prompt(c.refundReasonPrompt, "ADMIN_FINANCE") ?? "";
    await action({ action: "REFUND_PAYMENT", resourceId: item.paymentIntentId, amountMinor, reason, idempotencyKey: `admin-refund-${crypto.randomUUID()}` });
  }

  async function rework(item: ClaimItem) {
    const reasonCode = window.prompt(c.reasonCodePrompt, "ADMIN_REVIEW_CORRECTION");
    if (!reasonCode?.trim()) return;
    await action({ action: "REWORK_CLAIM", resourceId: item.claimId, reasonCode: reasonCode.trim().toUpperCase(), idempotencyKey: `admin-claim-${crypto.randomUUID()}` });
  }

  async function createPayout() {
    if (!selectedCapacity) { setError(c.invalidAmount); return; }
    const amountMinor = Number(payoutAmount);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > selectedCapacity.availableForPayoutMinor) { setError(c.invalidAmount); return; }
    if (!window.confirm(c.confirmPayout)) return;
    await action({ action: "CREATE_PAYOUT", providerId: selectedCapacity.provider.id, currency: selectedCapacity.currency, amountMinor, idempotencyKey: `admin-payout-${crypto.randomUUID()}` });
    setPayoutAmount("");
  }

  const summary = workspace?.summary;
  return <>
    <div className={styles.toolbar}>
      <div><span className={styles.live}>{c.live}</span>{workspace ? <small>{c.lastUpdated}: {dateTime(workspace.generatedAt, locale)}</small> : null}</div>
      <button className={styles.refresh} disabled={loading || mutating} onClick={() => void load()}>{loading ? c.refreshing : c.refresh}</button>
    </div>
    {workspace?.privacy.phiNeutral ? <div className={styles.privacy}>{c.privacy}</div> : null}
    {error ? <div className={styles.error}>{error}</div> : null}
    {message ? <div className={styles.success}>{message}</div> : null}

    <section className={styles.kpis}>
      <Metric label={c.outstanding} value={moneySummary(summary?.outstandingInvoices ?? [], locale)} />
      <Metric label={c.refundable} value={moneySummary(summary?.refundablePayments ?? [], locale)} />
      <Metric label={c.pendingPayouts} value={moneySummary(summary?.pendingPayouts ?? [], locale)} />
      <Metric label={c.claimsFlight} value={String(summary?.claimsInFlight ?? 0)} />
      <Metric label={c.claimsAttention} value={String(summary?.claimsAttention ?? 0)} />
    </section>

    <nav className={styles.tabs}>
      <Tab active={queue === "INVOICES"} onClick={() => setQueue("INVOICES")} label={c.invoices} count={workspace?.queues.invoices.length ?? 0} />
      <Tab active={queue === "PAYMENTS"} onClick={() => setQueue("PAYMENTS")} label={c.payments} count={workspace?.queues.paymentIntents.length ?? 0} />
      <Tab active={queue === "CLAIMS"} onClick={() => setQueue("CLAIMS")} label={c.claims} count={workspace?.queues.claims.length ?? 0} />
      <Tab active={queue === "PAYOUTS"} onClick={() => setQueue("PAYOUTS")} label={c.payouts} count={workspace?.queues.payouts.length ?? 0} />
    </nav>

    {queue === "INVOICES" ? <div className={styles.tableWrap}><table><thead><tr><th>{c.invoice}</th><th>{c.provider}</th><th>{c.status}</th><th>{c.amount}</th><th>{c.balance}</th><th>{c.issued}</th></tr></thead><tbody>{workspace?.queues.invoices.map((item) => <tr key={item.invoiceId}><td><strong>{item.number}</strong><small>{shortId(item.invoiceId)}</small></td><td>{item.provider.displayName}</td><td><Status value={item.status} /></td><td>{money(item.totalMinor, item.currency, locale)}</td><td>{money(item.balanceDueMinor, item.currency, locale)}</td><td>{dateTime(item.issuedAt, locale)}</td></tr>)}</tbody></table>{workspace && workspace.queues.invoices.length === 0 ? <Empty text={c.empty} /> : null}</div> : null}

    {queue === "PAYMENTS" ? <div className={styles.tableWrap}><table><thead><tr><th>{c.payment}</th><th>{c.provider}</th><th>{c.status}</th><th>{c.amount}</th><th>{c.refundable}</th><th>{c.actions}</th></tr></thead><tbody>{workspace?.queues.paymentIntents.map((item) => <tr key={item.paymentIntentId}><td><strong>{shortId(item.paymentIntentId)}</strong><small>{c.invoice}: {shortId(item.invoiceId)}</small></td><td>{item.provider.displayName}</td><td><Status value={item.status} />{item.failureCode ? <small>{item.failureCode}</small> : null}</td><td>{money(item.amountMinor, item.currency, locale)}</td><td>{money(item.refundableMinor, item.currency, locale)}</td><td className={styles.actions}>{item.status === "PROCESSING" || item.status === "REQUIRES_ACTION" ? <button disabled={mutating} onClick={() => void action({ action: "REFRESH_PAYMENT", resourceId: item.paymentIntentId })}>{c.refreshAction}</button> : null}{item.refundableMinor > 0 ? <button disabled={mutating} onClick={() => void refund(item)}>{c.refund}</button> : null}</td></tr>)}</tbody></table>{workspace && workspace.queues.paymentIntents.length === 0 ? <Empty text={c.empty} /> : null}</div> : null}

    {queue === "CLAIMS" ? <div className={styles.tableWrap}><table><thead><tr><th>Claim</th><th>{c.provider}</th><th>{c.status}</th><th>{c.reconciliation}</th><th>{c.amount}</th><th>{c.denial}</th><th>{c.actions}</th></tr></thead><tbody>{workspace?.queues.claims.map((item) => <tr key={item.claimId}><td><strong>{shortId(item.claimId)} · v{item.version}</strong><small>{c.invoice}: {shortId(item.invoiceId)} · {c.submitted}: {dateTime(item.submittedAt, locale)}</small></td><td>{item.provider.displayName}</td><td><Status value={item.status} /></td><td><Status value={item.reconciliationStatus} /></td><td>{money(item.submittedAmountMinor, item.currency, locale)}</td><td>{item.denialCode ?? "—"}<small>{item.denialPublicMessage ?? ""}</small></td><td className={styles.actions}>{item.status === "DENIED" ? <button disabled={mutating} onClick={() => void rework(item)}>{c.rework}</button> : <button disabled={mutating} onClick={() => void action({ action: "REFRESH_CLAIM", resourceId: item.claimId })}>{c.refreshAction}</button>}</td></tr>)}</tbody></table>{workspace && workspace.queues.claims.length === 0 ? <Empty text={c.empty} /> : null}</div> : null}

    {queue === "PAYOUTS" ? <>
      <section className={styles.payoutComposer}><div><span>{c.createPayout}</span><strong>{c.available}</strong></div><select value={capacityKey} onChange={(event) => { setCapacityKey(event.target.value); const item = workspace?.queues.payoutCapacity.find((entry) => `${entry.provider.id}:${entry.currency}` === event.target.value); setPayoutAmount(item ? String(item.availableForPayoutMinor) : ""); }}><option value="">{c.selectCapacity}</option>{workspace?.queues.payoutCapacity.map((item) => <option key={`${item.provider.id}:${item.currency}`} value={`${item.provider.id}:${item.currency}`}>{item.provider.displayName} · {item.currency} · {c.available} {item.availableForPayoutMinor}</option>)}</select><input aria-label={c.payoutAmount} placeholder={c.payoutAmount} inputMode="numeric" value={payoutAmount} onChange={(event) => setPayoutAmount(event.target.value.replace(/[^0-9]/g, ""))} /><button disabled={mutating || !selectedCapacity} onClick={() => void createPayout()}>{c.execute}</button>{selectedCapacity ? <small>{c.available}: {money(selectedCapacity.availableForPayoutMinor, selectedCapacity.currency, locale)} · {c.committed}: {money(selectedCapacity.committedPayoutMinor, selectedCapacity.currency, locale)}</small> : null}</section>
      <div className={styles.tableWrap}><table><thead><tr><th>Payout</th><th>{c.provider}</th><th>{c.status}</th><th>{c.amount}</th><th>{c.issued}</th></tr></thead><tbody>{workspace?.queues.payouts.map((item) => <tr key={item.payoutId}><td><strong>{shortId(item.payoutId)}</strong></td><td>{item.provider.displayName}</td><td><Status value={item.status} /></td><td>{money(item.amountMinor, item.currency, locale)}</td><td>{dateTime(item.createdAt, locale)}</td></tr>)}</tbody></table>{workspace && workspace.queues.payouts.length === 0 ? <Empty text={c.empty} /> : null}</div>
    </> : null}
  </>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function Tab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) { return <button className={active ? styles.tabActive : styles.tab} onClick={onClick}>{label}<b>{count}</b></button>; }
function Status({ value }: { value: string }) { return <span className={styles.status} data-status={value}>{value.replaceAll("_", " ")}</span>; }
function Empty({ text }: { text: string }) { return <div className={styles.empty}>{text}</div>; }
function shortId(value: string) { return value.length > 12 ? `${value.slice(0, 8)}…` : value; }
function dateTime(value: string, locale: Locale) { try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return value; } }
function money(amountMinor: number, currency: string, locale: Locale) { try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100); } catch { return `${currency} ${(amountMinor / 100).toFixed(2)}`; } }
function moneySummary(items: MoneySummary[], locale: Locale) { if (!items.length) return "0"; return items.map((item) => `${money(item.amountMinor, item.currency, locale)} · ${item.count}`).join("  /  "); }
