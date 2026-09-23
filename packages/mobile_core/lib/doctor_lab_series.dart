import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorLabSeriesPage extends StatefulWidget {
  const DoctorLabSeriesPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorLabSeriesPage> createState() => _DoctorLabSeriesPageState();
}

class _DoctorLabSeriesPageState extends State<DoctorLabSeriesPage> {
  bool busy = true;
  String? error;
  Map<String, dynamic> payload = const {};

  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final next = await api.doctorPatientLabSeries(widget.patientId);
      if (next['automatedClinicalInference'] != false) {
        throw StateError(doctorLabSeriesText(locale, 'unsafeProjection'));
      }
      if (mounted) setState(() => payload = next);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(doctorLabSeriesText(locale, 'title')),
          actions: [
            IconButton(
              onPressed: busy ? null : load,
              tooltip: doctorLabSeriesText(locale, 'refresh'),
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: busy && payload.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _summaryCard(),
                    if (error != null) ...[
                      const SizedBox(height: 12),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    if (_series.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(30),
                        child: Text(
                          doctorLabSeriesText(locale, 'empty'),
                          textAlign: TextAlign.center,
                        ),
                      )
                    else
                      ..._series.map(_seriesCard),
                  ],
                ),
              ),
      );

  List<Map<String, dynamic>> get _series => _maps(payload['series']);

  Widget _summaryCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.science_outlined),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  doctorLabSeriesText(locale, 'validatedOnly'),
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            Text('${doctorLabSeriesText(locale, 'accessBasis')}: ${payload['accessBasis'] ?? '—'}'),
            Text('${doctorLabSeriesText(locale, 'seriesCount')}: ${_series.length}'),
            Text('${doctorLabSeriesText(locale, 'pointCount')}: ${payload['pointCount'] ?? 0}'),
            const SizedBox(height: 8),
            Text(
              doctorLabSeriesText(locale, 'noInference'),
              style: const TextStyle(fontSize: 12),
            ),
          ]),
        ),
      );

  Widget _seriesCard(Map<String, dynamic> series) {
    final points = _maps(series['points']);
    final numericValues = <double>[];
    for (final point in points) {
      final raw = point['value'];
      if (raw is num) {
        numericValues.add(raw.toDouble());
      } else {
        final parsed = double.tryParse(raw?.toString() ?? '');
        if (parsed != null && parsed.isFinite) numericValues.add(parsed);
      }
    }
    final code = [series['codeSystem'], series['code']]
        .where((value) => value?.toString().trim().isNotEmpty == true)
        .map((value) => value.toString())
        .join(' · ');

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(
            series['display']?.toString() ?? doctorLabSeriesText(locale, 'analyte'),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
          ),
          if (code.isNotEmpty) Text(code),
          Text('${doctorLabSeriesText(locale, 'unit')}: ${series['unit'] ?? '—'}'),
          if (numericValues.length >= 2) ...[
            const SizedBox(height: 14),
            SizedBox(
              height: 120,
              child: CustomPaint(
                painter: _LabSeriesPainter(
                  values: numericValues,
                  color: Theme.of(context).colorScheme.primary,
                  gridColor: Theme.of(context).dividerColor,
                ),
                child: const SizedBox.expand(),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              doctorLabSeriesText(locale, 'descriptiveChart'),
              style: const TextStyle(fontSize: 12),
            ),
          ],
          const Divider(height: 24),
          Text(
            doctorLabSeriesText(locale, 'sourceValues'),
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          ...points.reversed.map(_pointTile),
        ]),
      ),
    );
  }

  Widget _pointTile(Map<String, dynamic> point) {
    final when = _dateTime(point['releasedAt'] ?? point['validatedAt'] ?? point['observedAt']);
    final value = point['value']?.toString() ?? '—';
    final unit = point['unit']?.toString().trim() ?? '';
    final range = point['referenceRange']?.toString().trim() ?? '';
    final flag = point['flag']?.toString().trim() ?? '';
    final status = point['status']?.toString() ?? '—';
    final source = [
      if (point['laboratoryResultId']?.toString().isNotEmpty == true)
        '${doctorLabSeriesText(locale, 'resultId')}: ${point['laboratoryResultId']}',
      if (point['orderId']?.toString().isNotEmpty == true)
        '${doctorLabSeriesText(locale, 'orderId')}: ${point['orderId']}',
    ].join('\n');

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.biotech_outlined),
      title: Text('$value${unit.isEmpty ? '' : ' $unit'}', style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text([
        when,
        '${doctorLabSeriesText(locale, 'status')}: $status',
        '${doctorLabSeriesText(locale, 'referenceRange')}: ${range.isEmpty ? '—' : range}',
        if (flag.isNotEmpty) '${doctorLabSeriesText(locale, 'sourceFlag')}: $flag',
        source,
      ].where((line) => line.isNotEmpty).join('\n')),
      isThreeLine: true,
    );
  }

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
  }
}

class _LabSeriesPainter extends CustomPainter {
  const _LabSeriesPainter({
    required this.values,
    required this.color,
    required this.gridColor,
  });

  final List<double> values;
  final Color color;
  final Color gridColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2 || size.width <= 0 || size.height <= 0) return;
    var minValue = values.first;
    var maxValue = values.first;
    for (final value in values.skip(1)) {
      if (value < minValue) minValue = value;
      if (value > maxValue) maxValue = value;
    }
    final span = maxValue - minValue;
    const padding = 8.0;
    final width = math.max(1.0, size.width - (padding * 2)).toDouble();
    final height = math.max(1.0, size.height - (padding * 2)).toDouble();

    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var row = 0; row <= 2; row += 1) {
      final y = padding + (height * row / 2);
      canvas.drawLine(Offset(padding, y), Offset(padding + width, y), gridPaint);
    }

    final path = Path();
    final pointPaint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;
    final linePaint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    for (var index = 0; index < values.length; index += 1) {
      final x = padding + width * index / (values.length - 1);
      final normalized = span == 0 ? .5 : (values[index] - minValue) / span;
      final y = padding + height * (1 - normalized);
      if (index == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
      canvas.drawCircle(Offset(x, y), 3, pointPaint);
    }
    canvas.drawPath(path, linePaint);
  }

  @override
  bool shouldRepaint(covariant _LabSeriesPainter oldDelegate) =>
      oldDelegate.values != values || oldDelegate.color != color || oldDelegate.gridColor != gridColor;
}

String doctorLabSeriesText(CarePointLocale locale, String key) =>
    _doctorLabSeriesCopy[locale]?[key] ??
    _doctorLabSeriesCopy[CarePointLocale.en]?[key] ??
    key;

const Map<CarePointLocale, Map<String, String>> _doctorLabSeriesCopy = {
  CarePointLocale.en: {
    'title': 'Laboratory series',
    'refresh': 'Refresh',
    'validatedOnly': 'Validated / released laboratory series',
    'accessBasis': 'Access basis',
    'seriesCount': 'Series',
    'pointCount': 'Source results',
    'noInference': 'Charts are descriptive only. CarePoint does not infer diagnosis, improvement or deterioration from these values.',
    'empty': 'No validated or released serial laboratory values are available for this authorized patient.',
    'analyte': 'Analyte',
    'unit': 'Unit',
    'descriptiveChart': 'Numeric values over time. Open the source values below for exact range and provenance.',
    'sourceValues': 'Source values',
    'status': 'Result status',
    'referenceRange': 'Source reference range',
    'sourceFlag': 'Source flag',
    'resultId': 'Laboratory result ID',
    'orderId': 'Order ID',
    'missingPatient': 'The appointment does not contain a patient identifier.',
    'unsafeProjection': 'Laboratory-series projection did not declare inference disabled.',
  },
  CarePointLocale.ar: {
    'title': 'سلاسل نتائج المختبر',
    'refresh': 'تحديث',
    'validatedOnly': 'سلاسل مختبرية موثقة / محررة',
    'accessBasis': 'أساس الوصول',
    'seriesCount': 'السلاسل',
    'pointCount': 'النتائج المصدرية',
    'noInference': 'الرسوم وصفية فقط. لا يستنتج CarePoint تشخيصاً أو تحسناً أو تدهوراً من هذه القيم.',
    'empty': 'لا توجد قيم مختبرية متسلسلة موثقة أو محررة لهذا المريض المصرح به.',
    'analyte': 'التحليل',
    'unit': 'الوحدة',
    'descriptiveChart': 'قيم رقمية عبر الزمن. راجع القيم المصدرية أدناه للنطاق والمرجعية الدقيقة.',
    'sourceValues': 'القيم المصدرية',
    'status': 'حالة النتيجة',
    'referenceRange': 'النطاق المرجعي للمصدر',
    'sourceFlag': 'علامة المصدر',
    'resultId': 'معرف نتيجة المختبر',
    'orderId': 'معرف الطلب',
    'missingPatient': 'الموعد لا يحتوي على معرف المريض.',
    'unsafeProjection': 'عرض سلسلة المختبر لم يصرح بأن الاستنتاج السريري معطل.',
  },
  CarePointLocale.fr: {
    'title': 'Séries de laboratoire',
    'refresh': 'Actualiser',
    'validatedOnly': 'Séries de laboratoire validées / libérées',
    'accessBasis': 'Base d’accès',
    'seriesCount': 'Séries',
    'pointCount': 'Résultats sources',
    'noInference': 'Les graphiques sont uniquement descriptifs. CarePoint ne déduit ni diagnostic, ni amélioration, ni aggravation de ces valeurs.',
    'empty': 'Aucune valeur de laboratoire sériée validée ou libérée n’est disponible pour ce patient autorisé.',
    'analyte': 'Analyte',
    'unit': 'Unité',
    'descriptiveChart': 'Valeurs numériques dans le temps. Les valeurs sources ci-dessous conservent la plage et la provenance exactes.',
    'sourceValues': 'Valeurs sources',
    'status': 'Statut du résultat',
    'referenceRange': 'Intervalle de référence source',
    'sourceFlag': 'Indicateur source',
    'resultId': 'ID résultat laboratoire',
    'orderId': 'ID ordre',
    'missingPatient': 'Le rendez-vous ne contient pas d’identifiant patient.',
    'unsafeProjection': 'La projection des séries de laboratoire n’a pas déclaré l’inférence désactivée.',
  },
  CarePointLocale.es: {
    'title': 'Series de laboratorio',
    'refresh': 'Actualizar',
    'validatedOnly': 'Series de laboratorio validadas / liberadas',
    'accessBasis': 'Base de acceso',
    'seriesCount': 'Series',
    'pointCount': 'Resultados fuente',
    'noInference': 'Las gráficas son solo descriptivas. CarePoint no infiere diagnóstico, mejoría ni deterioro a partir de estos valores.',
    'empty': 'No hay valores seriados de laboratorio validados o liberados para este paciente autorizado.',
    'analyte': 'Analito',
    'unit': 'Unidad',
    'descriptiveChart': 'Valores numéricos en el tiempo. Abre los valores fuente para ver rango y procedencia exactos.',
    'sourceValues': 'Valores fuente',
    'status': 'Estado del resultado',
    'referenceRange': 'Intervalo de referencia de origen',
    'sourceFlag': 'Indicador de origen',
    'resultId': 'ID de resultado de laboratorio',
    'orderId': 'ID de orden',
    'missingPatient': 'La cita no contiene identificador de paciente.',
    'unsafeProjection': 'La proyección de series de laboratorio no declaró la inferencia desactivada.',
  },
};

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}
