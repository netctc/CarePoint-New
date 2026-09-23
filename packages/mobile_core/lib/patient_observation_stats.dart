import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientObservationStatsPage extends StatefulWidget {
  const PatientObservationStatsPage({
    super.key,
    required this.session,
    required this.locale,
  });

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientObservationStatsPage> createState() => _PatientObservationStatsPageState();
}

class _PatientObservationStatsPageState extends State<PatientObservationStatsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> catalog = const [];
  String? selectedCode;
  String selectedPeriod = '30D';
  Map<String, dynamic> stats = const {};

  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final payload = await api.patientObservationCatalog();
      final items = _maps(payload['items']);
      final nextCode = selectedCode != null && items.any((item) => item['code']?.toString() == selectedCode)
          ? selectedCode
          : (items.isEmpty ? null : items.first['code']?.toString());
      if (!mounted) return;
      setState(() {
        catalog = items;
        selectedCode = nextCode;
      });
      if (nextCode != null && nextCode.isNotEmpty) {
        await _loadStats();
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _loadStats() async {
    final code = selectedCode;
    if (code == null || code.isEmpty) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final range = _range(selectedPeriod);
      final payload = await api.patientObservationStats(
        code,
        from: range.$1?.toIso8601String(),
        to: range.$2?.toIso8601String(),
      );
      if (payload['automatedClinicalInference'] != false || payload['automatedDiagnosis'] != false) {
        throw StateError(patientObservationStatsText(locale, 'unsafeProjection'));
      }
      if (mounted) setState(() => stats = payload);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(patientObservationStatsText(locale, 'title')),
          actions: [
            IconButton(
              onPressed: loading ? null : _loadCatalog,
              icon: const Icon(Icons.refresh_outlined),
              tooltip: patientObservationStatsText(locale, 'refresh'),
            ),
          ],
        ),
        body: loading && catalog.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _safetyCard(),
                  const SizedBox(height: 12),
                  if (error != null) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (catalog.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(30),
                      child: Text(patientObservationStatsText(locale, 'emptyCatalog'), textAlign: TextAlign.center),
                    )
                  else ...[
                    DropdownButtonFormField<String>(
                      key: const ValueKey('patient-observation-stats-metric'),
                      initialValue: selectedCode,
                      decoration: InputDecoration(
                        labelText: patientObservationStatsText(locale, 'metric'),
                        border: const OutlineInputBorder(),
                      ),
                      items: catalog.map((item) => DropdownMenuItem(
                        value: item['code']?.toString(),
                        child: Text(_localized(item['labels'], item['code']?.toString() ?? '')),
                      )).toList(growable: false),
                      onChanged: loading ? null : (value) async {
                        setState(() {
                          selectedCode = value;
                          stats = const {};
                        });
                        await _loadStats();
                      },
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _periods.map((period) => ChoiceChip(
                        key: ValueKey('patient-observation-period-$period'),
                        selected: selectedPeriod == period,
                        label: Text(patientObservationStatsText(locale, 'period.$period')),
                        onSelected: loading ? null : (_) async {
                          setState(() {
                            selectedPeriod = period;
                            stats = const {};
                          });
                          await _loadStats();
                        },
                      )).toList(growable: false),
                    ),
                    const SizedBox(height: 16),
                    if (loading)
                      const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator()))
                    else if (_series.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(28),
                        child: Text(patientObservationStatsText(locale, 'emptyPeriod'), textAlign: TextAlign.center),
                      )
                    else ...[
                      _periodSummary(),
                      const SizedBox(height: 10),
                      ..._series.map(_seriesCard),
                    ],
                  ],
                ],
              ),
      );

  List<Map<String, dynamic>> get _series => _maps(stats['series']);

  Widget _safetyCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.info_outline),
            const SizedBox(width: 10),
            Expanded(child: Text(patientObservationStatsText(locale, 'safety'))),
          ]),
        ),
      );

  Widget _periodSummary() => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(patientObservationStatsText(locale, 'periodSummary'), style: const TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            Text('${patientObservationStatsText(locale, 'measurementCount')}: ${stats['measurementCount'] ?? 0}'),
            Text('${patientObservationStatsText(locale, 'period')}: ${patientObservationStatsText(locale, 'period.$selectedPeriod')}'),
            if (stats['unitConsistency'] == false)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(patientObservationStatsText(locale, 'multipleUnits')),
              ),
          ]),
        ),
      );

  Widget _seriesCard(Map<String, dynamic> series) => Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(
              series['canonicalUnitCode']?.toString() ?? '—',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            _row('latest', _number(series['latest'])),
            _row('minimum', _number(series['minimum'])),
            _row('maximum', _number(series['maximum'])),
            _row('average', _number(series['average'])),
            _row('measurementCount', series['count']?.toString() ?? '0'),
            _row('latestObservedAt', _dateTime(series['latestObservedAt'])),
          ]),
        ),
      );

  Widget _row(String key, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Expanded(child: Text(patientObservationStatsText(locale, key))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
        ]),
      );

  (DateTime?, DateTime?) _range(String period) {
    if (period == 'ALL') return (null, null);
    final now = DateTime.now().toUtc();
    final days = switch (period) {
      '7D' => 7,
      '30D' => 30,
      '3M' => 90,
      '6M' => 183,
      '1Y' => 365,
      _ => 30,
    };
    return (now.subtract(Duration(days: days)), now);
  }

  String _localized(dynamic value, String fallback) {
    final labels = _map(value);
    final localized = labels[locale.name]?.toString().trim() ?? '';
    if (localized.isNotEmpty) return localized;
    final english = labels['en']?.toString().trim() ?? '';
    return english.isNotEmpty ? english : fallback;
  }

  String _number(dynamic value) {
    if (value is num) return value.toString();
    return value?.toString() ?? '—';
  }

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
  }
}

const _periods = ['7D', '30D', '3M', '6M', '1Y', 'ALL'];

String patientObservationStatsText(CarePointLocale locale, String key) =>
    _patientObservationStatsCopy[locale]?[key] ??
    _patientObservationStatsCopy[CarePointLocale.en]?[key] ??
    key;

const Map<CarePointLocale, Map<String, String>> _patientObservationStatsCopy = {
  CarePointLocale.en: {
    'title':'Measurement summary','refresh':'Refresh','metric':'Measurement type',
    'safety':'This summary is descriptive only. It does not diagnose a condition or classify values as normal or abnormal.',
    'emptyCatalog':'No active measurement types are available.','emptyPeriod':'No measurements are available in this period.',
    'periodSummary':'Selected period','measurementCount':'Measurements','period':'Period',
    'multipleUnits':'This period contains more than one canonical unit. Statistics are shown separately by unit.',
    'latest':'Latest','minimum':'Minimum','maximum':'Maximum','average':'Average','latestObservedAt':'Latest measured at',
    'period.7D':'7 days','period.30D':'30 days','period.3M':'3 months','period.6M':'6 months','period.1Y':'1 year','period.ALL':'All',
    'unsafeProjection':'Observation statistics did not declare clinical inference disabled.',
  },
  CarePointLocale.ar: {
    'title':'ملخص القياسات','refresh':'تحديث','metric':'نوع القياس',
    'safety':'هذا الملخص وصفي فقط. لا يشخّص حالة ولا يصنّف القيم تلقائياً كطبيعية أو غير طبيعية.',
    'emptyCatalog':'لا توجد أنواع قياس نشطة.','emptyPeriod':'لا توجد قياسات في هذه الفترة.',
    'periodSummary':'الفترة المحددة','measurementCount':'عدد القياسات','period':'الفترة',
    'multipleUnits':'تحتوي الفترة على أكثر من وحدة معيارية. تُعرض الإحصاءات منفصلة حسب الوحدة.',
    'latest':'الأحدث','minimum':'الحد الأدنى','maximum':'الحد الأقصى','average':'المتوسط','latestObservedAt':'وقت أحدث قياس',
    'period.7D':'7 أيام','period.30D':'30 يوماً','period.3M':'3 أشهر','period.6M':'6 أشهر','period.1Y':'سنة','period.ALL':'الكل',
    'unsafeProjection':'إحصاءات القياس لم تصرّح بأن الاستنتاج السريري معطل.',
  },
  CarePointLocale.fr: {
    'title':'Résumé des mesures','refresh':'Actualiser','metric':'Type de mesure',
    'safety':'Ce résumé est uniquement descriptif. Il ne diagnostique pas et ne classe pas automatiquement les valeurs comme normales ou anormales.',
    'emptyCatalog':'Aucun type de mesure actif.','emptyPeriod':'Aucune mesure disponible sur cette période.',
    'periodSummary':'Période sélectionnée','measurementCount':'Mesures','period':'Période',
    'multipleUnits':'La période contient plusieurs unités canoniques. Les statistiques sont séparées par unité.',
    'latest':'Dernière','minimum':'Minimum','maximum':'Maximum','average':'Moyenne','latestObservedAt':'Dernière mesure le',
    'period.7D':'7 jours','period.30D':'30 jours','period.3M':'3 mois','period.6M':'6 mois','period.1Y':'1 an','period.ALL':'Tout',
    'unsafeProjection':'Les statistiques n’ont pas déclaré l’inférence clinique désactivée.',
  },
  CarePointLocale.es: {
    'title':'Resumen de mediciones','refresh':'Actualizar','metric':'Tipo de medición',
    'safety':'Este resumen es solo descriptivo. No diagnostica ni clasifica automáticamente los valores como normales o anormales.',
    'emptyCatalog':'No hay tipos de medición activos.','emptyPeriod':'No hay mediciones disponibles en este periodo.',
    'periodSummary':'Periodo seleccionado','measurementCount':'Mediciones','period':'Periodo',
    'multipleUnits':'El periodo contiene más de una unidad canónica. Las estadísticas se muestran separadas por unidad.',
    'latest':'Última','minimum':'Mínimo','maximum':'Máximo','average':'Promedio','latestObservedAt':'Última medición',
    'period.7D':'7 días','period.30D':'30 días','period.3M':'3 meses','period.6M':'6 meses','period.1Y':'1 año','period.ALL':'Todo',
    'unsafeProjection':'Las estadísticas no declararon la inferencia clínica desactivada.',
  },
};

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}
