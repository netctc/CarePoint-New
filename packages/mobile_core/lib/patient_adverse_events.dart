import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientAdverseEventReportPage extends StatefulWidget {
  const PatientAdverseEventReportPage({
    super.key,
    required this.session,
    required this.locale,
    required this.sourceKind,
    required this.sourceId,
    required this.sourceLabel,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String sourceKind;
  final String sourceId;
  final String sourceLabel;

  @override
  State<PatientAdverseEventReportPage> createState() => _PatientAdverseEventReportPageState();
}

class _PatientAdverseEventReportPageState extends State<PatientAdverseEventReportPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> reports = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => patientAdverseEventText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final value = await api.patientAdverseEvents(
        sourceKind: widget.sourceKind,
        sourceId: widget.sourceId,
      );
      if (mounted) setState(() => reports = _maps(value['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _report() async {
    final symptom = TextEditingController();
    final notes = TextEditingController();
    double severity = 5;
    String? validation;

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(t('report')),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(widget.sourceLabel, style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(t('causalityWarning'), style: const TextStyle(color: Color(0xFF64748B))),
              const SizedBox(height: 12),
              TextField(
                controller: symptom,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: t('symptom'),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: Text('${t('severity')}: ${severity.round()}/10'),
              ),
              Slider(
                value: severity,
                min: 0,
                max: 10,
                divisions: 10,
                label: severity.round().toString(),
                onChanged: (value) => setLocal(() => severity = value),
              ),
              TextField(
                controller: notes,
                maxLines: 4,
                decoration: InputDecoration(
                  labelText: t('notes'),
                  border: const OutlineInputBorder(),
                ),
              ),
              if (validation != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(
                    validation!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ),
            ]),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(t('cancel')),
            ),
            FilledButton(
              onPressed: () {
                if (symptom.text.trim().isEmpty) {
                  setLocal(() => validation = t('symptomRequired'));
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              child: Text(t('send')),
            ),
          ],
        ),
      ),
    );

    if (accepted == true) {
      try {
        final created = await api.createPatientAdverseEvent(
          sourceKind: widget.sourceKind,
          sourceId: widget.sourceId,
          symptom: symptom.text.trim(),
          severityDeclared: severity.round(),
          notes: notes.text.trim(),
          occurredAt: DateTime.now().toUtc(),
          idempotencyKey: 'mobile-adverse-${DateTime.now().microsecondsSinceEpoch}',
        );
        if (mounted) {
          final receipt = _map(created['receipt']);
          final routed = receipt['routedToCareTeam'] == true;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(routed ? t('receivedRouted') : t('received'))),
          );
        }
        await _load();
      } catch (value) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
      }
    }

    symptom.dispose();
    notes.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('title')),
      actions: [
        IconButton(
          onPressed: loading ? null : _load,
          icon: const Icon(Icons.refresh_outlined),
          tooltip: t('refresh'),
        ),
      ],
    ),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('patient-adverse-event-create'),
      onPressed: _report,
      icon: const Icon(Icons.report_gmailerrorred_outlined),
      label: Text(t('report')),
    ),
    body: loading && reports.isEmpty
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(widget.sourceLabel, style: const TextStyle(fontWeight: FontWeight.w900)),
                      const SizedBox(height: 6),
                      Text(t('intro'), style: const TextStyle(color: Color(0xFF475569))),
                    ]),
                  ),
                ),
                if (error != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                  ),
                if (!loading && error == null && reports.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(28),
                    child: Text(t('empty'), textAlign: TextAlign.center),
                  ),
                ...reports.map(_reportCard),
              ],
            ),
          ),
  );

  Widget _reportCard(Map<String, dynamic> report) => Card(
    child: ListTile(
      leading: const Icon(Icons.verified_outlined),
      title: Text(report['symptom']?.toString() ?? t('report')),
      subtitle: Text([
        '${t('severity')}: ${report['severityDeclared'] ?? ''}/10',
        '${t('status')}: ${report['status'] ?? ''}',
        '${t('receivedAt')}: ${_dateTime(report['receivedAt'])}',
        report['causalityAssessed'] == false ? t('causalityNotAssessed') : '',
        if (report['notes']?.toString().trim().isNotEmpty == true) report['notes'].toString(),
      ].where((value) => value.trim().isNotEmpty).join('\n')),
      isThreeLine: true,
    ),
  );
}

String patientAdverseEventText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Possible medication effect','intro':'Report symptoms you noticed while taking this medication. This is patient-reported information and does not establish that the medication caused the symptom.','report':'Report possible effect','causalityWarning':'CarePoint records what you report and routes it to an eligible Doctor. It does not diagnose causality.','symptom':'Symptom or concern','severity':'Severity you report','notes':'Additional notes (optional)','cancel':'Cancel','send':'Send report','symptomRequired':'Describe the symptom or concern.','received':'Report received by CarePoint.','receivedRouted':'Report received and routed to your care team.','refresh':'Refresh','empty':'No possible effects have been reported for this medication.','status':'Receipt status','receivedAt':'Received','causalityNotAssessed':'Medication causality has not been assessed.'
    },
    CarePointLocale.ar: {
      'title':'أثر دوائي محتمل','intro':'أبلغ عن الأعراض التي لاحظتها أثناء تناول هذا الدواء. هذه معلومات يبلّغ عنها المريض ولا تثبت أن الدواء سبب العرض.','report':'الإبلاغ عن أثر محتمل','causalityWarning':'يسجل CarePoint ما تبلغ عنه ويوجهه إلى طبيب مؤهل. لا يشخّص العلاقة السببية.','symptom':'العرض أو القلق','severity':'الشدة التي تبلغ عنها','notes':'ملاحظات إضافية (اختياري)','cancel':'إلغاء','send':'إرسال التقرير','symptomRequired':'صف العرض أو القلق.','received':'استلم CarePoint التقرير.','receivedRouted':'تم استلام التقرير وتوجيهه إلى فريق الرعاية.','refresh':'تحديث','empty':'لا توجد آثار محتملة مبلّغ عنها لهذا الدواء.','status':'حالة الاستلام','receivedAt':'وقت الاستلام','causalityNotAssessed':'لم يتم تقييم علاقة الدواء بالعرض.'
    },
    CarePointLocale.fr: {
      'title':'Effet médicamenteux possible','intro':'Signalez les symptômes observés pendant la prise de ce médicament. Il s’agit d’informations déclarées par le patient; elles ne prouvent pas que le médicament en est la cause.','report':'Signaler un effet possible','causalityWarning':'CarePoint enregistre votre signalement et le transmet à un médecin éligible. Il ne diagnostique pas la causalité.','symptom':'Symptôme ou préoccupation','severity':'Sévérité déclarée','notes':'Notes supplémentaires (facultatif)','cancel':'Annuler','send':'Envoyer','symptomRequired':'Décrivez le symptôme ou la préoccupation.','received':'Signalement reçu par CarePoint.','receivedRouted':'Signalement reçu et transmis à votre équipe de soins.','refresh':'Actualiser','empty':'Aucun effet possible signalé pour ce médicament.','status':'Statut de réception','receivedAt':'Reçu','causalityNotAssessed':'La causalité médicamenteuse n’a pas été évaluée.'
    },
    CarePointLocale.es: {
      'title':'Posible efecto del medicamento','intro':'Reporta síntomas observados mientras tomas este medicamento. Es información declarada por el paciente y no demuestra que el medicamento haya causado el síntoma.','report':'Reportar posible efecto','causalityWarning':'CarePoint registra lo que reportas y lo dirige a un médico elegible. No diagnostica causalidad.','symptom':'Síntoma o preocupación','severity':'Severidad declarada','notes':'Notas adicionales (opcional)','cancel':'Cancelar','send':'Enviar reporte','symptomRequired':'Describe el síntoma o preocupación.','received':'Reporte recibido por CarePoint.','receivedRouted':'Reporte recibido y enviado a tu equipo de atención.','refresh':'Actualizar','empty':'No hay posibles efectos reportados para este medicamento.','status':'Estado de recepción','receivedAt':'Recibido','causalityNotAssessed':'No se ha evaluado la causalidad del medicamento.'
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

String _dateTime(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
