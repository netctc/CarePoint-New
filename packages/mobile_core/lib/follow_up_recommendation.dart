import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String followUpText(CarePointLocale locale, String key) =>
    _labels[locale.name]?[key] ?? _labels['en']?[key] ?? key;

const _labels = <String, Map<String, String>>{
  'en': {
    'title': 'Follow-up recommendation', 'newRecommendation': 'Recommend follow-up',
    'type': 'Recommendation type', 'date': 'Recommended date', 'rationale': 'Reason',
    'instructions': 'Patient instructions', 'save': 'Send recommendation', 'cancel': 'Cancel',
    'saved': 'Follow-up recommendation sent to the patient.', 'empty': 'No follow-up recommendations yet.',
    'notice': 'This is a recommendation only. It does not create a clinical order or book an appointment automatically.',
    'booking': 'The patient must book separately if a new appointment is needed.',
    'FOLLOW_UP_VISIT': 'Follow-up visit', 'PRIMARY_CARE_REVIEW': 'Primary care review',
    'SPECIALIST_REVIEW': 'Specialist review', 'CARE_REVIEW': 'Care review', 'OTHER': 'Other follow-up',
  },
  'ar': {
    'title': 'توصية بالمتابعة', 'newRecommendation': 'اقتراح متابعة',
    'type': 'نوع التوصية', 'date': 'التاريخ المقترح', 'rationale': 'السبب',
    'instructions': 'تعليمات للمريض', 'save': 'إرسال التوصية', 'cancel': 'إلغاء',
    'saved': 'تم إرسال توصية المتابعة إلى المريض.', 'empty': 'لا توجد توصيات متابعة بعد.',
    'notice': 'هذه توصية فقط. لا تنشئ أمراً طبياً ولا تحجز موعداً تلقائياً.',
    'booking': 'يجب على المريض الحجز بشكل منفصل إذا كانت هناك حاجة إلى موعد جديد.',
    'FOLLOW_UP_VISIT': 'زيارة متابعة', 'PRIMARY_CARE_REVIEW': 'مراجعة الرعاية الأولية',
    'SPECIALIST_REVIEW': 'مراجعة اختصاصي', 'CARE_REVIEW': 'مراجعة الرعاية', 'OTHER': 'متابعة أخرى',
  },
  'fr': {
    'title': 'Recommandation de suivi', 'newRecommendation': 'Recommander un suivi',
    'type': 'Type de recommandation', 'date': 'Date recommandée', 'rationale': 'Motif',
    'instructions': 'Instructions au patient', 'save': 'Envoyer la recommandation', 'cancel': 'Annuler',
    'saved': 'Recommandation de suivi envoyée au patient.', 'empty': 'Aucune recommandation de suivi.',
    'notice': 'Il s’agit uniquement d’une recommandation. Elle ne crée pas d’ordonnance clinique ni de rendez-vous automatique.',
    'booking': 'Le patient doit réserver séparément si un nouveau rendez-vous est nécessaire.',
    'FOLLOW_UP_VISIT': 'Visite de suivi', 'PRIMARY_CARE_REVIEW': 'Suivi en soins primaires',
    'SPECIALIST_REVIEW': 'Avis spécialiste', 'CARE_REVIEW': 'Révision des soins', 'OTHER': 'Autre suivi',
  },
  'es': {
    'title': 'Recomendación de seguimiento', 'newRecommendation': 'Recomendar seguimiento',
    'type': 'Tipo de recomendación', 'date': 'Fecha recomendada', 'rationale': 'Motivo',
    'instructions': 'Instrucciones para el paciente', 'save': 'Enviar recomendación', 'cancel': 'Cancelar',
    'saved': 'Recomendación de seguimiento enviada al paciente.', 'empty': 'Todavía no hay recomendaciones de seguimiento.',
    'notice': 'Es solo una recomendación. No crea una orden clínica ni reserva una cita automáticamente.',
    'booking': 'El paciente debe reservar por separado si necesita una nueva cita.',
    'FOLLOW_UP_VISIT': 'Visita de seguimiento', 'PRIMARY_CARE_REVIEW': 'Revisión de atención primaria',
    'SPECIALIST_REVIEW': 'Revisión con especialista', 'CARE_REVIEW': 'Revisión asistencial', 'OTHER': 'Otro seguimiento',
  },
};

class ProviderFollowUpPage extends StatefulWidget {
  const ProviderFollowUpPage({super.key, required this.session, required this.locale, required this.appointment});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<ProviderFollowUpPage> createState() => _ProviderFollowUpPageState();
}

class _ProviderFollowUpPageState extends State<ProviderFollowUpPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];
  String get patientId => _map(widget.appointment['patient'])['id']?.toString() ?? '';
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  _FollowUpApi get api => _FollowUpApi(widget.session);

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    if (patientId.isEmpty) { setState(() { busy = false; error = 'Appointment patient context is unavailable.'; }); return; }
    setState(() { busy = true; error = null; });
    try {
      final payload = await api.providerList(patientId);
      if (mounted) setState(() => items = _list(payload['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(followUpText(widget.locale, 'title'))),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('provider-follow-up-create'),
      onPressed: busy ? null : createRecommendation,
      icon: const Icon(Icons.event_repeat_outlined),
      label: Text(followUpText(widget.locale, 'newRecommendation')),
    ),
    body: SafeArea(child: busy
      ? const Center(child: CircularProgressIndicator())
      : error != null
        ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
        : RefreshIndicator(onRefresh: load, child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
            children: [
              _noticeCard(context),
              const SizedBox(height: 12),
              if (items.isEmpty)
                Padding(padding: const EdgeInsets.all(24), child: Text(followUpText(widget.locale, 'empty'), textAlign: TextAlign.center))
              else
                ...items.map((item) => _recommendationCard(context, item)),
            ],
          )),
    ),
  );

  Widget _noticeCard(BuildContext context) => Card(child: Padding(
    padding: const EdgeInsets.all(16),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(Icons.info_outline, color: Theme.of(context).colorScheme.primary),
      const SizedBox(width: 12),
      Expanded(child: Text('${followUpText(widget.locale, 'notice')}\n${followUpText(widget.locale, 'booking')}')),
    ]),
  ));

  Widget _recommendationCard(BuildContext context, Map<String, dynamic> item) {
    final data = _map(item['data']);
    final type = item['recommendationType']?.toString() ?? 'OTHER';
    final rationale = data['rationale']?.toString();
    return Card(child: ListTile(
      leading: const CircleAvatar(child: Icon(Icons.event_repeat_outlined)),
      title: Text(followUpText(widget.locale, type), style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text([
        if (item['recommendedFor'] != null) '${followUpText(widget.locale, 'date')}: ${_date(item['recommendedFor'])}',
        if (rationale != null && rationale.isNotEmpty) rationale,
        followUpText(widget.locale, 'notice'),
      ].join('\n')),
      isThreeLine: true,
    ));
  }

  Future<void> createRecommendation() async {
    var type = 'FOLLOW_UP_VISIT';
    DateTime? recommendedFor = DateTime.now().add(const Duration(days: 14));
    final rationale = TextEditingController();
    final instructions = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => Directionality(
        textDirection: widget.locale.textDirection,
        child: AlertDialog(
          title: Text(followUpText(widget.locale, 'newRecommendation')),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: type,
              decoration: InputDecoration(labelText: followUpText(widget.locale, 'type')),
              items: const ['FOLLOW_UP_VISIT','PRIMARY_CARE_REVIEW','SPECIALIST_REVIEW','CARE_REVIEW','OTHER']
                  .map((value) => DropdownMenuItem(value: value, child: Text(followUpText(widget.locale, value))))
                  .toList(growable: false),
              onChanged: (value) { if (value != null) setDialogState(() => type = value); },
            ),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event_outlined),
              title: Text(followUpText(widget.locale, 'date')),
              subtitle: Text(recommendedFor == null ? '—' : _date(recommendedFor!.toIso8601String())),
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: recommendedFor ?? DateTime.now().add(const Duration(days: 14)),
                  firstDate: DateTime.now(),
                  lastDate: DateTime.now().add(const Duration(days: 730)),
                );
                if (picked != null) setDialogState(() => recommendedFor = DateTime(picked.year, picked.month, picked.day, 12));
              },
            ),
            TextField(controller: rationale, maxLines: 3, decoration: InputDecoration(labelText: followUpText(widget.locale, 'rationale'))),
            const SizedBox(height: 12),
            TextField(controller: instructions, maxLines: 4, decoration: InputDecoration(labelText: followUpText(widget.locale, 'instructions'))),
            const SizedBox(height: 12),
            Text(followUpText(widget.locale, 'notice'), style: Theme.of(context).textTheme.bodySmall),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(followUpText(widget.locale, 'cancel'))),
            FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(followUpText(widget.locale, 'save'))),
          ],
        ),
      )),
    );
    if (accepted != true || appointmentId.isEmpty) return;
    try {
      await api.create({
        'appointmentId': appointmentId,
        'idempotencyKey': 'mobile-follow-up-${DateTime.now().microsecondsSinceEpoch}',
        'recommendationType': type,
        if (recommendedFor != null) 'recommendedFor': recommendedFor!.toUtc().toIso8601String(),
        if (rationale.text.trim().isNotEmpty) 'rationale': rationale.text.trim(),
        if (instructions.text.trim().isNotEmpty) 'instructions': instructions.text.trim(),
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(followUpText(widget.locale, 'saved'))));
      await load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }
}

class PatientFollowUpRecommendationPage extends StatefulWidget {
  const PatientFollowUpRecommendationPage({super.key, required this.session, required this.locale, required this.recommendationId});
  final CarePointSession session;
  final CarePointLocale locale;
  final String recommendationId;

  @override
  State<PatientFollowUpRecommendationPage> createState() => _PatientFollowUpRecommendationPageState();
}

class _PatientFollowUpRecommendationPageState extends State<PatientFollowUpRecommendationPage> {
  bool busy = true;
  String? error;
  Map<String, dynamic>? item;

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final payload = await _FollowUpApi(widget.session).patientGet(widget.recommendationId);
      if (mounted) setState(() => item = payload);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _map(item?['data']);
    final type = item?['recommendationType']?.toString() ?? 'OTHER';
    return Scaffold(
      appBar: AppBar(title: Text(followUpText(widget.locale, 'title'))),
      body: SafeArea(child: busy
        ? const Center(child: CircularProgressIndicator())
        : error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
          : ListView(padding: const EdgeInsets.all(16), children: [
              _notice(context),
              const SizedBox(height: 12),
              Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(followUpText(widget.locale, type), style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                if (item?['recommendedFor'] != null) ...[
                  const SizedBox(height: 8),
                  Text('${followUpText(widget.locale, 'date')}: ${_date(item!['recommendedFor'])}'),
                ],
                if ((data['rationale']?.toString() ?? '').isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(followUpText(widget.locale, 'rationale'), style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(data['rationale'].toString()),
                ],
                if ((data['instructions']?.toString() ?? '').isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(followUpText(widget.locale, 'instructions'), style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(data['instructions'].toString()),
                ],
              ]))),
            ]),
      ),
    );
  }

  Widget _notice(BuildContext context) => Card(child: Padding(
    padding: const EdgeInsets.all(16),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(Icons.info_outline, color: Theme.of(context).colorScheme.primary),
      const SizedBox(width: 12),
      Expanded(child: Text('${followUpText(widget.locale, 'notice')}\n${followUpText(widget.locale, 'booking')}')),
    ]),
  ));
}

class _FollowUpApi {
  const _FollowUpApi(this.session);
  final CarePointSession session;

  Future<Map<String, dynamic>> providerList(String patientId) => _request('GET', '/provider/follow-up-recommendations/patients/$patientId');
  Future<Map<String, dynamic>> create(Map<String, dynamic> body) => _request('POST', '/provider/follow-up-recommendations', body: body);
  Future<Map<String, dynamic>> patientGet(String id) => _request('GET', '/patient/follow-up-recommendations/$id');

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body}) async {
    await session.api.me();
    final token = session.api.accessToken;
    if (token == null || token.isEmpty) throw const CarePointApiException('Authentication is required.');
    final uri = Uri.parse('${session.api.baseUrl}$path');
    final headers = <String, String>{
      'accept': 'application/json',
      'authorization': 'Bearer $token',
      if (body != null) 'content-type': 'application/json',
    };
    final response = method == 'GET'
        ? await http.get(uri, headers: headers)
        : await http.post(uri, headers: headers, body: jsonEncode(body));
    dynamic payload;
    if (response.body.isNotEmpty) {
      try { payload = jsonDecode(response.body); } catch (_) { payload = response.body; }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null ? payload['message'].toString() : 'Request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    return _map(payload);
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _date(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')}';
}
