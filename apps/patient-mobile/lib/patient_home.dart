import 'dart:math' as math;

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_medication_reminders.dart';
import 'package:carepoint_mobile_core/patient_observation_stats.dart';
import 'package:flutter/material.dart';

class PatientHomeDashboard extends StatefulWidget {
  const PatientHomeDashboard({
    super.key,
    required this.session,
    required this.locale,
    required this.onOpenVisits,
    this.header,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onOpenVisits;
  final Widget? header;

  @override
  State<PatientHomeDashboard> createState() => _PatientHomeDashboardState();
}

class _PatientHomeDashboardState extends State<PatientHomeDashboard> {
  bool loading = true;
  bool chartLoading = false;
  String? error;
  List<Map<String, dynamic>> appointments = const [];
  List<Map<String, dynamic>> reminders = const [];
  List<Map<String, dynamic>> catalog = const [];
  List<Map<String, dynamic>> measurements = const [];
  String? selectedMetric;

  CarePointApi get api => widget.session.api;
  String t(String key) => patientHomeText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        loading = true;
        error = null;
      });
    }
    try {
      final values = await Future.wait<dynamic>([
        api.myAppointments(),
        api.patientMedicationReminders(),
        api.patientObservationCatalog(),
      ]);
      final nextAppointments = _maps(values[0]);
      final nextReminders = _maps(_map(values[1])['items']);
      final nextCatalog = _maps(_map(values[2])['items']);
      final nextMetric = selectedMetric != null &&
              nextCatalog.any((item) => item['code']?.toString() == selectedMetric)
          ? selectedMetric
          : (nextCatalog.isEmpty ? null : nextCatalog.first['code']?.toString());

      if (!mounted) return;
      setState(() {
        appointments = nextAppointments;
        reminders = nextReminders;
        catalog = nextCatalog;
        selectedMetric = nextMetric;
      });
      if (nextMetric != null && nextMetric.isNotEmpty) {
        await _loadMeasurements(nextMetric);
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _loadMeasurements(String code) async {
    if (mounted) setState(() => chartLoading = true);
    try {
      final result = await api.patientObservationHistory(code, limit: 30);
      if (!mounted) return;
      setState(() => measurements = _maps(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => chartLoading = false);
    }
  }

  Map<String, dynamic>? get _nextAppointment {
    final now = DateTime.now();
    final candidates = appointments.where((item) {
      final status = item['status']?.toString().toUpperCase() ?? '';
      if (const {'CANCELLED', 'COMPLETED', 'NO_SHOW'}.contains(status)) return false;
      final startsAt = DateTime.tryParse(item['startsAt']?.toString() ?? '')?.toLocal();
      return startsAt != null && !startsAt.isBefore(now);
    }).toList(growable: false)
      ..sort((a, b) => (a['startsAt']?.toString() ?? '')
          .compareTo(b['startsAt']?.toString() ?? ''));
    return candidates.isEmpty ? null : candidates.first;
  }

  Map<String, dynamic>? get _selectedMetricRow {
    final code = selectedMetric;
    if (code == null) return null;
    for (final item in catalog) {
      if (item['code']?.toString() == code) return item;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          key: const ValueKey('patient-home-dashboard'),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (widget.header != null) ...[
              widget.header!,
              const SizedBox(height: 18),
            ],
            Text(
              t('title'),
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
            ),
            const SizedBox(height: 4),
            Text(t('subtitle'), style: const TextStyle(color: Color(0xFF64748B))),
            if (loading) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (error != null) ...[
              const SizedBox(height: 12),
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(children: [
                    const Icon(Icons.error_outline),
                    const SizedBox(width: 10),
                    Expanded(child: Text(error!)),
                    IconButton(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_outlined),
                    ),
                  ]),
                ),
              ),
            ],
            const SizedBox(height: 14),
            LayoutBuilder(
              builder: (context, constraints) {
                const gap = 12.0;
                final columns = constraints.maxWidth >= 1050 ? 2 : 1;
                final width =
                    (constraints.maxWidth - (columns - 1) * gap) / columns;
                return Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  children: [
                    SizedBox(width: width, child: _visitReminderCard()),
                    SizedBox(width: width, child: _medicationReminderCard()),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            _vitalsChartCard(),
            const SizedBox(height: 12),
            _addMeasurementCard(),
          ],
        ),
      );

  Widget _visitReminderCard() {
    final visit = _nextAppointment;
    final service = _map(visit?['service']);
    final provider = _map(visit?['provider']);
    final startsAt =
        DateTime.tryParse(visit?['startsAt']?.toString() ?? '')?.toLocal();
    return Card(
      key: const ValueKey('patient-home-next-visit'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _sectionHeader(Icons.event_available_outlined, t('visitReminder')),
            const SizedBox(height: 10),
            if (visit == null)
              Text(t('noUpcomingVisit'))
            else ...[
              Text(
                service['name']?.toString() ?? t('appointment'),
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17),
              ),
              const SizedBox(height: 4),
              Text(provider['displayName']?.toString() ?? ''),
              Text(
                startsAt == null ? '—' : _dateTime(startsAt),
                style: const TextStyle(
                  color: Color(0xFF475569),
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: widget.onOpenVisits,
                icon: const Icon(Icons.open_in_new_outlined),
                label: Text(t('openVisits')),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _medicationReminderCard() {
    final enabled =
        reminders.where((item) => item['enabled'] == true).toList(growable: false);
    return Card(
      key: const ValueKey('patient-home-medication-reminders'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _sectionHeader(Icons.medication_outlined, t('medicationReminder')),
            const SizedBox(height: 10),
            if (enabled.isEmpty)
              Text(t('noMedicationReminders'))
            else ...[
              Text(
                '\${enabled.length} \${t('activeReminders')}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              ...enabled.take(3).map((item) {
                final times = _strings(item['localTimes']);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    times.isEmpty ? t('reminderConfigured') : times.join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                );
              }),
            ],
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => Directionality(
                    textDirection: widget.locale.textDirection,
                    child: PatientMedicationRemindersPage(
                      session: widget.session,
                      locale: widget.locale,
                    ),
                  ),
                ),
              ).then((_) => _load()),
              icon: const Icon(Icons.alarm_outlined),
              label: Text(t('manageReminders')),
            ),
          ],
        ),
      ),
    );
  }

  Widget _vitalsChartCard() {
    final metric = _selectedMetricRow;
    final values = measurements
        .map((item) => _double(item['canonicalValue']) ?? _double(item['value']))
        .whereType<double>()
        .toList(growable: false);
    return Card(
      key: const ValueKey('patient-home-vitals-chart'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _sectionHeader(Icons.monitor_heart_outlined, t('vitalsGraph')),
            const SizedBox(height: 12),
            if (catalog.isEmpty)
              Text(t('noVitalTypes'))
            else ...[
              DropdownButtonFormField<String>(
                key: const ValueKey('patient-home-vitals-metric'),
                initialValue: selectedMetric,
                decoration: InputDecoration(
                  labelText: t('measurementType'),
                  border: const OutlineInputBorder(),
                ),
                items: catalog
                    .map(
                      (item) => DropdownMenuItem<String>(
                        value: item['code']?.toString(),
                        child: Text(_label(item)),
                      ),
                    )
                    .toList(growable: false),
                onChanged: chartLoading
                    ? null
                    : (value) async {
                        if (value == null) return;
                        setState(() {
                          selectedMetric = value;
                          measurements = const [];
                        });
                        await _loadMeasurements(value);
                      },
              ),
              const SizedBox(height: 12),
              if (chartLoading)
                const SizedBox(
                  height: 170,
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (values.isEmpty)
                SizedBox(
                  height: 150,
                  child: Center(child: Text(t('noMeasurements'))),
                )
              else ...[
                SizedBox(
                  height: 190,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: CustomPaint(
                        painter: _PatientVitalsPainter(values),
                        child: const SizedBox.expand(),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '\${t('latest')}: \${values.last.toStringAsFixed(_precision(metric))} '
                  '\${metric?['canonicalUnitCode'] ?? ''}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ],
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton.icon(
                  onPressed: () => Navigator.push<void>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => Directionality(
                        textDirection: widget.locale.textDirection,
                        child: PatientObservationStatsPage(
                          session: widget.session,
                          locale: widget.locale,
                        ),
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.analytics_outlined),
                  label: Text(t('fullVitals')),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _addMeasurementCard() {
    final metric = _selectedMetricRow;
    return Card(
      key: const ValueKey('patient-home-add-measurement'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _sectionHeader(Icons.add_chart_outlined, t('addMeasurement')),
            const SizedBox(height: 8),
            Text(
              t('addMeasurementHint'),
              style: const TextStyle(color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 12),
            FilledButton.tonalIcon(
              onPressed: metric == null ? null : () => _recordMeasurement(metric),
              icon: const Icon(Icons.add_circle_outline),
              label: Text(t('recordMeasurement')),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _recordMeasurement(Map<String, dynamic> initialMetric) async {
    String metricCode = initialMetric['code']?.toString() ?? '';
    String unitCode = _strings(initialMetric['allowedUnitCodes']).isNotEmpty
        ? _strings(initialMetric['allowedUnitCodes']).first
        : initialMetric['canonicalUnitCode']?.toString() ?? '';
    String glucoseContext = 'RANDOM';
    final valueController = TextEditingController();
    String? validation;

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) {
          Map<String, dynamic> metric = initialMetric;
          for (final item in catalog) {
            if (item['code']?.toString() == metricCode) {
              metric = item;
              break;
            }
          }
          final units = _strings(metric['allowedUnitCodes']);
          if (units.isNotEmpty && !units.contains(unitCode)) {
            unitCode = units.first;
          }
          final glucose = metricCode.toUpperCase().contains('GLUCOSE');
          return AlertDialog(
            title: Text(t('addMeasurement')),
            content: SizedBox(
              width: 460,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: metricCode,
                      decoration: InputDecoration(
                        labelText: t('measurementType'),
                        border: const OutlineInputBorder(),
                      ),
                      items: catalog
                          .map(
                            (item) => DropdownMenuItem<String>(
                              value: item['code']?.toString(),
                              child: Text(_label(item)),
                            ),
                          )
                          .toList(growable: false),
                      onChanged: (value) {
                        if (value == null) return;
                        setLocal(() {
                          metricCode = value;
                          validation = null;
                        });
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: valueController,
                      autofocus: true,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                        signed: true,
                      ),
                      decoration: InputDecoration(
                        labelText: t('value'),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: unitCode,
                      decoration: InputDecoration(
                        labelText: t('unit'),
                        border: const OutlineInputBorder(),
                      ),
                      items: units
                          .map(
                            (unit) => DropdownMenuItem(
                              value: unit,
                              child: Text(unit),
                            ),
                          )
                          .toList(growable: false),
                      onChanged: (value) =>
                          setLocal(() => unitCode = value ?? unitCode),
                    ),
                    if (glucose) ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: glucoseContext,
                        decoration: InputDecoration(
                          labelText: t('glucoseContext'),
                          border: const OutlineInputBorder(),
                        ),
                        items: const [
                          DropdownMenuItem(value: 'FASTING', child: Text('Fasting')),
                          DropdownMenuItem(value: 'PREPRANDIAL', child: Text('Before meal')),
                          DropdownMenuItem(value: 'POSTPRANDIAL', child: Text('After meal')),
                          DropdownMenuItem(value: 'RANDOM', child: Text('Random')),
                        ],
                        onChanged: (value) => setLocal(
                          () => glucoseContext = value ?? glucoseContext,
                        ),
                      ),
                    ],
                    if (validation != null) ...[
                      const SizedBox(height: 10),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: Text(
                          validation!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: Text(t('cancel')),
              ),
              FilledButton(
                onPressed: () {
                  final value = double.tryParse(valueController.text.trim());
                  if (value == null || unitCode.isEmpty || metricCode.isEmpty) {
                    setLocal(() => validation = t('invalidMeasurement'));
                    return;
                  }
                  Navigator.pop(dialogContext, true);
                },
                child: Text(t('save')),
              ),
            ],
          );
        },
      ),
    );

    if (accepted != true) {
      valueController.dispose();
      return;
    }
    final value = double.parse(valueController.text.trim());
    valueController.dispose();
    try {
      await api.recordPatientObservation(
        code: metricCode,
        value: value,
        unitCode: unitCode,
        observedAt: DateTime.now(),
        glucoseContext:
            metricCode.toUpperCase().contains('GLUCOSE') ? glucoseContext : null,
      );
      if (!mounted) return;
      setState(() => selectedMetric = metricCode);
      await _loadMeasurements(metricCode);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(t('measurementSaved'))),
        );
      }
    } catch (value) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(value.toString())),
        );
      }
    }
  }

  Widget _sectionHeader(IconData icon, String title) => Row(
        children: [
          CircleAvatar(
            backgroundColor: Theme.of(context).colorScheme.primaryContainer,
            child: Icon(icon),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
          ),
        ],
      );

  String _label(Map<String, dynamic> item) {
    final labels = _map(item['labels']);
    return labels[widget.locale.name]?.toString() ??
        labels['en']?.toString() ??
        item['code']?.toString() ??
        '';
  }

  int _precision(Map<String, dynamic>? metric) {
    final raw = metric?['precision'];
    final parsed = raw is num ? raw.toInt() : int.tryParse(raw?.toString() ?? '');
    return (parsed ?? 1).clamp(0, 3);
  }

  String _dateTime(DateTime value) {
    final local = value.toLocal();
    String two(int item) => item.toString().padLeft(2, '0');
    return '\${local.year}-\${two(local.month)}-\${two(local.day)} '
        '\${two(local.hour)}:\${two(local.minute)}';
  }
}

class _PatientVitalsPainter extends CustomPainter {
  const _PatientVitalsPainter(this.values);

  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty || size.width <= 0 || size.height <= 0) return;
    final minValue = values.reduce(math.min);
    final maxValue = values.reduce(math.max);
    final spread = (maxValue - minValue).abs();
    final minY = spread == 0 ? minValue - 1 : minValue;
    final maxY = spread == 0 ? maxValue + 1 : maxValue;
    final chartHeight = math.max(1.0, size.height - 12);
    final chartWidth = math.max(1.0, size.width - 4);

    final grid = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..strokeWidth = 1;
    for (var i = 0; i <= 4; i++) {
      final y = chartHeight * i / 4 + 4;
      canvas.drawLine(Offset(0, y), Offset(chartWidth, y), grid);
    }

    final path = Path();
    for (var index = 0; index < values.length; index++) {
      final x = values.length == 1
          ? chartWidth / 2
          : chartWidth * index / (values.length - 1);
      final normalized = (values[index] - minY) / (maxY - minY);
      final y = chartHeight - normalized * chartHeight + 4;
      if (index == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    final line = Paint()
      ..color = const Color(0xFF0284C7)
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(path, line);

    final point = Paint()
      ..color = const Color(0xFF0369A1)
      ..style = PaintingStyle.fill;
    for (var index = 0; index < values.length; index++) {
      final x = values.length == 1
          ? chartWidth / 2
          : chartWidth * index / (values.length - 1);
      final normalized = (values[index] - minY) / (maxY - minY);
      final y = chartHeight - normalized * chartHeight + 4;
      canvas.drawCircle(Offset(x, y), 3, point);
    }
  }

  @override
  bool shouldRepaint(covariant _PatientVitalsPainter oldDelegate) {
    if (oldDelegate.values.length != values.length) return true;
    for (var i = 0; i < values.length; i++) {
      if (oldDelegate.values[i] != values[i]) return true;
    }
    return false;
  }
}

String patientHomeText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title': 'Home',
      'subtitle': 'Your most important care information at a glance.',
      'visitReminder': 'Visit reminder',
      'appointment': 'Appointment',
      'noUpcomingVisit': 'No upcoming appointment.',
      'openVisits': 'Open my visits',
      'medicationReminder': 'Medication reminder',
      'noMedicationReminders': 'No active medication reminders.',
      'activeReminders': 'active reminders',
      'reminderConfigured': 'Reminder configured',
      'manageReminders': 'Manage medication reminders',
      'vitalsGraph': 'Vitals measurements',
      'measurementType': 'Measurement type',
      'noVitalTypes': 'No measurement types are configured.',
      'noMeasurements': 'No measurements for this type yet.',
      'latest': 'Latest',
      'fullVitals': 'Open detailed vitals',
      'addMeasurement': 'Add new measurement',
      'addMeasurementHint': 'Record a patient-declared measurement using a configured vital type and unit.',
      'recordMeasurement': 'Record measurement',
      'value': 'Value',
      'unit': 'Unit',
      'glucoseContext': 'Glucose context',
      'invalidMeasurement': 'Enter a valid measurement value and unit.',
      'measurementSaved': 'Measurement saved.',
      'cancel': 'Cancel',
      'save': 'Save',
    },
    CarePointLocale.es: {
      'title': 'Inicio',
      'subtitle': 'La información asistencial más importante de un vistazo.',
      'visitReminder': 'Recordatorio de visita',
      'appointment': 'Cita',
      'noUpcomingVisit': 'No hay una próxima cita.',
      'openVisits': 'Abrir mis visitas',
      'medicationReminder': 'Recordatorio de medicación',
      'noMedicationReminders': 'No hay recordatorios de medicación activos.',
      'activeReminders': 'recordatorios activos',
      'reminderConfigured': 'Recordatorio configurado',
      'manageReminders': 'Gestionar recordatorios',
      'vitalsGraph': 'Mediciones de signos vitales',
      'measurementType': 'Tipo de medición',
      'noVitalTypes': 'No hay tipos de medición configurados.',
      'noMeasurements': 'Todavía no hay mediciones de este tipo.',
      'latest': 'Última',
      'fullVitals': 'Abrir signos vitales detallados',
      'addMeasurement': 'Añadir nueva medición',
      'addMeasurementHint': 'Registra una medición declarada por el paciente usando un tipo y unidad configurados.',
      'recordMeasurement': 'Registrar medición',
      'value': 'Valor',
      'unit': 'Unidad',
      'glucoseContext': 'Contexto de glucosa',
      'invalidMeasurement': 'Introduce un valor y una unidad válidos.',
      'measurementSaved': 'Medición guardada.',
      'cancel': 'Cancelar',
      'save': 'Guardar',
    },
    CarePointLocale.fr: {
      'title': 'Accueil',
      'subtitle': 'Vos informations de soins essentielles en un coup d’œil.',
      'visitReminder': 'Rappel de visite',
      'appointment': 'Rendez-vous',
      'noUpcomingVisit': 'Aucun prochain rendez-vous.',
      'openVisits': 'Ouvrir mes visites',
      'medicationReminder': 'Rappel de médicament',
      'noMedicationReminders': 'Aucun rappel de médicament actif.',
      'activeReminders': 'rappels actifs',
      'reminderConfigured': 'Rappel configuré',
      'manageReminders': 'Gérer les rappels',
      'vitalsGraph': 'Mesures des constantes',
      'measurementType': 'Type de mesure',
      'noVitalTypes': 'Aucun type de mesure configuré.',
      'noMeasurements': 'Aucune mesure de ce type.',
      'latest': 'Dernière',
      'fullVitals': 'Ouvrir les constantes détaillées',
      'addMeasurement': 'Ajouter une mesure',
      'addMeasurementHint': 'Enregistrez une mesure déclarée par le patient avec un type et une unité configurés.',
      'recordMeasurement': 'Enregistrer la mesure',
      'value': 'Valeur',
      'unit': 'Unité',
      'glucoseContext': 'Contexte glycémique',
      'invalidMeasurement': 'Saisissez une valeur et une unité valides.',
      'measurementSaved': 'Mesure enregistrée.',
      'cancel': 'Annuler',
      'save': 'Enregistrer',
    },
    CarePointLocale.ar: {
      'title': 'الرئيسية',
      'subtitle': 'أهم معلومات الرعاية في مكان واحد.',
      'visitReminder': 'تذكير بالزيارة',
      'appointment': 'موعد',
      'noUpcomingVisit': 'لا يوجد موعد قادم.',
      'openVisits': 'فتح زياراتي',
      'medicationReminder': 'تذكير الدواء',
      'noMedicationReminders': 'لا توجد تذكيرات دوائية نشطة.',
      'activeReminders': 'تذكيرات نشطة',
      'reminderConfigured': 'تم إعداد التذكير',
      'manageReminders': 'إدارة تذكيرات الدواء',
      'vitalsGraph': 'قياسات العلامات الحيوية',
      'measurementType': 'نوع القياس',
      'noVitalTypes': 'لا توجد أنواع قياس مهيأة.',
      'noMeasurements': 'لا توجد قياسات لهذا النوع بعد.',
      'latest': 'الأحدث',
      'fullVitals': 'فتح تفاصيل العلامات الحيوية',
      'addMeasurement': 'إضافة قياس جديد',
      'addMeasurementHint': 'سجّل قياساً يصرح به المريض باستخدام نوع ووحدة مهيأة.',
      'recordMeasurement': 'تسجيل القياس',
      'value': 'القيمة',
      'unit': 'الوحدة',
      'glucoseContext': 'سياق قياس السكر',
      'invalidMeasurement': 'أدخل قيمة ووحدة صحيحتين.',
      'measurementSaved': 'تم حفظ القياس.',
      'cancel': 'إلغاء',
      'save': 'حفظ',
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value
      .map(_map)
      .where((item) => item.isNotEmpty)
      .toList(growable: false);
}

List<String> _strings(dynamic value) {
  if (value is! List) return const [];
  return value
      .map((item) => item.toString())
      .where((item) => item.trim().isNotEmpty)
      .toList(growable: false);
}

double? _double(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '');
}
