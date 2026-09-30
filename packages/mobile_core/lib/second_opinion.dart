import 'dart:convert';

import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorSecondOpinionPage extends StatefulWidget {
  const DoctorSecondOpinionPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorSecondOpinionPage> createState() => _DoctorSecondOpinionPageState();
}

class _DoctorSecondOpinionPageState extends State<DoctorSecondOpinionPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> outgoing = const [];
  List<Map<String, dynamic>> incoming = const [];
  List<Map<String, dynamic>> destinations = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => secondOpinionText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final values = await Future.wait<dynamic>([
        api.doctorPatientSecondOpinions(widget.patientId),
        api.doctorSecondOpinionInbox(),
        api.doctorReferralDestinations(),
      ]);
      if (!mounted) return;
      setState(() {
        outgoing = _maps(_map(values[0])['items']);
        incoming = _maps(_map(values[1])['items'])
            .where((item) => item['patientId']?.toString() == widget.patientId)
            .toList(growable: false);
        destinations = _maps(_map(values[2])['items']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(t('title')),
          actions: [
            IconButton(
              onPressed: _load,
              icon: const Icon(Icons.refresh_outlined),
              tooltip: t('refresh'),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          key: const ValueKey('doctor-second-opinion-create'),
          onPressed: destinations.isEmpty ? null : _create,
          icon: const Icon(Icons.add_comment_outlined),
          label: Text(t('request')),
        ),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(error!, textAlign: TextAlign.center),
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                      children: [
                        _heading(t('incoming'), Icons.move_to_inbox_outlined),
                        if (incoming.isEmpty)
                          _empty(t('noIncoming'))
                        else
                          ...incoming.map(_incomingCard),
                        const SizedBox(height: 18),
                        _heading(t('outgoing'), Icons.outbox_outlined),
                        if (outgoing.isEmpty)
                          _empty(t('noOutgoing'))
                        else
                          ...outgoing.map(_outgoingCard),
                      ],
                    ),
                  ),
      );

  Widget _heading(String label, IconData icon) => Row(
        children: [
          Icon(icon),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
          ),
        ],
      );

  Widget _empty(String value) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            value,
            style: const TextStyle(color: Color(0xFF64748B)),
          ),
        ),
      );

  Widget _incomingCard(Map<String, dynamic> item) {
    final referral = _map(item['referral']);
    final status = referral['status']?.toString() ?? '';
    final source = _map(item['referringProvider']);
    final patient = _map(item['patient']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.medical_information_outlined),
              title: Text(
                item['question']?.toString() ?? '',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                '${t('patient')}: ${patient['displayName'] ?? item['patientId'] ?? ''}\n'
                '${t('from')}: ${source['displayName'] ?? source['id'] ?? ''}\n'
                '${t('expires')}: ${_dateTime(item['expiresAt'])}\n'
                '${t('scopes')}: ${_strings(item['scopes']).join(', ')}',
              ),
              isThreeLine: true,
            ),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text(t('sealedSnapshot')),
              subtitle: Text('${t('hash')}: ${item['snapshotHash'] ?? ''}'),
              children: [
                SelectableText(
                  const JsonEncoder.withIndent('  ').convert(item['snapshot']),
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (status == 'REQUESTED')
                  FilledButton.tonal(
                    key: ValueKey('second-opinion-accept-${item['id']}'),
                    onPressed: () => _referralAction(item, 'ACCEPT'),
                    child: Text(t('accept')),
                  ),
                if (status == 'ACCEPTED')
                  FilledButton.tonal(
                    key: ValueKey('second-opinion-start-${item['id']}'),
                    onPressed: () => _referralAction(item, 'START'),
                    child: Text(t('start')),
                  ),
                if (status == 'IN_PROGRESS')
                  FilledButton.icon(
                    key: ValueKey('second-opinion-respond-${item['id']}'),
                    onPressed: () => _respond(item),
                    icon: const Icon(Icons.rate_review_outlined),
                    label: Text(t('respond')),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _outgoingCard(Map<String, dynamic> item) {
    final destination = _map(item['destinationProvider']);
    final response = _map(item['response']);
    final responseLine = response.isEmpty
        ? t('awaiting')
        : '${t('response')}: ${response['response'] ?? ''}';
    return Card(
      child: ListTile(
        leading: const Icon(Icons.outgoing_mail),
        title: Text(
          item['question']?.toString() ?? '',
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          '${t('to')}: ${destination['displayName'] ?? destination['id'] ?? ''}\n'
          '${t('status')}: ${item['status'] ?? ''} · ${t('expires')}: ${_dateTime(item['expiresAt'])}\n'
          '$responseLine',
        ),
        isThreeLine: true,
      ),
    );
  }

  Future<void> _create() async {
    if (destinations.isEmpty) return;
    String destinationId = destinations.first['id'].toString();
    final scopes = <String>{
      'HEALTH_PROFILE_READ',
      'CLINICAL_PROFILE_READ',
    };
    final question = TextEditingController();
    int expiryDays = 7;
    String? validation;

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(t('request')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: destinationId,
                  decoration: InputDecoration(labelText: t('destination')),
                  items: destinations
                      .map(
                        (provider) => DropdownMenuItem(
                          value: provider['id'].toString(),
                          child: Text(_destinationLabel(provider)),
                        ),
                      )
                      .toList(growable: false),
                  onChanged: (value) =>
                      setLocal(() => destinationId = value ?? destinationId),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: question,
                  maxLines: 5,
                  decoration: InputDecoration(
                    labelText: t('question'),
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<int>(
                  initialValue: expiryDays,
                  decoration: InputDecoration(labelText: t('expiry')),
                  items: const [1, 3, 7, 14, 30]
                      .map(
                        (value) => DropdownMenuItem(
                          value: value,
                          child: Text('$value ${t('days')}'),
                        ),
                      )
                      .toList(growable: false),
                  onChanged: (value) =>
                      setLocal(() => expiryDays = value ?? expiryDays),
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(
                    t('scopes'),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                ...const [
                  'CLINICAL_RECORD_READ',
                  'HEALTH_PROFILE_READ',
                  'QUESTIONNAIRE_READ',
                  'OBSERVATION_READ',
                  'CLINICAL_PROFILE_READ',
                ].map(
                  (scope) => CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    value: scopes.contains(scope),
                    title: Text(scope),
                    onChanged: (checked) => setLocal(() {
                      if (checked == true) {
                        scopes.add(scope);
                      } else {
                        scopes.remove(scope);
                      }
                    }),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    t('consentHint'),
                    style: const TextStyle(color: Color(0xFF64748B)),
                  ),
                ),
                if (validation != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      validation!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(t('cancel')),
            ),
            FilledButton(
              onPressed: () {
                if (question.text.trim().isEmpty) {
                  setLocal(() => validation = t('questionRequired'));
                  return;
                }
                if (scopes.isEmpty) {
                  setLocal(() => validation = t('scopeRequired'));
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              child: Text(t('create')),
            ),
          ],
        ),
      ),
    );

    if (accepted == true) {
      try {
        await api.createDoctorSecondOpinion(widget.patientId, {
          'destinationProviderId': destinationId,
          'scopes': scopes.toList(growable: false),
          'question': question.text.trim(),
          'expiresAt': DateTime.now()
              .toUtc()
              .add(Duration(days: expiryDays))
              .toIso8601String(),
          'idempotencyKey':
              'mobile-second-opinion-${DateTime.now().microsecondsSinceEpoch}',
        });
        await _load();
      } catch (value) {
        _message(value.toString());
      }
    }
    question.dispose();
  }

  Future<void> _referralAction(
    Map<String, dynamic> item,
    String action,
  ) async {
    final referral = _map(item['referral']);
    final referralId = referral['id']?.toString();
    if (referralId == null || referralId.isEmpty) return;
    final ok = await _confirm(
      action == 'ACCEPT' ? t('accept') : t('start'),
      action == 'ACCEPT' ? t('acceptPrompt') : t('startPrompt'),
    );
    if (!ok) return;
    try {
      await api.actDoctorReferral(referralId, {
        'action': action,
        'expectedVersion': _int(referral['version'], 1),
      });
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _respond(Map<String, dynamic> item) async {
    final controller = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(t('respond')),
        content: TextField(
          controller: controller,
          maxLines: 8,
          decoration: InputDecoration(
            labelText: t('response'),
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(t('cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(
              dialogContext,
              controller.text.trim().isNotEmpty,
            ),
            child: Text(t('submit')),
          ),
        ],
      ),
    );
    final response = controller.text.trim();
    controller.dispose();
    if (accepted != true || response.isEmpty) return;
    try {
      await api.respondDoctorSecondOpinion(item['id'].toString(), response);
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(t('cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(t('confirm')),
            ),
          ],
        ),
      ) ??
      false;

  String _destinationLabel(Map<String, dynamic> provider) {
    final specialties = _maps(provider['specialties']);
    final primary = specialties
        .where((item) => item['primary'] == true)
        .map((item) => item['code']?.toString())
        .whereType<String>()
        .firstOrNull;
    final name = provider['displayName']?.toString().trim();
    return '${name?.isNotEmpty == true ? name : provider['id']}'
        '${primary == null ? '' : ' · $primary'}';
  }

  void _message(String value) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(value)),
      );
    }
  }
}

String secondOpinionText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title': 'Second opinion',
      'request': 'Request second opinion',
      'incoming': 'Incoming requests',
      'outgoing': 'Requested opinions',
      'noIncoming': 'No second-opinion requests for this patient.',
      'noOutgoing': 'No second opinion has been requested for this patient.',
      'refresh': 'Refresh',
      'patient': 'Patient',
      'from': 'From',
      'to': 'To',
      'destination': 'Destination Doctor',
      'question': 'Clinical question',
      'expires': 'Expires',
      'expiry': 'Expiry',
      'days': 'days',
      'scopes': 'Explicitly consented scopes',
      'sealedSnapshot': 'Immutable clinical snapshot',
      'hash': 'Snapshot hash',
      'status': 'Status',
      'awaiting': 'Awaiting response',
      'response': 'Response',
      'respond': 'Write response',
      'accept': 'Accept',
      'start': 'Start review',
      'submit': 'Submit response',
      'create': 'Create request',
      'cancel': 'Cancel',
      'confirm': 'Confirm',
      'scopeRequired': 'Select at least one clinical read scope.',
      'questionRequired': 'Enter the clinical question.',
      'consentHint': 'The patient must already have active provider-specific consent for the destination Doctor and every selected scope.',
      'acceptPrompt': 'Accept the linked care-coordination referral for this second opinion?',
      'startPrompt': 'Start review of the immutable snapshot?',
    },
    CarePointLocale.ar: {
      'title': 'رأي طبي ثانٍ',
      'request': 'طلب رأي ثانٍ',
      'incoming': 'طلبات واردة',
      'outgoing': 'الآراء المطلوبة',
      'noIncoming': 'لا توجد طلبات رأي ثانٍ لهذا المريض.',
      'noOutgoing': 'لم يتم طلب رأي ثانٍ لهذا المريض.',
      'refresh': 'تحديث',
      'patient': 'المريض',
      'from': 'من',
      'to': 'إلى',
      'destination': 'الطبيب المستلم',
      'question': 'السؤال السريري',
      'expires': 'ينتهي',
      'expiry': 'مدة الصلاحية',
      'days': 'أيام',
      'scopes': 'النطاقات ذات الموافقة الصريحة',
      'sealedSnapshot': 'لقطة سريرية ثابتة',
      'hash': 'بصمة اللقطة',
      'status': 'الحالة',
      'awaiting': 'بانتظار الرد',
      'response': 'الرد',
      'respond': 'كتابة الرد',
      'accept': 'قبول',
      'start': 'بدء المراجعة',
      'submit': 'إرسال الرد',
      'create': 'إنشاء الطلب',
      'cancel': 'إلغاء',
      'confirm': 'تأكيد',
      'scopeRequired': 'اختر نطاق قراءة سريرياً واحداً على الأقل.',
      'questionRequired': 'أدخل السؤال السريري.',
      'consentHint': 'يجب أن تكون للمريض موافقة فعالة ومحددة للطبيب المستلم ولكل نطاق مختار.',
      'acceptPrompt': 'قبول إحالة التنسيق المرتبطة بطلب الرأي الثاني؟',
      'startPrompt': 'بدء مراجعة اللقطة السريرية الثابتة؟',
    },
    CarePointLocale.fr: {
      'title': 'Deuxième avis',
      'request': 'Demander un deuxième avis',
      'incoming': 'Demandes reçues',
      'outgoing': 'Avis demandés',
      'noIncoming': 'Aucune demande de deuxième avis pour ce patient.',
      'noOutgoing': 'Aucun deuxième avis demandé pour ce patient.',
      'refresh': 'Actualiser',
      'patient': 'Patient',
      'from': 'De',
      'to': 'Vers',
      'destination': 'Médecin destinataire',
      'question': 'Question clinique',
      'expires': 'Expire',
      'expiry': 'Expiration',
      'days': 'jours',
      'scopes': 'Périmètres avec consentement explicite',
      'sealedSnapshot': 'Instantané clinique immuable',
      'hash': 'Empreinte',
      'status': 'Statut',
      'awaiting': 'En attente de réponse',
      'response': 'Réponse',
      'respond': 'Rédiger la réponse',
      'accept': 'Accepter',
      'start': 'Démarrer la revue',
      'submit': 'Envoyer la réponse',
      'create': 'Créer la demande',
      'cancel': 'Annuler',
      'confirm': 'Confirmer',
      'scopeRequired': 'Sélectionnez au moins un périmètre clinique de lecture.',
      'questionRequired': 'Saisissez la question clinique.',
      'consentHint': 'Le patient doit avoir un consentement actif spécifique au médecin destinataire pour chaque périmètre sélectionné.',
      'acceptPrompt': 'Accepter l’orientation de coordination liée à ce deuxième avis ?',
      'startPrompt': 'Commencer la revue de l’instantané clinique immuable ?',
    },
    CarePointLocale.es: {
      'title': 'Segunda opinión',
      'request': 'Solicitar segunda opinión',
      'incoming': 'Solicitudes recibidas',
      'outgoing': 'Opiniones solicitadas',
      'noIncoming': 'No hay solicitudes de segunda opinión para este paciente.',
      'noOutgoing': 'No se ha solicitado una segunda opinión para este paciente.',
      'refresh': 'Actualizar',
      'patient': 'Paciente',
      'from': 'De',
      'to': 'A',
      'destination': 'Médico destinatario',
      'question': 'Pregunta clínica',
      'expires': 'Caduca',
      'expiry': 'Caducidad',
      'days': 'días',
      'scopes': 'Ámbitos con consentimiento explícito',
      'sealedSnapshot': 'Snapshot clínico inmutable',
      'hash': 'Hash del snapshot',
      'status': 'Estado',
      'awaiting': 'Pendiente de respuesta',
      'response': 'Respuesta',
      'respond': 'Escribir respuesta',
      'accept': 'Aceptar',
      'start': 'Iniciar revisión',
      'submit': 'Enviar respuesta',
      'create': 'Crear solicitud',
      'cancel': 'Cancelar',
      'confirm': 'Confirmar',
      'scopeRequired': 'Selecciona al menos un ámbito clínico de lectura.',
      'questionRequired': 'Introduce la pregunta clínica.',
      'consentHint': 'El paciente debe tener consentimiento activo específico para el médico destinatario y para cada ámbito seleccionado.',
      'acceptPrompt': '¿Aceptar la derivación de coordinación vinculada a esta segunda opinión?',
      'startPrompt': '¿Iniciar la revisión del snapshot clínico inmutable?',
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
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

int _int(dynamic value, int fallback) =>
    value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;

String _dateTime(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '');
  return parsed == null
      ? '—'
      : parsed.toLocal().toString().substring(0, 16);
}

extension _SecondOpinionFirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
