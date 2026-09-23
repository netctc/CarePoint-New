import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientClinicalAlertsPage extends StatefulWidget {
  const PatientClinicalAlertsPage({
    super.key,
    required this.session,
    required this.locale,
  });

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientClinicalAlertsPage> createState() => _PatientClinicalAlertsPageState();
}

class _PatientClinicalAlertsPageState extends State<PatientClinicalAlertsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => patientClinicalAlertText(widget.locale, key);

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
      final payload = await widget.session.api.patientClinicalAlerts();
      if (!mounted) return;
      setState(() => items = _maps(payload['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _markViewed(Map<String, dynamic> item) async {
    final id = item['id']?.toString() ?? '';
    if (id.isEmpty || item['viewed'] == true) return;
    try {
      final updated = await widget.session.api.markPatientClinicalAlertViewed(id);
      if (!mounted) return;
      setState(() {
        items = items
            .map((current) => current['id']?.toString() == id ? updated : current)
            .toList(growable: false);
      });
    } catch (value) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('title')),
      actions: [
        IconButton(
          onPressed: loading ? null : _load,
          tooltip: t('refresh'),
          icon: const Icon(Icons.refresh_outlined),
        ),
      ],
    ),
    body: loading && items.isEmpty
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 28),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline),
                        const SizedBox(width: 10),
                        Expanded(child: Text(t('safety'))),
                      ],
                    ),
                  ),
                ),
                if (error != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(
                        error!,
                        style: TextStyle(color: Theme.of(context).colorScheme.error),
                      ),
                    ),
                  ),
                if (items.isEmpty && error == null)
                  Padding(
                    padding: const EdgeInsets.all(28),
                    child: Text(t('empty'), textAlign: TextAlign.center),
                  )
                else
                  ...items.map(_alertCard),
              ],
            ),
          ),
  );

  Widget _alertCard(Map<String, dynamic> item) {
    final viewed = item['viewed'] == true;
    final severity = item['severity']?.toString() ?? '—';
    final status = item['status']?.toString() ?? '—';
    final action = item['patientActionKey']?.toString() ?? '—';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Expanded(
                child: Text(
                  item['metricCode']?.toString() ?? t('alert'),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                ),
              ),
              Chip(label: Text(severity)),
            ]),
            const SizedBox(height: 4),
            Text('${t('status')}: $status'),
            Text('${t('created')}: ${_dateTime(item['createdAt'])}'),
            Text('${t('action')}: $action'),
            const Divider(),
            Text('${t('rule')}: ${item['ruleId'] ?? '—'} · v${item['ruleVersion'] ?? '—'}'),
            Text('${t('origin')}: ${item['sourceObservationId'] ?? '—'}'),
            if (item['carePlanId'] != null)
              Text('${t('carePlan')}: ${item['carePlanId']}'),
            const SizedBox(height: 10),
            if (!viewed)
              FilledButton.tonalIcon(
                key: ValueKey('patient-clinical-alert-viewed-${item['id']}'),
                onPressed: () => _markViewed(item),
                icon: const Icon(Icons.visibility_outlined),
                label: Text(t('markViewed')),
              )
            else
              Row(children: [
                const Icon(Icons.check_circle_outline, size: 18),
                const SizedBox(width: 6),
                Text(t('viewed')),
              ]),
          ],
        ),
      ),
    );
  }
}

String patientClinicalAlertText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Health alerts',
      'refresh':'Refresh',
      'empty':'No health alerts are available.',
      'safety':'These alerts come from rules configured in your care plan. They recommend configured actions and do not create an automatic diagnosis.',
      'alert':'Health alert',
      'status':'Status',
      'created':'Created',
      'action':'Recommended action',
      'rule':'Rule',
      'origin':'Source observation',
      'carePlan':'Care plan',
      'markViewed':'Mark as viewed',
      'viewed':'Viewed',
    },
    CarePointLocale.ar: {
      'title':'تنبيهات الصحة',
      'refresh':'تحديث',
      'empty':'لا توجد تنبيهات صحية.',
      'safety':'تأتي هذه التنبيهات من قواعد مهيأة ضمن خطة الرعاية. تعرض الإجراء المهيأ ولا تنشئ تشخيصاً تلقائياً.',
      'alert':'تنبيه صحي',
      'status':'الحالة',
      'created':'وقت الإنشاء',
      'action':'الإجراء الموصى به',
      'rule':'القاعدة',
      'origin':'الملاحظة المصدرية',
      'carePlan':'خطة الرعاية',
      'markViewed':'تحديد كمقروء',
      'viewed':'تمت المشاهدة',
    },
    CarePointLocale.fr: {
      'title':'Alertes santé',
      'refresh':'Actualiser',
      'empty':'Aucune alerte santé disponible.',
      'safety':'Ces alertes proviennent de règles configurées dans votre plan de soins. Elles affichent l’action configurée et ne créent aucun diagnostic automatique.',
      'alert':'Alerte santé',
      'status':'Statut',
      'created':'Créée',
      'action':'Action recommandée',
      'rule':'Règle',
      'origin':'Observation source',
      'carePlan':'Plan de soins',
      'markViewed':'Marquer comme vue',
      'viewed':'Vue',
    },
    CarePointLocale.es: {
      'title':'Alertas de salud',
      'refresh':'Actualizar',
      'empty':'No hay alertas de salud disponibles.',
      'safety':'Estas alertas proceden de reglas configuradas en tu plan de cuidados. Muestran la acción configurada y no crean un diagnóstico automático.',
      'alert':'Alerta de salud',
      'status':'Estado',
      'created':'Creada',
      'action':'Acción recomendada',
      'rule':'Regla',
      'origin':'Observación de origen',
      'carePlan':'Plan de cuidados',
      'markViewed':'Marcar como vista',
      'viewed':'Vista',
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
}
