import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorGlucoseTrendsPage extends StatefulWidget {
  const DoctorGlucoseTrendsPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorGlucoseTrendsPage> createState() => _DoctorGlucoseTrendsPageState();
}

class _DoctorGlucoseTrendsPageState extends State<DoctorGlucoseTrendsPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> payload = const {};
  String? code;
  String sourceType = 'ALL';
  int? days = 90;

  String t(String key) => doctorGlucoseTrendText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final now = DateTime.now().toUtc();
      final next = await widget.session.api.doctorGlucoseTrends(
        widget.patientId,
        code: code,
        from: days == null ? null : now.subtract(Duration(days: days!)),
        to: now,
        sourceType: sourceType == 'ALL' ? null : sourceType,
      );
      if (!mounted) return;
      final available = _strings(next['availableMetricCodes']);
      setState(() {
        payload = next;
        code = next['code']?.toString() ?? (available.isEmpty ? null : available.first);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final series = _maps(payload['series']);
    final table = _maps(payload['table']);
    final overlays = _map(payload['overlays']);
    return Scaffold(
      appBar: AppBar(
        title: Text(t('title')),
        actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 28),
          children: [
            Card(child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.info_outline),
                const SizedBox(width: 10),
                Expanded(child: Text(t('descriptiveOnly'))),
              ]),
            )),
            const SizedBox(height: 10),
            _filters(_strings(payload['availableMetricCodes'])),
            if (loading) const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator())),
            if (error != null) Card(child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            )),
            if (!loading && error == null && table.isEmpty)
              Padding(padding: const EdgeInsets.all(28), child: Text(t('empty'), textAlign: TextAlign.center)),
            if (series.isNotEmpty) ...[
              const SizedBox(height: 10),
              ...series.map(_seriesCard),
            ],
            if (table.isNotEmpty) ...[
              const SizedBox(height: 14),
              _heading(t('readings'), Icons.table_chart_outlined),
              ...table.reversed.map(_reading),
            ],
            const SizedBox(height: 14),
            _overlay(t('medications'), _map(overlays['medicationStatements']), Icons.medication_outlined),
            const SizedBox(height: 10),
            _overlay(t('prescriptions'), _map(overlays['prescriptions']), Icons.receipt_long_outlined),
          ],
        ),
      ),
    );
  }

  Widget _filters(List<String> available) => Card(child: Padding(
    padding: const EdgeInsets.all(12),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (available.length > 1) DropdownButtonFormField<String>(
        initialValue: available.contains(code) ? code : null,
        decoration: InputDecoration(labelText: t('metric'), border: const OutlineInputBorder()),
        items: available.map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(growable: false),
        onChanged: loading ? null : (value) async { setState(() => code = value); await _load(); },
      ),
      if (available.length > 1) const SizedBox(height: 10),
      Text(t('period'), style: const TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      Wrap(spacing: 6, runSpacing: 6, children: [
        _period(30, '30D'),
        _period(90, '90D'),
        _period(365, '365D'),
        ChoiceChip(
          label: Text(t('all')),
          selected: days == null,
          onSelected: loading ? null : (_) async { setState(() => days = null); await _load(); },
        ),
      ]),
      const SizedBox(height: 10),
      Text(t('source'), style: const TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      Wrap(spacing: 6, runSpacing: 6, children: ['ALL','MANUAL','DEVICE','PROVIDER'].map((value) => ChoiceChip(
        label: Text(value == 'ALL' ? t('all') : value),
        selected: sourceType == value,
        onSelected: loading ? null : (_) async { setState(() => sourceType = value); await _load(); },
      )).toList(growable: false)),
    ]),
  ));

  Widget _period(int value, String label) => ChoiceChip(
    label: Text(label),
    selected: days == value,
    onSelected: loading ? null : (_) async { setState(() => days = value); await _load(); },
  );

  Widget _seriesCard(Map<String, dynamic> item) {
    final points = _maps(item['points']).map(_GlucosePoint.from).whereType<_GlucosePoint>().toList(growable: false);
    return Card(child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${item['canonicalUnitCode'] ?? ''} · ${item['count'] ?? points.length} ${t('points')}',
            style: const TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 10),
        if (points.length >= 2)
          SizedBox(
            height: 170,
            child: CustomPaint(
              key: ValueKey('doctor-glucose-chart-${item['canonicalUnitCode']}'),
              painter: _GlucosePainter(
                points: points,
                lineColor: Theme.of(context).colorScheme.primary,
                gridColor: Theme.of(context).colorScheme.outlineVariant,
              ),
            ),
          )
        else
          Text(t('chartUnavailable'), style: const TextStyle(color: Color(0xFF64748B))),
        const SizedBox(height: 8),
        Text('${t('range')}: ${item['minimum'] ?? '—'} – ${item['maximum'] ?? '—'} · ${t('average')}: ${item['average'] ?? '—'}',
            style: const TextStyle(color: Color(0xFF64748B))),
      ]),
    ));
  }

  Widget _reading(Map<String, dynamic> item) {
    final contextCode = item['glucoseContext']?.toString();
    return Card(child: ListTile(
      leading: const Icon(Icons.water_drop_outlined),
      title: Text('${item['value'] ?? '—'} ${item['unitCode'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text([
        _date(item['observedAt']),
        '${t('context')}: ${contextCode == null ? '—' : t(contextCode)}',
        '${t('canonical')}: ${item['canonicalValue'] ?? '—'} ${item['canonicalUnitCode'] ?? ''}',
        '${t('source')}: ${item['sourceType'] ?? '—'}',
        '${t('verification')}: ${item['verificationStatus'] ?? '—'}',
      ].join('\n')),
      isThreeLine: true,
    ));
  }

  Widget _overlay(String title, Map<String, dynamic> section, IconData icon) {
    final state = section['state']?.toString() ?? 'RESTRICTED';
    final items = _maps(section['items']);
    return Card(child: ExpansionTile(
      leading: Icon(icon),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text(state == 'AVAILABLE' ? '${t('available')} · ${items.length}' : t('restricted')),
      children: state != 'AVAILABLE'
          ? [Padding(padding: const EdgeInsets.all(14), child: Text(t('restrictedHint')))]
          : items.isEmpty
              ? [Padding(padding: const EdgeInsets.all(14), child: Text(t('noEvents')))]
              : items.map((item) => ListTile(
                  dense: true,
                  title: Text(item['label']?.toString() ?? item['kind']?.toString() ?? '—'),
                  subtitle: Text([
                    item['kind']?.toString() ?? '',
                    _date(item['occurredAt']),
                    if (item['status'] != null) '${t('status')}: ${item['status']}',
                    '${t('sourceLink')}: ${item['sourceId'] ?? '—'}',
                  ].where((value) => value.isNotEmpty).join('\n')),
                )).toList(growable: false),
    ));
  }

  Widget _heading(String title, IconData icon) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(children: [Icon(icon), const SizedBox(width: 8), Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900))]),
  );

  String _date(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
  }
}

class _GlucosePoint {
  const _GlucosePoint(this.value, this.context);
  final double value;
  final String? context;

  static _GlucosePoint? from(Map<String, dynamic> item) {
    final raw = item['canonicalValue'];
    final value = raw is num ? raw.toDouble() : double.tryParse(raw?.toString() ?? '');
    if (value == null || !value.isFinite) return null;
    return _GlucosePoint(value, item['glucoseContext']?.toString());
  }
}

class _GlucosePainter extends CustomPainter {
  const _GlucosePainter({required this.points, required this.lineColor, required this.gridColor});
  final List<_GlucosePoint> points;
  final Color lineColor;
  final Color gridColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;
    const inset = 12.0;
    final width = math.max(1.0, size.width - inset * 2);
    final height = math.max(1.0, size.height - inset * 2);
    final values = points.map((point) => point.value);
    final minValue = values.reduce(math.min);
    final maxValue = values.reduce(math.max);
    final span = maxValue == minValue ? 1.0 : maxValue - minValue;
    final grid = Paint()..color = gridColor..strokeWidth = 1;
    for (var row = 0; row <= 3; row++) {
      final y = inset + height * row / 3;
      canvas.drawLine(Offset(inset, y), Offset(inset + width, y), grid);
    }
    final line = Paint()..color = lineColor..style = PaintingStyle.stroke..strokeWidth = 2;
    final dot = Paint()..color = lineColor..style = PaintingStyle.fill;
    final path = Path();
    for (var i = 0; i < points.length; i++) {
      final x = inset + width * i / (points.length - 1);
      final y = inset + height * (1 - (points[i].value - minValue) / span);
      if (i == 0) { path.moveTo(x, y); } else { path.lineTo(x, y); }
      canvas.drawCircle(Offset(x, y), 3.5, dot);
    }
    canvas.drawPath(path, line);
  }

  @override
  bool shouldRepaint(covariant _GlucosePainter oldDelegate) =>
      oldDelegate.lineColor != lineColor ||
      oldDelegate.gridColor != gridColor ||
      oldDelegate.points.length != points.length ||
      List.generate(points.length, (i) =>
        oldDelegate.points[i].value != points[i].value ||
        oldDelegate.points[i].context != points[i].context).any((changed) => changed);
}

String doctorGlucoseTrendText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Glucose trends','descriptiveOnly':'Contextual glucose series are descriptive. Medication events are temporal overlays only and never imply cause, treatment effect, or diagnosis.','refresh':'Refresh','empty':'No authorized glucose readings are available for this period.','metric':'Glucose metric','period':'Period','source':'Source','all':'All','readings':'Readings','points':'points','chartUnavailable':'At least two numeric points are required for the chart.','range':'Range','average':'Average','context':'Meal context','canonical':'Canonical','verification':'Verification','medications':'Medication statements','prescriptions':'CarePoint prescriptions','available':'Available','restricted':'Restricted','restrictedHint':'This overlay is hidden because its own authorization domain is unavailable. Glucose access is unchanged.','noEvents':'No authorized overlay events.','status':'Status','sourceLink':'Source ID','FASTING':'Fasting','PREPRANDIAL':'Pre-meal','POSTPRANDIAL':'Post-meal','RANDOM':'Random'
    },
    CarePointLocale.ar: {
      'title':'اتجاهات سكر الدم','descriptiveOnly':'سلسلة سكر الدم السياقية وصفية فقط. أحداث الأدوية تراكبات زمنية ولا تعني سبباً أو تأثير علاج أو تشخيصاً.','refresh':'تحديث','empty':'لا توجد قراءات سكر مصرح بها لهذه الفترة.','metric':'مقياس السكر','period':'الفترة','source':'المصدر','all':'الكل','readings':'القراءات','points':'نقاط','chartUnavailable':'يلزم نقطتان رقميتان على الأقل للرسم.','range':'النطاق','average':'المتوسط','context':'سياق الوجبة','canonical':'القيمة المعيارية','verification':'التحقق','medications':'الأدوية المبلغ عنها','prescriptions':'وصفات CarePoint','available':'متاح','restricted':'مقيّد','restrictedHint':'هذا التراكب مخفي لأن نطاق التفويض الخاص به غير متاح. وصول السكر لا يتغير.','noEvents':'لا توجد أحداث مصرح بها.','status':'الحالة','sourceLink':'معرف المصدر','FASTING':'صائم','PREPRANDIAL':'قبل الوجبة','POSTPRANDIAL':'بعد الوجبة','RANDOM':'عشوائي'
    },
    CarePointLocale.fr: {
      'title':'Tendances glycémiques','descriptiveOnly':'Les séries glycémiques contextualisées sont descriptives. Les événements médicamenteux sont uniquement des repères temporels et n’impliquent ni causalité, ni effet thérapeutique, ni diagnostic.','refresh':'Actualiser','empty':'Aucune glycémie autorisée pour cette période.','metric':'Mesure glycémique','period':'Période','source':'Source','all':'Tous','readings':'Mesures','points':'points','chartUnavailable':'Au moins deux points numériques sont requis pour le graphique.','range':'Plage','average':'Moyenne','context':'Contexte repas','canonical':'Canonique','verification':'Vérification','medications':'Médicaments déclarés','prescriptions':'Prescriptions CarePoint','available':'Disponible','restricted':'Restreint','restrictedHint':'Cette superposition est masquée car son propre domaine d’autorisation est indisponible. L’accès aux glycémies reste inchangé.','noEvents':'Aucun événement autorisé.','status':'Statut','sourceLink':'ID source','FASTING':'À jeun','PREPRANDIAL':'Avant repas','POSTPRANDIAL':'Après repas','RANDOM':'Aléatoire'
    },
    CarePointLocale.es: {
      'title':'Tendencias de glucosa','descriptiveOnly':'Las series de glucosa contextualizadas son descriptivas. Los eventos de medicación son solo superposiciones temporales y no implican causa, efecto terapéutico ni diagnóstico.','refresh':'Actualizar','empty':'No hay lecturas de glucosa autorizadas para este periodo.','metric':'Métrica de glucosa','period':'Periodo','source':'Origen','all':'Todos','readings':'Lecturas','points':'puntos','chartUnavailable':'Se necesitan al menos dos puntos numéricos para la gráfica.','range':'Rango','average':'Media','context':'Contexto alimentario','canonical':'Canónico','verification':'Verificación','medications':'Medicaciones declaradas','prescriptions':'Recetas CarePoint','available':'Disponible','restricted':'Restringido','restrictedHint':'Esta superposición se oculta porque su propio dominio de autorización no está disponible. El acceso a glucosa no cambia.','noEvents':'No hay eventos autorizados.','status':'Estado','sourceLink':'ID de origen','FASTING':'Ayunas','PREPRANDIAL':'Preprandial','POSTPRANDIAL':'Postprandial','RANDOM':'Aleatoria'
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
