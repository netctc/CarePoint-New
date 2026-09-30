import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String emergencyAccessText(CarePointLocale locale, String key) =>
    _copy[locale]?[key] ?? _copy[CarePointLocale.en]?[key] ?? key;

class EmergencyAccessPage extends StatefulWidget {
  const EmergencyAccessPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<EmergencyAccessPage> createState() => _EmergencyAccessPageState();
}

class _EmergencyAccessPageState extends State<EmergencyAccessPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];
  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;

  @override
  void initState() { super.initState(); refresh(); }

  Future<void> refresh() async {
    setState(() { busy = true; error = null; });
    try {
      final payload = await api.providerEmergencyAccess();
      if (mounted) setState(() => items = _list(payload['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(emergencyAccessText(locale, 'title')), actions: [
      IconButton(onPressed: busy ? null : refresh, icon: const Icon(Icons.refresh)),
    ]),
    body: busy && items.isEmpty ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
      onRefresh: refresh,
      child: ListView(padding: const EdgeInsets.fromLTRB(16,16,16,100), children: [
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.policy_outlined, color: Colors.orangeAccent), const SizedBox(width: 10),
          Expanded(child: Text(emergencyAccessText(locale, 'warning'))),
        ]))),
        if (error != null) Card(child: Padding(padding: const EdgeInsets.all(14), child: Text(error!, style: const TextStyle(color: Colors.redAccent)))),
        if (items.isEmpty) Padding(padding: const EdgeInsets.all(28), child: Text(emergencyAccessText(locale, 'empty'), textAlign: TextAlign.center))
        else ...items.map(_grantCard),
      ]),
    ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: busy ? null : _request,
      icon: const Icon(Icons.emergency_outlined),
      label: Text(emergencyAccessText(locale, 'request')),
    ),
  );

  Widget _grantCard(Map<String, dynamic> grant) {
    final active = grant['status']?.toString() == 'ACTIVE';
    final scope = grant['scope']?.toString() ?? '';
    return Card(child: Padding(padding: const EdgeInsets.all(15), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: Text(scope.replaceAll('_',' '), style: const TextStyle(fontWeight: FontWeight.w800))),
        Chip(label: Text(grant['status']?.toString() ?? '—')),
      ]),
      Text(emergencyAccessText(locale,'patient') + ': ' + (grant['patientId']?.toString() ?? '—')),
      Text(emergencyAccessText(locale,'reason') + ': ' + (grant['reasonCode']?.toString() ?? '—')),
      Text(emergencyAccessText(locale,'expires') + ': ' + _dateTime(grant['expiresAt'])),
      Text(emergencyAccessText(locale,'review') + ': ' + (grant['reviewStatus']?.toString() ?? '—')),
      if (active) ...[
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (scope == 'CLINICAL_PROFILE_READ') OutlinedButton.icon(
            onPressed: () => _openClinicalProfile(grant['id']?.toString() ?? ''),
            icon: const Icon(Icons.medical_information_outlined),
            label: Text(emergencyAccessText(locale,'openProfile')),
          ),
          OutlinedButton.icon(
            onPressed: () => _revoke(grant['id']?.toString() ?? ''),
            icon: const Icon(Icons.block_outlined),
            label: Text(emergencyAccessText(locale,'revoke')),
          ),
        ]),
      ],
    ])));
  }

  Future<void> _request() async {
    final patient = TextEditingController();
    var scope = 'CLINICAL_PROFILE_READ';
    var reason = 'LIFE_THREATENING_EMERGENCY';
    var ttl = 30;
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setDialogState) => AlertDialog(
        title: Text(emergencyAccessText(locale,'request')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: patient, decoration: InputDecoration(labelText: emergencyAccessText(locale,'patientId'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: scope,
            decoration: InputDecoration(labelText: emergencyAccessText(locale,'scope'), border: const OutlineInputBorder()),
            items: _scopes.map((v) => DropdownMenuItem(value: v, child: Text(v.replaceAll('_',' ')))).toList(),
            onChanged: (v) => setDialogState(() => scope = v ?? scope),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: reason,
            decoration: InputDecoration(labelText: emergencyAccessText(locale,'reason'), border: const OutlineInputBorder()),
            items: _reasons.map((v) => DropdownMenuItem(value: v, child: Text(v.replaceAll('_',' ')))).toList(),
            onChanged: (v) => setDialogState(() => reason = v ?? reason),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<int>(
            initialValue: ttl,
            decoration: InputDecoration(labelText: emergencyAccessText(locale,'ttl'), border: const OutlineInputBorder()),
            items: const [5,15,30,45,60].map((v) => DropdownMenuItem(value: v, child: Text(v.toString() + ' min'))).toList(),
            onChanged: (v) => setDialogState(() => ttl = v ?? ttl),
          ),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext,false), child: Text(emergencyAccessText(locale,'cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext,true), child: Text(emergencyAccessText(locale,'request'))),
        ],
      ),
    ));
    final patientId = patient.text.trim();
    patient.dispose();
    if (accepted != true || patientId.isEmpty) return;
    setState(() => busy = true);
    try {
      await api.createEmergencyAccess(
        patientId: patientId,
        scope: scope,
        reasonCode: reason,
        ttlMinutes: ttl,
        idempotencyKey: 'doctor-break-glass-' + DateTime.now().microsecondsSinceEpoch.toString(),
      );
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(emergencyAccessText(locale,'granted'))));
      await refresh();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _revoke(String id) async {
    if (id.isEmpty) return;
    final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(emergencyAccessText(locale,'revoke')),
      content: Text(emergencyAccessText(locale,'revokeConfirm')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext,false), child: Text(emergencyAccessText(locale,'cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext,true), child: Text(emergencyAccessText(locale,'revoke'))),
      ],
    ));
    if (confirmed != true) return;
    try { await api.revokeEmergencyAccess(id); await refresh(); }
    catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); }
  }

  Future<void> _openClinicalProfile(String id) async {
    if (id.isEmpty) return;
    try {
      final payload = await api.emergencyClinicalProfile(id);
      if (!mounted) return;
      final rows = _list(payload['items']);
      await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (sheetContext) => Directionality(
        textDirection: locale.textDirection,
        child: SafeArea(child: FractionallySizedBox(heightFactor: .82, child: Column(children: [
          ListTile(
            title: Text(emergencyAccessText(locale,'profileTitle'), style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: Text('BREAK_GLASS · ' + (payload['patientId']?.toString() ?? '')),
            trailing: IconButton(onPressed: () => Navigator.pop(sheetContext), icon: const Icon(Icons.close)),
          ),
          Expanded(child: rows.isEmpty ? Center(child: Text(emergencyAccessText(locale,'noProfile'))) : ListView.builder(
            itemCount: rows.length,
            itemBuilder: (_, index) {
              final row = rows[index];
              return ListTile(
                title: Text(row['kind']?.toString() ?? 'Clinical profile'),
                subtitle: Text((row['status']?.toString() ?? '') + ' · v' + (row['version']?.toString() ?? '') + '\n' + _summary(row['data'])),
                isThreeLine: true,
              );
            },
          )),
        ]))),
      ));
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  String _summary(dynamic value) {
    final map = _map(value);
    if (map.isEmpty) return emergencyAccessText(locale,'protected');
    return map.entries.take(4).map((e) => e.key + ': ' + e.value.toString()).join(' · ');
  }

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int n) => n.toString().padLeft(2,'0');
    return value.year.toString() + '-' + two(value.month) + '-' + two(value.day) + ' ' + two(value.hour) + ':' + two(value.minute);
  }
}

const _scopes = <String>[
  'CLINICAL_PROFILE_READ','CLINICAL_RECORD_READ','CLINICAL_HEALTH_PROFILE_READ','CLINICAL_QUESTIONNAIRE_READ',
  'CLINICAL_OBSERVATION_READ','CLINICAL_PATIENT_SNAPSHOT_READ','CLINICAL_ORDER_READ','CLINICAL_DOCUMENT_READ','CLINICAL_MEDIA_READ',
];
const _reasons = <String>[
  'LIFE_THREATENING_EMERGENCY','UNCONSCIOUS_OR_UNABLE_TO_CONSENT','EMERGENCY_TRANSFER','CRITICAL_INFORMATION_REQUIRED',
];

const Map<CarePointLocale, Map<String,String>> _copy = {
  CarePointLocale.en: {'title':'Emergency access','request':'Request break-glass','warning':'Emergency access is temporary, MFA-assured, audited and reviewed by governance. Use only when legally and clinically justified.','empty':'No emergency-access grants.','patient':'Patient','patientId':'Patient ID','scope':'Access scope','reason':'Reason','ttl':'Duration','expires':'Expires','review':'Review','revoke':'Revoke','revokeConfirm':'Revoke this emergency-access grant now?','openProfile':'Open clinical profile','profileTitle':'Emergency clinical profile','noProfile':'No profile entries.','protected':'Protected structured content','granted':'Emergency access granted.','cancel':'Cancel'},
  CarePointLocale.ar: {'title':'الوصول الطارئ','request':'طلب وصول استثنائي','warning':'الوصول الطارئ مؤقت ويتطلب MFA ويخضع للتدقيق والمراجعة. استخدمه فقط عند وجود مبرر قانوني وسريري.','empty':'لا توجد صلاحيات وصول طارئ.','patient':'المريض','patientId':'معرف المريض','scope':'نطاق الوصول','reason':'السبب','ttl':'المدة','expires':'ينتهي','review':'المراجعة','revoke':'إلغاء الصلاحية','revokeConfirm':'إلغاء صلاحية الوصول الطارئ الآن؟','openProfile':'فتح الملف السريري','profileTitle':'الملف السريري الطارئ','noProfile':'لا توجد عناصر في الملف.','protected':'محتوى منظم محمي','granted':'تم منح الوصول الطارئ.','cancel':'إلغاء'},
  CarePointLocale.fr: {'title':'Accès d’urgence','request':'Demander break-glass','warning':'L’accès d’urgence est temporaire, protégé par MFA, audité et revu par la gouvernance. À utiliser uniquement avec justification légale et clinique.','empty':'Aucun accès d’urgence.','patient':'Patient','patientId':'ID patient','scope':'Périmètre','reason':'Motif','ttl':'Durée','expires':'Expire','review':'Revue','revoke':'Révoquer','revokeConfirm':'Révoquer cet accès d’urgence maintenant ?','openProfile':'Ouvrir le profil clinique','profileTitle':'Profil clinique d’urgence','noProfile':'Aucune entrée de profil.','protected':'Contenu structuré protégé','granted':'Accès d’urgence accordé.','cancel':'Annuler'},
  CarePointLocale.es: {'title':'Acceso de emergencia','request':'Solicitar break-glass','warning':'El acceso de emergencia es temporal, requiere MFA, queda auditado y es revisado por gobernanza. Úsalo solo con justificación legal y clínica.','empty':'No hay accesos de emergencia.','patient':'Paciente','patientId':'ID del paciente','scope':'Ámbito','reason':'Motivo','ttl':'Duración','expires':'Expira','review':'Revisión','revoke':'Revocar','revokeConfirm':'¿Revocar este acceso de emergencia ahora?','openProfile':'Abrir perfil clínico','profileTitle':'Perfil clínico de emergencia','noProfile':'No hay entradas de perfil.','protected':'Contenido estructurado protegido','granted':'Acceso de emergencia concedido.','cancel':'Cancelar'},
};

Map<String,dynamic> _map(dynamic value) {
  if (value is Map<String,dynamic>) return value;
  if (value is Map) return value.map((key,item) => MapEntry(key.toString(),item));
  return <String,dynamic>{};
}
List<Map<String,dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable:false);
}
