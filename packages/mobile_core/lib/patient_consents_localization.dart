import 'carepoint_localization.dart';

const patientConsentLabels = <String, Map<String, String>>{
  'title': {'en':'Consent management','es':'Gestión de consentimientos','fr':'Gestion des consentements','ar':'إدارة الموافقات'},
  'subtitle': {'en':'Review, revoke, or safely re-grant an earlier consent. Re-grant preserves the original scope, version and provider.','es':'Revisa, revoca o vuelve a otorgar de forma segura un consentimiento anterior. Se conservan exactamente su alcance, versión y proveedor.','fr':'Consultez, révoquez ou réaccordez en toute sécurité un consentement antérieur. La portée, la version et le prestataire d’origine sont conservés.','ar':'راجع الموافقات أو ألغها أو أعد منح موافقة سابقة بأمان. تتم المحافظة على النطاق والإصدار ومقدم الخدمة الأصليين.'},
  'manage': {'en':'Manage consents','es':'Gestionar consentimientos','fr':'Gérer les consentements','ar':'إدارة الموافقات'},
  'scope': {'en':'Scope','es':'Alcance','fr':'Portée','ar':'النطاق'},
  'version': {'en':'Version','es':'Versión','fr':'Version','ar':'الإصدار'},
  'provider': {'en':'Provider','es':'Proveedor','fr':'Prestataire','ar':'مقدم الخدمة'},
  'allCare': {'en':'CarePoint-wide','es':'General CarePoint','fr':'CarePoint global','ar':'على مستوى CarePoint'},
  'granted': {'en':'Granted','es':'Otorgado','fr':'Accordé','ar':'ممنوح'},
  'revoked': {'en':'Revoked','es':'Revocado','fr':'Révoqué','ar':'ملغى'},
  'expired': {'en':'Expired','es':'Caducado','fr':'Expiré','ar':'منتهي الصلاحية'},
  'grantedAt': {'en':'Granted','es':'Otorgado','fr':'Accordé','ar':'تاريخ المنح'},
  'expiresAt': {'en':'Expires','es':'Caduca','fr':'Expire','ar':'ينتهي'},
  'noExpiry': {'en':'No expiry recorded','es':'Sin caducidad registrada','fr':'Aucune expiration enregistrée','ar':'لا يوجد تاريخ انتهاء مسجل'},
  'revoke': {'en':'Revoke consent','es':'Revocar consentimiento','fr':'Révoquer le consentement','ar':'إلغاء الموافقة'},
  'regrant': {'en':'Re-grant consent','es':'Volver a otorgar','fr':'Réaccorder le consentement','ar':'إعادة منح الموافقة'},
  'regrantConfirm': {'en':'Re-grant exactly this historical consent? Its scope, version, provider and remaining expiry cannot be changed here.','es':'¿Volver a otorgar exactamente este consentimiento histórico? Aquí no se pueden cambiar su alcance, versión, proveedor ni caducidad restante.','fr':'Réaccorder exactement ce consentement historique ? Sa portée, sa version, son prestataire et son expiration restante ne peuvent pas être modifiés ici.','ar':'إعادة منح هذه الموافقة التاريخية نفسها؟ لا يمكن تغيير نطاقها أو إصدارها أو مقدمها أو مدة صلاحيتها المتبقية هنا.'},
  'revokeConfirm': {'en':'Revoke this active consent? This action does not delete the historical record.','es':'¿Revocar este consentimiento activo? La acción no elimina su registro histórico.','fr':'Révoquer ce consentement actif ? Cette action ne supprime pas son historique.','ar':'إلغاء هذه الموافقة النشطة؟ لن يؤدي ذلك إلى حذف السجل التاريخي.'},
  'expiredHint': {'en':'This consent has expired. A current consent version must be presented before it can be granted again.','es':'Este consentimiento ha caducado. Debe presentarse una versión vigente antes de volver a otorgarlo.','fr':'Ce consentement a expiré. Une version actuelle doit être présentée avant de pouvoir l’accorder à nouveau.','ar':'انتهت صلاحية هذه الموافقة. يجب تقديم إصدار حالي قبل منحها مرة أخرى.'},
  'notRegrantable': {'en':'This historical consent cannot currently be re-granted.','es':'Este consentimiento histórico no puede volver a otorgarse actualmente.','fr':'Ce consentement historique ne peut pas être réaccordé actuellement.','ar':'لا يمكن إعادة منح هذه الموافقة التاريخية حالياً.'},
  'empty': {'en':'No consent history is available.','es':'No hay historial de consentimientos.','fr':'Aucun historique de consentement disponible.','ar':'لا يوجد سجل موافقات متاح.'},
  'refresh': {'en':'Refresh','es':'Actualizar','fr':'Actualiser','ar':'تحديث'},
  'confirm': {'en':'Confirm','es':'Confirmar','fr':'Confirmer','ar':'تأكيد'},
  'cancel': {'en':'Cancel','es':'Cancelar','fr':'Annuler','ar':'إلغاء'},
  'denied': {'en':'Patient consent access is required.','es':'Se requiere acceso de paciente a consentimientos.','fr':'Un accès patient aux consentements est requis.','ar':'يلزم وصول المريض إلى الموافقات.'},
};
String patientConsentText(CarePointLocale locale, String key) => patientConsentLabels[key]?[locale.name] ?? patientConsentLabels[key]?['en'] ?? key;
