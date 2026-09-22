import 'package:flutter/material.dart';

import 'carepoint_localization.dart';

const doctorWorkQueueFilters = <String>[
  'ALL',
  'PENDING_QUESTIONNAIRE',
  'OPEN_ALERT',
  'NEW_RESULT',
  'OVERDUE_FOLLOW_UP',
];

Set<String> doctorWorkQueuePatientIds(Map<String, dynamic> payload, String filter) {
  if (filter == 'ALL') return const <String>{};
  final result = <String>{};
  for (final item in _maps(payload['items'])) {
    final criteria = _map(item['criteria']);
    final value = switch (filter) {
      'PENDING_QUESTIONNAIRE' => criteria['pendingQuestionnaireCount'],
      'OPEN_ALERT' => criteria['openAlertCount'],
      'NEW_RESULT' => criteria['newResultCount'],
      'OVERDUE_FOLLOW_UP' => criteria['overdueFollowUpCount'],
      _ => 0,
    };
    if ((value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0) > 0) {
      final patientId = item['patientId']?.toString();
      if (patientId?.isNotEmpty == true) result.add(patientId!);
    }
  }
  return result;
}

class DoctorWorkQueuePanel extends StatelessWidget {
  const DoctorWorkQueuePanel({
    super.key,
    required this.payload,
    required this.locale,
    required this.accent,
    required this.selected,
    required this.onSelected,
  });

  final Map<String, dynamic> payload;
  final CarePointLocale locale;
  final Color accent;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final counts = _map(payload['counts']);
    final matchingIds = doctorWorkQueuePatientIds(payload, selected);
    final matching = selected == 'ALL'
        ? const <Map<String, dynamic>>[]
        : _maps(payload['items']).where((item) => matchingIds.contains(item['patientId']?.toString())).toList(growable: false);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Icon(Icons.filter_alt_outlined, color: accent),
            const SizedBox(width: 8),
            Expanded(child: Text(doctorWorkQueueText(locale, 'title'), style: const TextStyle(fontWeight: FontWeight.w900))),
          ]),
          const SizedBox(height: 4),
          Text(doctorWorkQueueText(locale, 'subtitle'), style: const TextStyle(color: Color(0xFF64748B))),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: doctorWorkQueueFilters.map((filter) {
              final count = filter == 'ALL'
                  ? _maps(payload['items']).length
                  : (counts[filter] is num ? (counts[filter] as num).toInt() : int.tryParse(counts[filter]?.toString() ?? '') ?? 0);
              return ChoiceChip(
                selected: selected == filter,
                onSelected: (_) => onSelected(filter),
                label: Text('${doctorWorkQueueText(locale, filter)} · $count'),
              );
            }).toList(growable: false),
          ),
          if (selected != 'ALL') ...[
            const SizedBox(height: 12),
            if (matching.isEmpty)
              Text(doctorWorkQueueText(locale, 'empty'))
            else
              ...matching.take(20).map((item) => _patientRow(item)),
          ],
        ]),
      ),
    );
  }

  Widget _patientRow(Map<String, dynamic> item) {
    final criteria = _map(item['criteria']);
    final parts = <String>[
      if (_count(criteria['pendingQuestionnaireCount']) > 0)
        '${doctorWorkQueueText(locale, 'PENDING_QUESTIONNAIRE')}: ${_count(criteria['pendingQuestionnaireCount'])}',
      if (_count(criteria['openAlertCount']) > 0)
        '${doctorWorkQueueText(locale, 'OPEN_ALERT')}: ${_count(criteria['openAlertCount'])}',
      if (_count(criteria['newResultCount']) > 0)
        '${doctorWorkQueueText(locale, 'NEW_RESULT')}: ${_count(criteria['newResultCount'])}',
      if (_count(criteria['overdueFollowUpCount']) > 0)
        '${doctorWorkQueueText(locale, 'OVERDUE_FOLLOW_UP')}: ${_count(criteria['overdueFollowUpCount'])}',
    ];
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: accent.withValues(alpha: 0.12),
        child: Icon(Icons.person_search_outlined, color: accent),
      ),
      title: Text(item['patientDisplayName']?.toString().isNotEmpty == true ? item['patientDisplayName'].toString() : doctorWorkQueueText(locale, 'patient')),
      subtitle: Text(parts.join(' · ')),
    );
  }

  int _count(dynamic value) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;
}

String doctorWorkQueueText(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'title': {'en':'Follow-up filters','ar':'مرشحات المتابعة','fr':'Filtres de suivi','es':'Filtros de seguimiento'},
    'subtitle': {'en':'Roster-only clinical follow-up indicators. Counts never expand your authorized patient list.','ar':'مؤشرات متابعة سريرية ضمن قائمة مرضاك المصرح بها فقط. لا توسّع العدادات نطاق الوصول.','fr':'Indicateurs de suivi clinique limités à votre file autorisée. Les compteurs n’élargissent jamais l’accès.','es':'Indicadores de seguimiento clínico limitados a tu lista autorizada. Los contadores nunca amplían el acceso.'},
    'ALL': {'en':'All','ar':'الكل','fr':'Tous','es':'Todos'},
    'PENDING_QUESTIONNAIRE': {'en':'Questionnaire pending','ar':'استبيان معلّق','fr':'Questionnaire en attente','es':'Cuestionario pendiente'},
    'OPEN_ALERT': {'en':'Open alert','ar':'تنبيه مفتوح','fr':'Alerte ouverte','es':'Alerta abierta'},
    'NEW_RESULT': {'en':'New result','ar':'نتيجة جديدة','fr':'Nouveau résultat','es':'Resultado nuevo'},
    'OVERDUE_FOLLOW_UP': {'en':'Follow-up overdue','ar':'متابعة متأخرة','fr':'Suivi en retard','es':'Seguimiento vencido'},
    'empty': {'en':'No authorized patients match this filter.','ar':'لا يوجد مرضى مصرح بهم يطابقون هذا المرشح.','fr':'Aucun patient autorisé ne correspond à ce filtre.','es':'Ningún paciente autorizado coincide con este filtro.'},
    'patient': {'en':'Patient','ar':'المريض','fr':'Patient','es':'Paciente'},
  };
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return values[key]?[language] ?? values[key]?['en'] ?? key;
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
