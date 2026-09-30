import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'patient_adverse_events.dart';

class PatientMedicationRemindersPage extends StatefulWidget {
  const PatientMedicationRemindersPage({
    super.key,
    required this.session,
    required this.locale,
  });

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientMedicationRemindersPage> createState() => _PatientMedicationRemindersPageState();
}

class _PatientMedicationRemindersPageState extends State<PatientMedicationRemindersPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> reminders = const [];
  List<Map<String, dynamic>> sources = const [];
  List<Map<String, dynamic>> intakes = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => patientMedicationReminderText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        api.patientMedicationReminders(),
        api.patientClinicalProfileEntries(kind: 'MEDICATION'),
        api.patientClinicalOrders(),
        api.patientMedicationIntakes(),
      ]);
      final profileItems = _maps(values[1]['items'])
          .where((item) => item['status']?.toString() == 'ACTIVE')
          .map(_statementSource)
          .toList(growable: false);
      final prescriptions = _maps(values[2]['items'])
          .where((item) => item['type']?.toString() == 'PRESCRIPTION' && item['status']?.toString() == 'SIGNED')
          .map(_prescriptionSource)
          .toList(growable: false);
      final nextSources = [...profileItems, ...prescriptions]
        ..sort((a, b) => (a['label']?.toString() ?? '').compareTo(b['label']?.toString() ?? ''));
      if (!mounted) return;
      setState(() {
        reminders = _maps(values[0]['items']);
        sources = nextSources;
        intakes = _maps(values[3]['items']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Map<String, dynamic> _statementSource(Map<String, dynamic> item) {
    final data = _map(item['data']);
    final name = data['name']?.toString().trim();
    final dose = data['dose']?.toString().trim();
    return {
      'sourceKind': 'CLINICAL_PROFILE_ENTRY',
      'sourceId': item['id']?.toString() ?? '',
      'label': name?.isNotEmpty == true ? name : t('medicationStatement'),
      'detail': dose?.isNotEmpty == true ? dose : t('patientStatement'),
    };
  }

  Map<String, dynamic> _prescriptionSource(Map<String, dynamic> item) {
    final data = _map(item['data']);
    final medication = _map(data['medication']);
    final name = medication['name']?.toString().trim();
    final strength = medication['strength']?.toString().trim();
    return {
      'sourceKind': 'PRESCRIPTION_ORDER',
      'sourceId': item['id']?.toString() ?? '',
      'label': name?.isNotEmpty == true ? name : t('prescription'),
      'detail': strength?.isNotEmpty == true ? strength : t('signedPrescription'),
    };
  }

  Map<String, dynamic>? _reminderFor(Map<String, dynamic> source) {
    for (final reminder in reminders) {
      if (reminder['sourceKind'] == source['sourceKind'] && reminder['sourceId'] == source['sourceId']) {
        return reminder;
      }
    }
    return null;
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
    body: loading && sources.isEmpty
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(12),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(t('intro'), style: const TextStyle(color: Color(0xFF475569))),
                  ),
                ),
                if (error != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                  ),
                if (!loading && error == null && sources.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(28),
                    child: Text(t('empty'), textAlign: TextAlign.center),
                  ),
                ...sources.map(_sourceCard),
              ],
            ),
          ),
  );

  Widget _sourceCard(Map<String, dynamic> source) {
    final reminder = _reminderFor(source);
    final enabled = reminder?['enabled'] == true;
    final times = _strings(reminder?['localTimes']);
    final zone = reminder?['timeZone']?.toString() ?? '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              source['sourceKind'] == 'PRESCRIPTION_ORDER'
                  ? Icons.receipt_long_outlined
                  : Icons.medication_outlined,
            ),
            title: Text(
              source['label']?.toString() ?? t('medication'),
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: Text([
              source['detail']?.toString() ?? '',
              source['sourceKind'] == 'PRESCRIPTION_ORDER' ? t('prescriptionSource') : t('statementSource'),
              if (reminder != null) '${t('schedule')}: ${times.join(', ')} · $zone',
            ].where((value) => value.trim().isNotEmpty).join('\n')),
            isThreeLine: reminder != null,
          ),
          OutlinedButton.icon(
            key: ValueKey('patient-adverse-event-report-${source['sourceId']}'),
            onPressed: () => Navigator.push<void>(
              context,
              MaterialPageRoute(
                builder: (_) => Directionality(
                  textDirection: widget.locale.textDirection,
                  child: PatientAdverseEventReportPage(
                    session: widget.session,
                    locale: widget.locale,
                    sourceKind: source['sourceKind'].toString(),
                    sourceId: source['sourceId'].toString(),
                    sourceLabel: source['label']?.toString() ?? t('medication'),
                  ),
                ),
              ),
            ),
            icon: const Icon(Icons.report_gmailerrorred_outlined),
            label: Text(patientAdverseEventText(widget.locale, 'report')),
          ),
          const SizedBox(height: 8),
          if (reminder != null) ...[
            Text(t('recordDose'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 8, children: [
              FilledButton.tonalIcon(
                key: ValueKey('patient-medication-intake-taken-${reminder['id']}'),
                onPressed: () => _recordIntake(reminder, 'TAKEN'),
                icon: const Icon(Icons.check_circle_outline),
                label: Text(t('taken')),
              ),
              OutlinedButton.icon(
                key: ValueKey('patient-medication-intake-omitted-${reminder['id']}'),
                onPressed: () => _recordIntake(reminder, 'OMITTED'),
                icon: const Icon(Icons.remove_circle_outline),
                label: Text(t('omitted')),
              ),
              OutlinedButton.icon(
                key: ValueKey('patient-medication-intake-postponed-${reminder['id']}'),
                onPressed: () => _recordIntake(reminder, 'POSTPONED'),
                icon: const Icon(Icons.schedule_send_outlined),
                label: Text(t('postponed')),
              ),
            ]),
            ..._intakesFor(reminder).take(3).map((item) => Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                '${_intakeLabel(item['status']?.toString() ?? '')} · ${_dateTime(item['occurredAt'])}',
                style: const TextStyle(color: Color(0xFF64748B)),
              ),
            )),
            const SizedBox(height: 10),
          ],
          if (reminder == null)
            FilledButton.tonalIcon(
              key: ValueKey('patient-medication-reminder-create-${source['sourceId']}'),
              onPressed: () => _configure(source, null),
              icon: const Icon(Icons.add_alarm_outlined),
              label: Text(t('create')),
            )
          else
            Row(children: [
              Expanded(
                child: SwitchListTile(
                  key: ValueKey('patient-medication-reminder-toggle-${reminder['id']}'),
                  contentPadding: EdgeInsets.zero,
                  value: enabled,
                  title: Text(enabled ? t('enabled') : t('disabled')),
                  onChanged: (value) => _toggle(reminder, value),
                ),
              ),
              IconButton(
                key: ValueKey('patient-medication-reminder-edit-${reminder['id']}'),
                onPressed: () => _configure(source, reminder),
                icon: const Icon(Icons.schedule_outlined),
                tooltip: t('edit'),
              ),
            ]),
        ]),
      ),
    );
  }


  Iterable<Map<String, dynamic>> _intakesFor(Map<String, dynamic> reminder) =>
      intakes.where((item) => item['reminderId']?.toString() == reminder['id']?.toString());

  String _intakeLabel(String status) => switch (status) {
    'TAKEN' => t('taken'),
    'OMITTED' => t('omitted'),
    'POSTPONED' => t('postponed'),
    _ => status,
  };

  String _dateTime(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (parsed == null) return '—';
    return parsed.toString().substring(0, 16);
  }

  Future<void> _recordIntake(Map<String, dynamic> reminder, String status) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_intakeLabel(status)),
        content: Text(t('intakeConfirm')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
        ],
      ),
    );
    if (confirmed != true) return;
    final now = DateTime.now().toUtc();
    try {
      await api.recordPatientMedicationIntake(
        reminderId: reminder['id'].toString(),
        status: status,
        scheduledFor: now,
        occurredAt: now,
        idempotencyKey: 'mobile-intake-${reminder['id']}-${now.microsecondsSinceEpoch}',
      );
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _toggle(Map<String, dynamic> reminder, bool enabled) async {
    try {
      await api.updatePatientMedicationReminder(reminder['id'].toString(), enabled: enabled);
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _configure(Map<String, dynamic> source, Map<String, dynamic>? reminder) async {
    final existingTimes = _strings(reminder?['localTimes']);
    final timesController = TextEditingController(
      text: existingTimes.isEmpty ? '08:00,20:00' : existingTimes.join(','),
    );
    final zoneController = TextEditingController(
      text: reminder?['timeZone']?.toString() ?? _localOffsetZone(),
    );
    String? validation;

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(reminder == null ? t('create') : t('edit')),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(
                source['label']?.toString() ?? t('medication'),
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: timesController,
                decoration: InputDecoration(
                  labelText: t('times'),
                  hintText: '08:00,20:00',
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: zoneController,
                decoration: InputDecoration(
                  labelText: t('timeZone'),
                  hintText: 'UTC+03:00 / Asia/Riyadh',
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
              const SizedBox(height: 10),
              Text(t('privacy'), style: const TextStyle(color: Color(0xFF64748B))),
            ]),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(t('cancel')),
            ),
            FilledButton(
              onPressed: () {
                final times = _parseTimes(timesController.text);
                if (times.isEmpty) {
                  setLocal(() => validation = t('invalidTimes'));
                  return;
                }
                if (zoneController.text.trim().isEmpty) {
                  setLocal(() => validation = t('invalidZone'));
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              child: Text(t('save')),
            ),
          ],
        ),
      ),
    );

    if (accepted == true) {
      final times = _parseTimes(timesController.text);
      final zone = zoneController.text.trim();
      try {
        if (reminder == null) {
          await api.createPatientMedicationReminder(
            sourceKind: source['sourceKind'].toString(),
            sourceId: source['sourceId'].toString(),
            localTimes: times,
            timeZone: zone,
          );
        } else {
          await api.updatePatientMedicationReminder(
            reminder['id'].toString(),
            localTimes: times,
            timeZone: zone,
          );
        }
        await _load();
      } catch (value) {
        _message(value.toString());
      }
    }

    timesController.dispose();
    zoneController.dispose();
  }

  List<String> _parseTimes(String raw) {
    final expression = RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$');
    final values = raw
        .split(',')
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toList(growable: false);
    if (values.isEmpty || values.length > 12 || values.any((value) => !expression.hasMatch(value))) {
      return const [];
    }
    if (values.toSet().length != values.length) return const [];
    final result = [...values]..sort();
    return result;
  }

  String _localOffsetZone() {
    final offset = DateTime.now().timeZoneOffset;
    final totalMinutes = offset.inMinutes;
    final sign = totalMinutes >= 0 ? '+' : '-';
    final absolute = totalMinutes.abs();
    final hours = (absolute ~/ 60).toString().padLeft(2, '0');
    final minutes = (absolute % 60).toString().padLeft(2, '0');
    return 'UTC$sign$hours:$minutes';
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

String patientMedicationReminderText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Medication reminders','intro':'Create voluntary reminders for active medication statements or signed prescriptions. Reminder settings never modify the medication statement or prescription.','refresh':'Refresh','empty':'No active medication source is available.','medication':'Medication','medicationStatement':'Medication statement','patientStatement':'Patient medication statement','prescription':'Prescription','signedPrescription':'Signed prescription','prescriptionSource':'Source: signed prescription','statementSource':'Source: active medication statement','schedule':'Schedule','create':'Create reminder','edit':'Edit schedule','enabled':'Reminder enabled','disabled':'Reminder disabled','times':'Local reminder times','timeZone':'Time zone','privacy':'Notifications use a generic medication-reminder message. Medication names and doses are not copied into external notification payloads.','invalidTimes':'Use 1–12 unique times in HH:mm format separated by commas.','invalidZone':'Enter an IANA time zone or UTC±HH:MM.','recordDose':'Record dose','taken':'Taken','omitted':'Omitted','postponed':'Postponed','intakeConfirm':'Record this status as patient-reported? This does not change the prescription.','confirm':'Confirm','save':'Save','cancel':'Cancel'
    },
    CarePointLocale.ar: {
      'title':'تذكيرات الدواء','intro':'أنشئ تذكيرات اختيارية للأدوية النشطة أو الوصفات الموقعة. إعدادات التذكير لا تعدّل الدواء أو الوصفة.','refresh':'تحديث','empty':'لا يوجد مصدر دواء نشط.','medication':'دواء','medicationStatement':'بيان دواء','patientStatement':'بيان دواء للمريض','prescription':'وصفة','signedPrescription':'وصفة موقعة','prescriptionSource':'المصدر: وصفة موقعة','statementSource':'المصدر: بيان دواء نشط','schedule':'الجدول','create':'إنشاء تذكير','edit':'تعديل الجدول','enabled':'التذكير مفعّل','disabled':'التذكير معطّل','times':'أوقات التذكير المحلية','timeZone':'المنطقة الزمنية','privacy':'تستخدم الإشعارات رسالة تذكير عامة ولا تنسخ اسم الدواء أو الجرعة إلى حمولة الإشعار الخارجية.','invalidTimes':'استخدم 1–12 وقتاً فريداً بصيغة HH:mm مفصولة بفواصل.','invalidZone':'أدخل منطقة IANA أو UTC±HH:MM.','recordDose':'تسجيل الجرعة','taken':'تم تناولها','omitted':'تم تجاوزها','postponed':'تم تأجيلها','intakeConfirm':'تسجيل هذه الحالة كبيان من المريض؟ هذا لا يغيّر الوصفة.','confirm':'تأكيد','save':'حفظ','cancel':'إلغاء'
    },
    CarePointLocale.fr: {
      'title':'Rappels de médicaments','intro':'Créez des rappels volontaires pour les traitements actifs ou ordonnances signées. Les réglages ne modifient jamais le traitement ni l’ordonnance.','refresh':'Actualiser','empty':'Aucune source médicamenteuse active.','medication':'Médicament','medicationStatement':'Traitement déclaré','patientStatement':'Traitement déclaré par le patient','prescription':'Ordonnance','signedPrescription':'Ordonnance signée','prescriptionSource':'Source : ordonnance signée','statementSource':'Source : traitement actif','schedule':'Horaire','create':'Créer un rappel','edit':'Modifier l’horaire','enabled':'Rappel activé','disabled':'Rappel désactivé','times':'Heures locales de rappel','timeZone':'Fuseau horaire','privacy':'Les notifications utilisent un message générique; le nom et la dose du médicament ne sont pas copiés dans la charge externe.','invalidTimes':'Utilisez 1 à 12 heures uniques au format HH:mm séparées par des virgules.','invalidZone':'Entrez un fuseau IANA ou UTC±HH:MM.','recordDose':'Enregistrer la prise','taken':'Prise','omitted':'Omission','postponed':'Reportée','intakeConfirm':'Enregistrer ce statut comme déclaré par le patient ? Cela ne modifie pas l’ordonnance.','confirm':'Confirmer','save':'Enregistrer','cancel':'Annuler'
    },
    CarePointLocale.es: {
      'title':'Recordatorios de medicación','intro':'Crea recordatorios voluntarios para medicación activa o recetas firmadas. La configuración del recordatorio nunca modifica la medicación ni la receta.','refresh':'Actualizar','empty':'No hay ninguna fuente de medicación activa.','medication':'Medicamento','medicationStatement':'Medicamento declarado','patientStatement':'Medicamento declarado por el paciente','prescription':'Receta','signedPrescription':'Receta firmada','prescriptionSource':'Origen: receta firmada','statementSource':'Origen: medicamento activo','schedule':'Horario','create':'Crear recordatorio','edit':'Editar horario','enabled':'Recordatorio activo','disabled':'Recordatorio desactivado','times':'Horas locales del recordatorio','timeZone':'Zona horaria','privacy':'Las notificaciones usan un mensaje genérico; el nombre y la dosis no se copian al payload externo.','invalidTimes':'Usa entre 1 y 12 horas únicas HH:mm separadas por comas.','invalidZone':'Introduce una zona IANA o UTC±HH:MM.','recordDose':'Registrar dosis','taken':'Tomada','omitted':'Omitida','postponed':'Pospuesta','intakeConfirm':'¿Registrar este estado como declarado por el paciente? Esto no modifica la receta.','confirm':'Confirmar','save':'Guardar','cancel':'Cancelar'
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
