import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String nutritionPlanText(CarePointLocale locale, String key) =>
    _nutritionPlanStrings[locale.name]?[key] ?? _nutritionPlanStrings['en']![key] ?? key;

const _nutritionPlanStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Nutrition plan',
    'patientTitle': 'My nutrition plan',
    'newPlan': 'Create plan',
    'editPlan': 'Update plan',
    'recommendations': 'Recommendations',
    'recommendationsHint': 'One recommendation per line',
    'goals': 'Goals',
    'goalsHint': 'One per line: goal | target | unit',
    'tasks': 'Patient tasks',
    'tasksHint': 'One task per line',
    'reviewDate': 'Review date',
    'currentVersion': 'Version',
    'save': 'Save',
    'cancel': 'Cancel',
    'saved': 'Nutrition plan saved.',
    'empty': 'No nutrition plan is available yet.',
    'required': 'Add at least one recommendation, goal, or task.',
    'patientNotice': 'This is the current version shared through your Care Plan. Review dates and changes are versioned.',
  },
  'ar': {
    'title': 'الخطة الغذائية',
    'patientTitle': 'خطتي الغذائية',
    'newPlan': 'إنشاء خطة',
    'editPlan': 'تحديث الخطة',
    'recommendations': 'التوصيات',
    'recommendationsHint': 'توصية واحدة في كل سطر',
    'goals': 'الأهداف',
    'goalsHint': 'سطر لكل هدف: الهدف | القيمة | الوحدة',
    'tasks': 'مهام المريض',
    'tasksHint': 'مهمة واحدة في كل سطر',
    'reviewDate': 'تاريخ المراجعة',
    'currentVersion': 'الإصدار',
    'save': 'حفظ',
    'cancel': 'إلغاء',
    'saved': 'تم حفظ الخطة الغذائية.',
    'empty': 'لا توجد خطة غذائية متاحة بعد.',
    'required': 'أضف توصية أو هدفاً أو مهمة واحدة على الأقل.',
    'patientNotice': 'هذه هي النسخة الحالية المشتركة عبر خطة الرعاية. يتم حفظ نسخ التغييرات وتواريخ المراجعة.',
  },
  'fr': {
    'title': 'Plan nutritionnel',
    'patientTitle': 'Mon plan nutritionnel',
    'newPlan': 'Créer un plan',
    'editPlan': 'Mettre à jour',
    'recommendations': 'Recommandations',
    'recommendationsHint': 'Une recommandation par ligne',
    'goals': 'Objectifs',
    'goalsHint': 'Une ligne : objectif | cible | unité',
    'tasks': 'Tâches patient',
    'tasksHint': 'Une tâche par ligne',
    'reviewDate': 'Date de révision',
    'currentVersion': 'Version',
    'save': 'Enregistrer',
    'cancel': 'Annuler',
    'saved': 'Plan nutritionnel enregistré.',
    'empty': 'Aucun plan nutritionnel disponible.',
    'required': 'Ajoutez au moins une recommandation, un objectif ou une tâche.',
    'patientNotice': 'Ceci est la version actuelle partagée via votre plan de soins. Les changements et dates de révision sont versionnés.',
  },
  'es': {
    'title': 'Plan nutricional',
    'patientTitle': 'Mi plan nutricional',
    'newPlan': 'Crear plan',
    'editPlan': 'Actualizar plan',
    'recommendations': 'Recomendaciones',
    'recommendationsHint': 'Una recomendación por línea',
    'goals': 'Objetivos',
    'goalsHint': 'Una línea: objetivo | meta | unidad',
    'tasks': 'Tareas del paciente',
    'tasksHint': 'Una tarea por línea',
    'reviewDate': 'Fecha de revisión',
    'currentVersion': 'Versión',
    'save': 'Guardar',
    'cancel': 'Cancelar',
    'saved': 'Plan nutricional guardado.',
    'empty': 'Todavía no hay un plan nutricional disponible.',
    'required': 'Añade al menos una recomendación, objetivo o tarea.',
    'patientNotice': 'Esta es la versión actual compartida mediante tu Plan de Cuidados. Los cambios y fechas de revisión quedan versionados.',
  },
};

class ProviderNutritionPlanPage extends StatefulWidget {
  const ProviderNutritionPlanPage({super.key, required this.session, required this.locale, required this.appointment});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<ProviderNutritionPlanPage> createState() => _ProviderNutritionPlanPageState();
}

class _ProviderNutritionPlanPageState extends State<ProviderNutritionPlanPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> plans = const [];
  String get patientId => _map(widget.appointment['patient'])['id']?.toString() ?? '';
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  _NutritionPlanApi get api => _NutritionPlanApi(widget.session);

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (patientId.isEmpty) {
      setState(() { busy = false; error = 'Appointment patient context is unavailable.'; });
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      final result = await api.providerPlans(patientId);
      if (mounted) setState(() => plans = _list(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(nutritionPlanText(widget.locale, 'title'))),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('nutrition-plan-create'),
      onPressed: busy ? null : () => edit(null),
      icon: const Icon(Icons.add_task_outlined),
      label: Text(nutritionPlanText(widget.locale, 'newPlan')),
    ),
    body: SafeArea(
      child: busy
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
              : RefreshIndicator(
                  onRefresh: load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
                    children: plans.isEmpty
                        ? [Padding(padding: const EdgeInsets.all(24), child: Text(nutritionPlanText(widget.locale, 'empty'), textAlign: TextAlign.center))]
                        : plans.map(_card).toList(growable: false),
                  ),
                ),
    ),
  );

  Widget _card(Map<String, dynamic> plan) {
    final data = _map(plan['data']);
    final recommendations = _list(data['recommendations']);
    final goals = _list(data['goals']);
    final tasks = _list(data['tasks']);
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.restaurant_menu_outlined)),
        title: Text('${nutritionPlanText(widget.locale, 'currentVersion')} ${plan['version'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(
          '${nutritionPlanText(widget.locale, 'reviewDate')}: ${_date(plan['reviewAt'])}\n'
          '${nutritionPlanText(widget.locale, 'recommendations')}: ${recommendations.length} · ${nutritionPlanText(widget.locale, 'goals')}: ${goals.length} · ${nutritionPlanText(widget.locale, 'tasks')}: ${tasks.length}',
        ),
        isThreeLine: true,
        trailing: const Icon(Icons.edit_outlined),
        onTap: () => edit(plan),
      ),
    );
  }

  Future<void> edit(Map<String, dynamic>? existing) async {
    final data = _map(existing?['data']);
    final recommendationsController = TextEditingController(
      text: _list(data['recommendations']).map((item) => item['label']?.toString() ?? '').where((item) => item.isNotEmpty).join('\n'),
    );
    final goalsController = TextEditingController(
      text: _list(data['goals']).map((item) {
        final label = item['label']?.toString() ?? '';
        final target = item['target']?.toString() ?? '';
        final unit = item['unit']?.toString() ?? '';
        return [label, target, unit].join(' | ');
      }).where((item) => item.replaceAll('|', '').trim().isNotEmpty).join('\n'),
    );
    final tasksController = TextEditingController(
      text: _list(data['tasks']).map((item) => item['label']?.toString() ?? '').where((item) => item.isNotEmpty).join('\n'),
    );
    var reviewAt = DateTime.tryParse(existing?['reviewAt']?.toString() ?? '')?.toLocal() ?? DateTime.now().add(const Duration(days: 14));
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: widget.locale.textDirection,
          child: AlertDialog(
            title: Text(nutritionPlanText(widget.locale, existing == null ? 'newPlan' : 'editPlan')),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(controller: recommendationsController, maxLines: 4, decoration: InputDecoration(labelText: nutritionPlanText(widget.locale, 'recommendations'), hintText: nutritionPlanText(widget.locale, 'recommendationsHint'))),
                  const SizedBox(height: 12),
                  TextField(controller: goalsController, maxLines: 4, decoration: InputDecoration(labelText: nutritionPlanText(widget.locale, 'goals'), hintText: nutritionPlanText(widget.locale, 'goalsHint'))),
                  const SizedBox(height: 12),
                  TextField(controller: tasksController, maxLines: 4, decoration: InputDecoration(labelText: nutritionPlanText(widget.locale, 'tasks'), hintText: nutritionPlanText(widget.locale, 'tasksHint'))),
                  const SizedBox(height: 12),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_repeat_outlined),
                    title: Text(nutritionPlanText(widget.locale, 'reviewDate')),
                    subtitle: Text(_date(reviewAt.toIso8601String())),
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: reviewAt,
                        firstDate: DateTime.now().add(const Duration(days: 1)),
                        lastDate: DateTime.now().add(const Duration(days: 730)),
                      );
                      if (picked != null) setDialogState(() => reviewAt = DateTime(picked.year, picked.month, picked.day, 12));
                    },
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(nutritionPlanText(widget.locale, 'cancel'))),
              FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(nutritionPlanText(widget.locale, 'save'))),
            ],
          ),
        ),
      ),
    );
    if (accepted != true) return;
    final recommendations = _lines(recommendationsController.text)
        .asMap().entries.map((entry) => {'code': 'RECOMMENDATION_${entry.key + 1}', 'label': entry.value}).toList(growable: false);
    final goals = _lines(goalsController.text).asMap().entries.map((entry) {
      final parts = entry.value.split('|').map((item) => item.trim()).toList(growable: false);
      return {
        'metricCode': 'NUTRITION_GOAL_${entry.key + 1}',
        'label': parts.isEmpty ? entry.value : parts[0],
        if (parts.length > 1 && parts[1].isNotEmpty) 'target': parts[1],
        if (parts.length > 2 && parts[2].isNotEmpty) 'unit': parts[2],
      };
    }).toList(growable: false);
    final tasks = _lines(tasksController.text)
        .asMap().entries.map((entry) => {'taskCode': 'NUTRITION_TASK_${entry.key + 1}', 'label': entry.value}).toList(growable: false);
    if (recommendations.isEmpty && goals.isEmpty && tasks.isEmpty) {
      _message(nutritionPlanText(widget.locale, 'required'));
      return;
    }
    final reviewUtc = reviewAt.toUtc().toIso8601String();
    try {
      if (existing == null) {
        await api.create({
          'appointmentId': appointmentId,
          'idempotencyKey': 'mobile-nutrition-${DateTime.now().microsecondsSinceEpoch}',
          'effectiveFrom': DateTime.now().toUtc().toIso8601String(),
          'reviewAt': reviewUtc,
          'recommendations': recommendations,
          'goals': goals,
          'tasks': tasks,
        });
      } else {
        await api.update(existing['id'].toString(), {
          'expectedVersion': existing['version'],
          'reviewAt': reviewUtc,
          'recommendations': recommendations,
          'goals': goals,
          'tasks': tasks,
          'reasonCode': 'NUTRITION_PLAN_REVIEW',
        });
      }
      _message(nutritionPlanText(widget.locale, 'saved'));
      await load();
    } catch (value) {
      _message(value.toString());
    }
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class PatientNutritionPlanPage extends StatefulWidget {
  const PatientNutritionPlanPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientNutritionPlanPage> createState() => _PatientNutritionPlanPageState();
}

class _PatientNutritionPlanPageState extends State<PatientNutritionPlanPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> plans = const [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final result = await _NutritionPlanApi(widget.session).patientCarePlans();
      final items = _list(result['items']).where((item) => _map(item['data'])['kind'] == 'NUTRITION_PLAN').toList(growable: false);
      if (mounted) setState(() => plans = items);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(nutritionPlanText(widget.locale, 'patientTitle'))),
    body: SafeArea(
      child: busy
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
              : RefreshIndicator(
                  onRefresh: load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Card(child: Padding(padding: const EdgeInsets.all(16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Icon(Icons.info_outline), const SizedBox(width: 12), Expanded(child: Text(nutritionPlanText(widget.locale, 'patientNotice'))),
                      ]))),
                      const SizedBox(height: 12),
                      if (plans.isEmpty)
                        Padding(padding: const EdgeInsets.all(24), child: Text(nutritionPlanText(widget.locale, 'empty'), textAlign: TextAlign.center))
                      else
                        ...plans.map(_patientCard),
                    ],
                  ),
                ),
    ),
  );

  Widget _patientCard(Map<String, dynamic> plan) {
    final data = _map(plan['data']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${nutritionPlanText(widget.locale, 'currentVersion')} ${plan['version'] ?? '—'}', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text('${nutritionPlanText(widget.locale, 'reviewDate')}: ${_date(plan['reviewAt'])}'),
            const Divider(height: 24),
            _section(nutritionPlanText(widget.locale, 'recommendations'), _list(data['recommendations']).map((item) => item['label']?.toString() ?? '').toList()),
            _section(nutritionPlanText(widget.locale, 'goals'), _list(data['goals']).map((item) {
              final target = item['target']?.toString();
              final unit = item['unit']?.toString();
              return '${item['label'] ?? ''}${target == null ? '' : ' — $target${unit == null ? '' : ' $unit'}'}';
            }).toList()),
            _section(nutritionPlanText(widget.locale, 'tasks'), _list(data['tasks']).map((item) => item['label']?.toString() ?? '').toList()),
          ],
        ),
      ),
    );
  }

  Widget _section(String title, List<String> values) {
    final clean = values.where((item) => item.trim().isNotEmpty).toList(growable: false);
    if (clean.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        ...clean.map((item) => Padding(padding: const EdgeInsets.only(bottom: 3), child: Text('• $item'))),
      ]),
    );
  }
}

class _NutritionPlanApi {
  const _NutritionPlanApi(this.session);
  final CarePointSession session;

  Future<Map<String, dynamic>> providerPlans(String patientId) => _request('GET', '/provider/nutrition-plans/patients/$patientId');
  Future<Map<String, dynamic>> create(Map<String, dynamic> body) => _request('POST', '/provider/nutrition-plans', body: body);
  Future<Map<String, dynamic>> update(String planId, Map<String, dynamic> body) => _request('PATCH', '/provider/nutrition-plans/$planId', body: body);
  Future<Map<String, dynamic>> patientCarePlans() => _request('GET', '/patient/care-plans');

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
    final encoded = body == null ? null : jsonEncode(body);
    final response = switch (method) {
      'GET' => await http.get(uri, headers: headers),
      'POST' => await http.post(uri, headers: headers, body: encoded),
      'PATCH' => await http.patch(uri, headers: headers, body: encoded),
      _ => throw const CarePointApiException('Unsupported HTTP method.'),
    };
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

List<String> _lines(String value) => value
    .split('\n')
    .map((item) => item.trim())
    .where((item) => item.isNotEmpty)
    .toList(growable: false);

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
