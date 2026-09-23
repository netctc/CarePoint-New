import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

const dependentRelationshipTypes = <String>[
  'PARENT',
  'LEGAL_GUARDIAN',
  'CAREGIVER',
  'OTHER_AUTHORIZED_REPRESENTATIVE',
];

const dependentAuthorityScopes = <String>[
  'PROFILE_READ',
  'BOOKING_MANAGE',
  'CONSENT_MANAGE',
  'CLINICAL_READ',
  'CLINICAL_WRITE',
  'DOCUMENTS_MANAGE',
  'BILLING_MANAGE',
];

const _dependentConsentPolicies = <Map<String, String>>[
  {'scope':'CLINICAL_RECORD_READ','version':'clinical-record-v1'},
  {'scope':'HEALTH_PROFILE_READ','version':'health-profile-v1'},
  {'scope':'QUESTIONNAIRE_READ','version':'questionnaire-read-v1'},
  {'scope':'OBSERVATION_READ','version':'observation-read-v1'},
  {'scope':'CLINICAL_PROFILE_READ','version':'clinical-profile-v1'},
  {'scope':'CLINICAL_PROFILE_WRITE','version':'clinical-profile-v1'},
  {'scope':'CLINICAL_MEDIA_CAPTURE','version':'clinical-media-v1'},
];

class PatientActiveContextBanner extends StatelessWidget {
  const PatientActiveContextBanner({
    super.key,
    required this.locale,
    required this.contextData,
    required this.onOpen,
  });

  final CarePointLocale locale;
  final Map<String, dynamic> contextData;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final mode = contextData['mode']?.toString() ?? 'SELF';
    final name = contextData['patientName']?.toString().trim();
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: InkWell(
        key: const ValueKey('patient-active-context-banner'),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(children: [
            Icon(mode == 'DEPENDENT' ? Icons.family_restroom : Icons.person_outline, size: 20),
            const SizedBox(width: 8),
            Expanded(child: Text(
              '${patientDependentsText(locale, 'activePatient')}: ${name?.isNotEmpty == true ? name : patientDependentsText(locale, 'self')} · ${patientDependentsText(locale, mode)}',
              style: const TextStyle(fontWeight: FontWeight.w800),
              overflow: TextOverflow.ellipsis,
            )),
            const Icon(Icons.swap_horiz),
          ]),
        ),
      ),
    );
  }
}

class PatientDependentsPage extends StatefulWidget {
  const PatientDependentsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientDependentsPage> createState() => _PatientDependentsPageState();
}

class _PatientDependentsPageState extends State<PatientDependentsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> relations = const [];
  Map<String, dynamic> activeContext = const {};

  CarePointApi get api => widget.session.api;
  String t(String key) => patientDependentsText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final payload = await api.patientDependents();
      if (!mounted) return;
      setState(() {
        relations = _maps(payload['items']);
        activeContext = _map(payload['activeContext']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _switchSelf() async {
    try {
      await api.switchPatientContext(mode: 'SELF');
      if (mounted) Navigator.pop(context, true);
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _switchDependent(Map<String, dynamic> relation) async {
    if (relation['effective'] != true || relation['clinicalAccessEnabled'] != true) return;
    try {
      await api.switchPatientContext(
        mode: 'DEPENDENT',
        patientId: relation['dependentPatientId']?.toString(),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _editRelation([Map<String, dynamic>? existing]) async {
    final create = existing == null;
    final patientId = TextEditingController(text: existing?['dependentPatientId']?.toString() ?? '');
    String relationship = existing?['relationshipType']?.toString() ?? 'PARENT';
    final scopes = <String>{
      ..._strings(existing?['scopes']),
      if (existing == null) 'PROFILE_READ',
    };
    final validUntil = TextEditingController(text: _dateTimeInput(existing?['validUntil']));
    final evidenceType = TextEditingController(text: create ? 'LEGAL_AUTHORITY' : '');
    final evidenceReference = TextEditingController();
    String? validation;

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setLocal) => AlertDialog(
        title: Text(t(create ? 'addDependent' : 'editDependent')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(t('reviewWarning'), style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
          const SizedBox(height: 12),
          TextField(
            controller: patientId,
            enabled: create,
            decoration: InputDecoration(labelText: t('patientId'), border: const OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: relationship,
            decoration: InputDecoration(labelText: t('relationship'), border: const OutlineInputBorder()),
            items: dependentRelationshipTypes.map((value) => DropdownMenuItem(value: value, child: Text(t(value)))).toList(growable: false),
            onChanged: (value) => setLocal(() => relationship = value ?? relationship),
          ),
          const SizedBox(height: 12),
          Text(t('authorityScopes'), style: const TextStyle(fontWeight: FontWeight.w800)),
          ...dependentAuthorityScopes.map((scope) => CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            value: scopes.contains(scope),
            title: Text(t(scope)),
            onChanged: (checked) => setLocal(() {
              if (checked == true) { scopes.add(scope); } else { scopes.remove(scope); }
            }),
          )),
          TextField(
            controller: validUntil,
            decoration: InputDecoration(
              labelText: t('validUntil'),
              hintText: '2026-12-31T23:59:59Z',
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Text(t(create ? 'evidenceRequired' : 'optionalNewEvidence'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          TextField(controller: evidenceType, decoration: InputDecoration(labelText: t('evidenceType'), border: const OutlineInputBorder())),
          const SizedBox(height: 8),
          TextField(controller: evidenceReference, decoration: InputDecoration(labelText: t('evidenceReference'), border: const OutlineInputBorder())),
          if (validation != null) Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(
            onPressed: () {
              if (create && patientId.text.trim().isEmpty) {
                setLocal(() => validation = t('patientIdRequired'));
                return;
              }
              if (scopes.isEmpty) {
                setLocal(() => validation = t('scopeRequired'));
                return;
              }
              if (create && (evidenceType.text.trim().isEmpty || evidenceReference.text.trim().isEmpty)) {
                setLocal(() => validation = t('evidenceRequired'));
                return;
              }
              Navigator.pop(dialogContext, true);
            },
            child: Text(t('submitForReview')),
          ),
        ],
      )),
    );

    if (accepted == true) {
      final evidence = <Map<String, dynamic>>[];
      if (evidenceType.text.trim().isNotEmpty && evidenceReference.text.trim().isNotEmpty) {
        evidence.add({
          'evidenceType': evidenceType.text.trim().toUpperCase(),
          'referenceId': evidenceReference.text.trim(),
        });
      }
      try {
        if (create) {
          await api.requestDependentRelation(
            targetPatientId: patientId.text.trim(),
            relationshipType: relationship,
            scopes: scopes.toList(growable: false),
            validUntil: validUntil.text.trim(),
            evidence: evidence,
          );
        } else {
          await api.updateDependentRelation(
            existing['id'].toString(),
            relationshipType: relationship,
            scopes: scopes.toList(growable: false),
            validUntil: validUntil.text.trim(),
            evidence: evidence.isEmpty ? null : evidence,
          );
        }
        await _load();
      } catch (value) {
        _message(value.toString());
      }
    }

    patientId.dispose();
    validUntil.dispose();
    evidenceType.dispose();
    evidenceReference.dispose();
  }

  Future<void> _revoke(Map<String, dynamic> relation) async {
    final ok = await _confirm(t('revokeAuthority'), t('revokeAuthorityPrompt'));
    if (!ok) return;
    try {
      await api.revokeDependentRelation(relation['id'].toString());
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _consents(Map<String, dynamic> relation) async {
    final changed = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: widget.locale.textDirection,
      child: DependentConsentsPage(
        session: widget.session,
        locale: widget.locale,
        patientId: relation['dependentPatientId'].toString(),
        displayName: _dependentName(relation),
      ),
    )));
    if (changed == true) await _load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('title')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('patient-dependent-add'),
      onPressed: () => _editRelation(),
      icon: const Icon(Icons.person_add_alt_1_outlined),
      label: Text(t('addDependent')),
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                  children: [
                    Card(child: ListTile(
                      key: const ValueKey('patient-context-self'),
                      leading: const Icon(Icons.person_outline),
                      title: Text(t('self')),
                      subtitle: Text(activeContext['mode'] == 'SELF' ? t('active') : t('switchToSelf')),
                      trailing: activeContext['mode'] == 'SELF'
                          ? const Icon(Icons.check_circle)
                          : const Icon(Icons.chevron_right),
                      onTap: activeContext['mode'] == 'SELF' ? null : _switchSelf,
                    )),
                    const SizedBox(height: 8),
                    if (relations.isEmpty)
                      Padding(padding: const EdgeInsets.all(24), child: Text(t('empty'), textAlign: TextAlign.center))
                    else
                      ...relations.map(_relationCard),
                  ],
                ),
              ),
  );

  Widget _relationCard(Map<String, dynamic> relation) {
    final effective = relation['effective'] == true && relation['clinicalAccessEnabled'] == true;
    final scopes = _strings(relation['scopes']);
    final active = activeContext['mode'] == 'DEPENDENT' &&
        activeContext['patientId']?.toString() == relation['dependentPatientId']?.toString();
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(effective ? Icons.family_restroom : Icons.pending_actions_outlined),
          title: Text(_dependentName(relation), style: const TextStyle(fontWeight: FontWeight.w900)),
          subtitle: Text([
            '${t('relationship')}: ${t(relation['relationshipType']?.toString() ?? '')}',
            '${t('status')}: ${relation['status'] ?? ''}',
            if (relation['validUntil'] != null) '${t('validUntil')}: ${_dateTimeValue(relation['validUntil'])}',
          ].join('\n')),
          isThreeLine: true,
          trailing: active ? const Icon(Icons.check_circle) : null,
          onTap: effective && !active ? () => _switchDependent(relation) : null,
        ),
        Text('${t('authorityScopes')}: ${scopes.map(t).join(', ')}', style: const TextStyle(fontSize: 12)),
        if (!effective)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(t('notEffective'), style: const TextStyle(color: Color(0xFF64748B))),
          ),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          OutlinedButton.icon(
            onPressed: relation['status'] == 'REVOKED' ? null : () => _editRelation(relation),
            icon: const Icon(Icons.edit_outlined),
            label: Text(t('edit')),
          ),
          if (effective && scopes.contains('CONSENT_MANAGE'))
            OutlinedButton.icon(
              key: ValueKey('dependent-consents-${relation['id']}'),
              onPressed: () => _consents(relation),
              icon: const Icon(Icons.privacy_tip_outlined),
              label: Text(t('consents')),
            ),
          if (relation['status'] != 'REVOKED')
            TextButton.icon(
              onPressed: () => _revoke(relation),
              icon: const Icon(Icons.link_off_outlined),
              label: Text(t('revokeAuthority')),
            ),
        ]),
      ]),
    ));
  }

  String _dependentName(Map<String, dynamic> relation) {
    final dependent = _map(relation['dependent']);
    final displayName = dependent['displayName']?.toString().trim();
    if (displayName?.isNotEmpty == true) return displayName!;
    return '${t('dependent')} · ${_shortId(relation['dependentPatientId'])}';
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
        ],
      )) ?? false;

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class DependentConsentsPage extends StatefulWidget {
  const DependentConsentsPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
    required this.displayName,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;
  final String displayName;

  @override
  State<DependentConsentsPage> createState() => _DependentConsentsPageState();
}

class _DependentConsentsPageState extends State<DependentConsentsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => patientDependentsText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final payload = await api.dependentConsents(widget.patientId);
      if (mounted) setState(() => items = _maps(payload['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _grant() async {
    var preset = _dependentConsentPolicies.first;
    final providerId = TextEditingController();
    final expiresAt = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setLocal) => AlertDialog(
        title: Text(t('grantConsent')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(widget.displayName, style: const TextStyle(fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: preset['scope'],
            decoration: InputDecoration(labelText: t('consentScope'), border: const OutlineInputBorder()),
            items: _dependentConsentPolicies.map((item) => DropdownMenuItem(
              value: item['scope'],
              child: Text(item['scope']!),
            )).toList(growable: false),
            onChanged: (value) => setLocal(() => preset = _dependentConsentPolicies.firstWhere((item) => item['scope'] == value)),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: providerId,
            decoration: InputDecoration(labelText: t('providerIdOptional'), border: const OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: expiresAt,
            decoration: InputDecoration(labelText: t('expiresAtOptional'), hintText: '2026-12-31T23:59:59Z', border: const OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          Text('${t('purpose')}: TREATMENT · ${t('version')}: ${preset['version']}', style: const TextStyle(fontSize: 12)),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('grantConsent'))),
        ],
      )),
    );
    if (accepted == true) {
      try {
        await api.grantDependentConsent(
          widget.patientId,
          providerId: providerId.text.trim(),
          scope: preset['scope']!,
          version: preset['version']!,
          purpose: 'TREATMENT',
          expiresAt: expiresAt.text.trim(),
        );
        await _load();
      } catch (value) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
      }
    }
    providerId.dispose();
    expiresAt.dispose();
  }

  Future<void> _revoke(Map<String, dynamic> item) async {
    final ok = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(t('revokeConsent')),
      content: Text('${item['scope'] ?? ''}\n${t('revokeConsentIsolation')}'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('revokeConsent'))),
      ],
    )) ?? false;
    if (!ok) return;
    try {
      await api.revokeDependentConsent(widget.patientId, item['id'].toString());
      await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('${t('consents')} · ${widget.displayName}')),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('dependent-consent-grant'),
      onPressed: _grant,
      icon: const Icon(Icons.add_moderator_outlined),
      label: Text(t('grantConsent')),
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                children: [
                  Card(child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(t('consentIsolation'), style: const TextStyle(color: Color(0xFF64748B))),
                  )),
                  if (items.isEmpty)
                    Padding(padding: const EdgeInsets.all(24), child: Text(t('noConsents'), textAlign: TextAlign.center))
                  else
                    ...items.map((item) => Card(child: ListTile(
                      leading: Icon(item['state'] == 'GRANTED' ? Icons.verified_user_outlined : Icons.gpp_bad_outlined),
                      title: Text(item['scope']?.toString() ?? ''),
                      subtitle: Text([
                        '${t('state')}: ${item['state'] ?? ''}',
                        '${t('version')}: ${item['version'] ?? ''}',
                        '${t('purpose')}: ${item['purpose'] ?? ''}',
                        if (item['providerId'] != null) '${t('provider')}: ${item['providerId']}',
                        if (item['expiresAt'] != null) '${t('validUntil')}: ${_dateTimeValue(item['expiresAt'])}',
                      ].join('\n')),
                      isThreeLine: true,
                      trailing: item['state'] == 'GRANTED'
                          ? IconButton(
                              key: ValueKey('dependent-consent-revoke-${item['id']}'),
                              onPressed: () => _revoke(item),
                              tooltip: t('revokeConsent'),
                              icon: const Icon(Icons.block_outlined),
                            )
                          : null,
                    ))),
                ],
              ),
  );
}

String patientDependentsText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Family & dependents','activePatient':'Active patient','self':'Myself','SELF':'Self','DEPENDENT':'Dependent',
      'active':'Active context','switchToSelf':'Switch back to myself','addDependent':'Add dependent','editDependent':'Edit authority',
      'dependent':'Dependent','patientId':'CarePoint patient ID','patientIdRequired':'Patient ID is required.','relationship':'Relationship',
      'PARENT':'Parent','LEGAL_GUARDIAN':'Legal guardian','CAREGIVER':'Caregiver','OTHER_AUTHORIZED_REPRESENTATIVE':'Authorized representative',
      'authorityScopes':'Authority scopes','PROFILE_READ':'Profile','BOOKING_MANAGE':'Bookings','CONSENT_MANAGE':'Consents','CLINICAL_READ':'Clinical read',
      'CLINICAL_WRITE':'Clinical write','DOCUMENTS_MANAGE':'Documents','BILLING_MANAGE':'Billing','scopeRequired':'Select at least one authority scope.',
      'validUntil':'Authority valid until','evidenceRequired':'Legal-authority evidence is required.','optionalNewEvidence':'Optional new evidence reference',
      'evidenceType':'Evidence type','evidenceReference':'Evidence reference ID','submitForReview':'Submit for review','reviewWarning':'Adding or changing authority never grants clinical access immediately. Admin verification is required.',
      'status':'Status','notEffective':'Clinical access is disabled until the relationship and evidence are verified and remain valid.',
      'edit':'Edit','consents':'Dependent consents','revokeAuthority':'Revoke authority','revokeAuthorityPrompt':'This immediately clears dependent session context and cannot be used for access.',
      'grantConsent':'Grant consent','revokeConsent':'Revoke consent','consentScope':'Clinical consent scope','providerIdOptional':'Provider ID (optional)',
      'expiresAtOptional':'Consent expires at (optional)','purpose':'Purpose','version':'Version','state':'State','provider':'Provider',
      'consentIsolation':'These consents belong only to this dependent. Changes do not modify the account holder or other dependents.',
      'revokeConsentIsolation':'Only this dependent consent will be revoked.','noConsents':'No dependent consents.','empty':'No dependent relationships yet.',
      'refresh':'Refresh','cancel':'Cancel','confirm':'Confirm'
    },
    CarePointLocale.ar: {
      'title':'العائلة والتابعون','activePatient':'المريض النشط','self':'نفسي','SELF':'الحساب الأساسي','DEPENDENT':'تابع',
      'active':'السياق النشط','switchToSelf':'العودة إلى حسابي','addDependent':'إضافة تابع','editDependent':'تعديل الصلاحية',
      'dependent':'تابع','patientId':'معرّف مريض CarePoint','patientIdRequired':'معرّف المريض مطلوب.','relationship':'العلاقة',
      'PARENT':'والد/والدة','LEGAL_GUARDIAN':'وصي قانوني','CAREGIVER':'مقدّم رعاية','OTHER_AUTHORIZED_REPRESENTATIVE':'ممثل مفوض',
      'authorityScopes':'نطاقات الصلاحية','PROFILE_READ':'الملف','BOOKING_MANAGE':'المواعيد','CONSENT_MANAGE':'الموافقات','CLINICAL_READ':'قراءة سريرية',
      'CLINICAL_WRITE':'كتابة سريرية','DOCUMENTS_MANAGE':'المستندات','BILLING_MANAGE':'الفوترة','scopeRequired':'اختر نطاق صلاحية واحداً على الأقل.',
      'validUntil':'صلاحية التفويض حتى','evidenceRequired':'دليل السلطة القانونية مطلوب.','optionalNewEvidence':'مرجع دليل جديد اختياري',
      'evidenceType':'نوع الدليل','evidenceReference':'مرجع الدليل','submitForReview':'إرسال للمراجعة','reviewWarning':'إضافة أو تعديل التفويض لا يمنح وصولاً سريرياً مباشرة. يلزم تحقق الإدارة.',
      'status':'الحالة','notEffective':'الوصول السريري معطل حتى يتم التحقق من العلاقة والدليل وتبقى الصلاحية سارية.',
      'edit':'تعديل','consents':'موافقات التابع','revokeAuthority':'إلغاء التفويض','revokeAuthorityPrompt':'يؤدي ذلك فوراً إلى مسح سياق جلسة التابع ومنع استخدامه للوصول.',
      'grantConsent':'منح موافقة','revokeConsent':'إلغاء الموافقة','consentScope':'نطاق الموافقة السريرية','providerIdOptional':'معرّف مقدم الخدمة (اختياري)',
      'expiresAtOptional':'انتهاء الموافقة (اختياري)','purpose':'الغرض','version':'الإصدار','state':'الحالة','provider':'مقدم الخدمة',
      'consentIsolation':'هذه الموافقات تخص هذا التابع فقط ولا تغيّر موافقات صاحب الحساب أو التابعين الآخرين.',
      'revokeConsentIsolation':'سيتم إلغاء موافقة هذا التابع فقط.','noConsents':'لا توجد موافقات للتابع.','empty':'لا توجد علاقات تابعين بعد.',
      'refresh':'تحديث','cancel':'إلغاء','confirm':'تأكيد'
    },
    CarePointLocale.fr: {
      'title':'Famille et personnes à charge','activePatient':'Patient actif','self':'Moi-même','SELF':'Titulaire','DEPENDENT':'Personne à charge',
      'active':'Contexte actif','switchToSelf':'Revenir à mon profil','addDependent':'Ajouter une personne à charge','editDependent':'Modifier l’autorité',
      'dependent':'Personne à charge','patientId':'ID patient CarePoint','patientIdRequired':'L’ID patient est obligatoire.','relationship':'Relation',
      'PARENT':'Parent','LEGAL_GUARDIAN':'Tuteur légal','CAREGIVER':'Aidant','OTHER_AUTHORIZED_REPRESENTATIVE':'Représentant autorisé',
      'authorityScopes':'Périmètres d’autorité','PROFILE_READ':'Profil','BOOKING_MANAGE':'Rendez-vous','CONSENT_MANAGE':'Consentements','CLINICAL_READ':'Lecture clinique',
      'CLINICAL_WRITE':'Écriture clinique','DOCUMENTS_MANAGE':'Documents','BILLING_MANAGE':'Facturation','scopeRequired':'Sélectionnez au moins un périmètre.',
      'validUntil':'Autorité valable jusqu’au','evidenceRequired':'Une preuve d’autorité légale est requise.','optionalNewEvidence':'Nouvelle preuve facultative',
      'evidenceType':'Type de preuve','evidenceReference':'Référence de preuve','submitForReview':'Soumettre à vérification','reviewWarning':'Ajouter ou modifier l’autorité n’accorde jamais un accès clinique immédiat. Une vérification Admin est requise.',
      'status':'Statut','notEffective':'L’accès clinique reste désactivé tant que la relation et les preuves ne sont pas vérifiées et valides.',
      'edit':'Modifier','consents':'Consentements du dépendant','revokeAuthority':'Révoquer l’autorité','revokeAuthorityPrompt':'Cela efface immédiatement le contexte de session du dépendant et empêche son utilisation.',
      'grantConsent':'Accorder un consentement','revokeConsent':'Révoquer le consentement','consentScope':'Périmètre du consentement','providerIdOptional':'ID prestataire (facultatif)',
      'expiresAtOptional':'Expiration du consentement (facultatif)','purpose':'Finalité','version':'Version','state':'État','provider':'Prestataire',
      'consentIsolation':'Ces consentements appartiennent uniquement à cette personne à charge; les autres profils ne sont pas modifiés.',
      'revokeConsentIsolation':'Seul ce consentement du dépendant sera révoqué.','noConsents':'Aucun consentement du dépendant.','empty':'Aucune relation de dépendance.',
      'refresh':'Actualiser','cancel':'Annuler','confirm':'Confirmer'
    },
    CarePointLocale.es: {
      'title':'Familia y dependientes','activePatient':'Paciente activo','self':'Yo','SELF':'Titular','DEPENDENT':'Dependiente',
      'active':'Contexto activo','switchToSelf':'Volver a mi perfil','addDependent':'Añadir dependiente','editDependent':'Editar autoridad',
      'dependent':'Dependiente','patientId':'ID de paciente CarePoint','patientIdRequired':'El ID del paciente es obligatorio.','relationship':'Relación',
      'PARENT':'Progenitor','LEGAL_GUARDIAN':'Tutor legal','CAREGIVER':'Cuidador','OTHER_AUTHORIZED_REPRESENTATIVE':'Representante autorizado',
      'authorityScopes':'Ámbitos de autoridad','PROFILE_READ':'Perfil','BOOKING_MANAGE':'Reservas','CONSENT_MANAGE':'Consentimientos','CLINICAL_READ':'Lectura clínica',
      'CLINICAL_WRITE':'Escritura clínica','DOCUMENTS_MANAGE':'Documentos','BILLING_MANAGE':'Facturación','scopeRequired':'Selecciona al menos un ámbito.',
      'validUntil':'Autoridad válida hasta','evidenceRequired':'Se requiere evidencia de autoridad legal.','optionalNewEvidence':'Nueva evidencia opcional',
      'evidenceType':'Tipo de evidencia','evidenceReference':'Referencia de evidencia','submitForReview':'Enviar a revisión','reviewWarning':'Añadir o cambiar la autoridad nunca habilita acceso clínico inmediato. Requiere verificación de Admin.',
      'status':'Estado','notEffective':'El acceso clínico queda deshabilitado hasta verificar relación/evidencia y mientras la autoridad siga vigente.',
      'edit':'Editar','consents':'Consentimientos del dependiente','revokeAuthority':'Revocar autoridad','revokeAuthorityPrompt':'Esto elimina inmediatamente el contexto de sesión del dependiente e impide su uso para acceso.',
      'grantConsent':'Conceder consentimiento','revokeConsent':'Revocar consentimiento','consentScope':'Ámbito clínico','providerIdOptional':'ID de proveedor (opcional)',
      'expiresAtOptional':'Caducidad del consentimiento (opcional)','purpose':'Finalidad','version':'Versión','state':'Estado','provider':'Proveedor',
      'consentIsolation':'Estos consentimientos pertenecen sólo a este dependiente; no modifican al titular ni a otros dependientes.',
      'revokeConsentIsolation':'Sólo se revocará este consentimiento del dependiente.','noConsents':'No hay consentimientos del dependiente.','empty':'Todavía no hay relaciones de dependientes.',
      'refresh':'Actualizar','cancel':'Cancelar','confirm':'Confirmar'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

List<String> _strings(dynamic value) {
  if (value is! List) return const [];
  return value.whereType<String>().toList(growable: false);
}

String _shortId(dynamic value) {
  final text = value?.toString() ?? '';
  return text.length <= 12 ? text : '${text.substring(0, 8)}…';
}

String _dateTimeInput(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '');
  return parsed?.toUtc().toIso8601String() ?? '';
}

String _dateTimeValue(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
