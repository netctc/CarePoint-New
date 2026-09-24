import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'patient_clinical_export_api.dart';
import 'secure_share_qr.dart';

const patientClinicalShareScopes = <String>[
  'OBSERVATIONS',
  'MEDICATIONS',
  'DEVICES',
  'QUESTIONNAIRE',
  'CARE_PLAN',
];

class PatientTemporaryClinicalSharePage extends StatefulWidget {
  const PatientTemporaryClinicalSharePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientTemporaryClinicalSharePage> createState() => _PatientTemporaryClinicalSharePageState();
}

class _PatientTemporaryClinicalSharePageState extends State<PatientTemporaryClinicalSharePage> {
  late final PatientClinicalExportApi shareApi = PatientClinicalExportApi(widget.session.api);
  bool busy = false;
  String? error;
  String scope = 'OBSERVATIONS';
  int ttlMinutes = 15;
  List<Map<String, dynamic>> shares = const [];
  Map<String, dynamic>? activeShare;

  String t(String key) => patientClinicalShareText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { busy = true; error = null; });
    try {
      final result = await shareApi.temporaryShares();
      if (mounted) setState(() => shares = _maps(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _create() async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(t('confirmTitle')),
        content: Text(t('confirmBody')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('create'))),
        ],
      ),
    );
    if (accepted != true) return;

    setState(() { busy = true; error = null; activeShare = null; });
    try {
      final created = await shareApi.createTemporaryShare(scope: scope, ttlMinutes: ttlMinutes);
      final url = created['shareUrl']?.toString() ?? '';
      if (url.isEmpty) throw const CarePointApiException('Temporary share URL is missing.');
      if (url.codeUnits.length > 271) {
        throw const CarePointApiException('Configured API URL is too long for the local QR encoder.');
      }
      if (mounted) {
        setState(() => activeShare = created);
        await _load();
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _revoke(String id) async {
    setState(() { busy = true; error = null; });
    try {
      await shareApi.revokeTemporaryShare(id);
      if (activeShare?['id']?.toString() == id) activeShare = null;
      await _load();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _copyLink() async {
    final url = activeShare?['shareUrl']?.toString();
    if (url == null || url.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: url));
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('copied'))));
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: widget.locale.textDirection,
    child: Scaffold(
      key: const ValueKey('patient-temporary-clinical-share-page'),
      appBar: AppBar(
        title: Text(t('title')),
        actions: [IconButton(onPressed: busy ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(t('intro')),
          const SizedBox(height: 12),
          Card(child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              DropdownButtonFormField<String>(
                key: const ValueKey('patient-clinical-share-scope'),
                initialValue: scope,
                decoration: InputDecoration(labelText: t('scope'), border: const OutlineInputBorder()),
                items: patientClinicalShareScopes.map((value) => DropdownMenuItem(
                  value: value,
                  child: Text(t('scope.$value')),
                )).toList(growable: false),
                onChanged: busy ? null : (value) => setState(() => scope = value ?? scope),
              ),
              const SizedBox(height: 12),
              SegmentedButton<int>(
                key: const ValueKey('patient-clinical-share-ttl'),
                segments: const [
                  ButtonSegment(value: 15, label: Text('15 min')),
                  ButtonSegment(value: 30, label: Text('30 min')),
                  ButtonSegment(value: 60, label: Text('60 min')),
                ],
                selected: {ttlMinutes},
                onSelectionChanged: busy ? null : (values) => setState(() => ttlMinutes = values.first),
              ),
              const SizedBox(height: 12),
              Text(t('warning'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const ValueKey('patient-clinical-share-create'),
                onPressed: busy ? null : _create,
                icon: const Icon(Icons.qr_code_2_outlined),
                label: Text(t('create')),
              ),
            ]),
          )),
          if (busy) ...[
            const SizedBox(height: 12),
            const LinearProgressIndicator(),
          ],
          if (error != null) ...[
            const SizedBox(height: 12),
            Card(
              color: Theme.of(context).colorScheme.errorContainer,
              child: Padding(padding: const EdgeInsets.all(16), child: Text(error!)),
            ),
          ],
          if (activeShare != null) ...[
            const SizedBox(height: 16),
            _activeShareCard(),
          ],
          const SizedBox(height: 20),
          Text(t('activeLinks'), style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (shares.isEmpty)
            Text(t('none'))
          else
            ...shares.map(_shareCard),
        ],
      ),
    ),
  );

  Widget _activeShareCard() {
    final url = activeShare!['shareUrl'].toString();
    return Card(
      key: const ValueKey('patient-clinical-share-created'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(t('created'), style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(t('oneTimeHint')),
          const SizedBox(height: 12),
          Center(child: CarePointSecureShareQr(data: url)),
          const SizedBox(height: 12),
          SelectableText(url, key: const ValueKey('patient-clinical-share-url')),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            key: const ValueKey('patient-clinical-share-copy'),
            onPressed: _copyLink,
            icon: const Icon(Icons.copy_outlined),
            label: Text(t('copy')),
          ),
          TextButton.icon(
            key: const ValueKey('patient-clinical-share-clear-token'),
            onPressed: () => setState(() => activeShare = null),
            icon: const Icon(Icons.visibility_off_outlined),
            label: Text(t('clear')),
          ),
        ]),
      ),
    );
  }

  Widget _shareCard(Map<String, dynamic> item) {
    final active = item['active'] == true;
    return Card(child: ListTile(
      leading: Icon(active ? Icons.link_outlined : Icons.link_off_outlined),
      title: Text(t('scope.${item['scope'] ?? ''}')),
      subtitle: Text(
        '${t('expires')}: ${_date(item['expiresAt'])}\n'
        '${t('accesses')}: ${item['accessCount'] ?? 0}',
      ),
      isThreeLine: true,
      trailing: active
          ? IconButton(
              key: ValueKey('patient-clinical-share-revoke-${item['id']}'),
              tooltip: t('revoke'),
              onPressed: busy ? null : () => _revoke(item['id'].toString()),
              icon: const Icon(Icons.block_outlined),
            )
          : null,
    ));
  }

  String _date(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null ? '—' : parsed.toLocal().toString();
  }
}

String patientClinicalShareText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Temporary secure share','intro':'Share exactly one clinical summary section through a short-lived, revocable link or QR code.',
      'scope':'Shared section','scope.OBSERVATIONS':'Recent observations','scope.MEDICATIONS':'Active medications','scope.DEVICES':'Implanted devices','scope.QUESTIONNAIRE':'Questionnaire status','scope.CARE_PLAN':'Active care plan',
      'warning':'Anyone holding the link or QR can read this selected section until it expires or you revoke it. Do not post it publicly.',
      'confirmTitle':'Create temporary share?','confirmBody':'The link is a temporary bearer credential. The raw token is shown only once and is not stored by CarePoint.',
      'create':'Create link + QR','cancel':'Cancel','refresh':'Refresh','created':'Secure share created','oneTimeHint':'Copy or scan it now. CarePoint stores only a hash of the bearer token and cannot show the same link again.',
      'copy':'Copy secure link','copied':'Secure link copied.','clear':'Hide this link from screen','activeLinks':'Recent shares','none':'No temporary shares for the active patient.',
      'expires':'Expires','accesses':'Accesses','revoke':'Revoke now'
    },
    CarePointLocale.ar: {
      'title':'مشاركة مؤقتة آمنة','intro':'شارك قسماً واحداً فقط من الملخص السريري عبر رابط أو رمز QR قصير المدة وقابل للإلغاء.',
      'scope':'القسم المشترك','scope.OBSERVATIONS':'القياسات الحديثة','scope.MEDICATIONS':'الأدوية النشطة','scope.DEVICES':'الأجهزة المزروعة','scope.QUESTIONNAIRE':'حالة الاستبيان','scope.CARE_PLAN':'خطة الرعاية النشطة',
      'warning':'يمكن لأي شخص يملك الرابط أو رمز QR قراءة القسم المحدد حتى انتهاء الصلاحية أو الإلغاء. لا تنشره علناً.',
      'confirmTitle':'إنشاء مشاركة مؤقتة؟','confirmBody':'الرابط بيانات اعتماد مؤقتة لحامله. يظهر الرمز الخام مرة واحدة فقط ولا يخزنه CarePoint.',
      'create':'إنشاء رابط + QR','cancel':'إلغاء','refresh':'تحديث','created':'تم إنشاء المشاركة الآمنة','oneTimeHint':'انسخه أو امسحه الآن. يخزن CarePoint بصمة الرمز فقط ولا يستطيع إظهار الرابط نفسه مرة أخرى.',
      'copy':'نسخ الرابط الآمن','copied':'تم نسخ الرابط الآمن.','clear':'إخفاء الرابط من الشاشة','activeLinks':'المشاركات الأخيرة','none':'لا توجد مشاركات مؤقتة للمريض النشط.',
      'expires':'ينتهي','accesses':'مرات الوصول','revoke':'إلغاء الآن'
    },
    CarePointLocale.fr: {
      'title':'Partage sécurisé temporaire','intro':'Partagez une seule section du résumé clinique via un lien ou QR court et révocable.',
      'scope':'Section partagée','scope.OBSERVATIONS':'Observations récentes','scope.MEDICATIONS':'Médicaments actifs','scope.DEVICES':'Dispositifs implantés','scope.QUESTIONNAIRE':'État du questionnaire','scope.CARE_PLAN':'Plan de soins actif',
      'warning':'Toute personne possédant le lien ou QR peut lire la section sélectionnée jusqu’à expiration ou révocation. Ne le publiez pas.',
      'confirmTitle':'Créer un partage temporaire ?','confirmBody':'Le lien est un justificatif bearer temporaire. Le jeton brut n’est affiché qu’une fois et n’est pas stocké par CarePoint.',
      'create':'Créer lien + QR','cancel':'Annuler','refresh':'Actualiser','created':'Partage sécurisé créé','oneTimeHint':'Copiez ou scannez-le maintenant. CarePoint ne stocke que l’empreinte du jeton et ne peut pas réafficher le même lien.',
      'copy':'Copier le lien sécurisé','copied':'Lien sécurisé copié.','clear':'Masquer ce lien','activeLinks':'Partages récents','none':'Aucun partage temporaire pour le patient actif.',
      'expires':'Expire','accesses':'Accès','revoke':'Révoquer'
    },
    CarePointLocale.es: {
      'title':'Compartir temporalmente','intro':'Comparte exactamente una sección del resumen clínico mediante enlace o QR temporal y revocable.',
      'scope':'Sección compartida','scope.OBSERVATIONS':'Observaciones recientes','scope.MEDICATIONS':'Medicación activa','scope.DEVICES':'Dispositivos implantados','scope.QUESTIONNAIRE':'Estado del cuestionario','scope.CARE_PLAN':'Plan de cuidados activo',
      'warning':'Cualquier persona con el enlace o QR puede leer la sección elegida hasta que caduque o la revoques. No lo publiques.',
      'confirmTitle':'¿Crear acceso temporal?','confirmBody':'El enlace es una credencial bearer temporal. El token bruto se muestra una sola vez y CarePoint no lo almacena.',
      'create':'Crear enlace + QR','cancel':'Cancelar','refresh':'Actualizar','created':'Acceso seguro creado','oneTimeHint':'Cópialo o escanéalo ahora. CarePoint guarda sólo el hash del token y no puede volver a mostrar el mismo enlace.',
      'copy':'Copiar enlace seguro','copied':'Enlace seguro copiado.','clear':'Ocultar este enlace','activeLinks':'Compartidos recientes','none':'No hay enlaces temporales para el paciente activo.',
      'expires':'Caduca','accesses':'Accesos','revoke':'Revocar ahora'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map((item) => item is Map<String, dynamic>
      ? item
      : item is Map
          ? item.map((key, value) => MapEntry(key.toString(), value))
          : <String, dynamic>{}).toList(growable: false);
}
