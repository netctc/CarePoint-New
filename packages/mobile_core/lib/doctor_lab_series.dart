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
  bool loading = true;
  String? error;
  String? accessBasis;
  List<Map<String, dynamic>> series = const [];

  String t(String key) => doctorLabSeriesText(widget.locale, key);

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
      final value = await widget.session.api.doctorLabSeries(widget.patientId);
      if (!mounted) return;
      setState(() {
        accessBasis = value['accessBasis']?.toString();
        series = _maps(value['series']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
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
    body: loading && series.isEmpty
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
                        const Icon(Icons.science_outlined),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '${t('subtitle')}${accessBasis == null ? '' : '\n${t('accessBasis')}: $accessBasis'}',
                          ),
                        ),
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
                if (series.isEmpty && error == null)
                  Padding(
                    padding: const EdgeInsets.all(28),
                    child: Text(t('empty'), textAlign: TextAlign.center),
                  )
                else
                  ...series.map(_seriesCard),
              ],
            ),
          ),
  );

  Widget _seriesCard(Map<String, dynamic> item) {
    final points = _maps(item['points']);
    final numeric = points
        .map(_NumericPoint.from)
        .whereType<_NumericPoint>()
        .toList(growable: false);
    final unit = item['unit']?.toString();
    return Card(
      child: ExpansionTile(
        initiallyExpanded: true,
        leading: const Icon(Icons.show_chart_outlined),
        title: Text(
          item['display']?.toString() ?? t('analyte'),
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text([
          if (item['codeSystem'] != null || item['code'] != null)
            '${item['codeSystem'] ?? ''} ${item['code'] ?? ''}'.trim(),
          if (unit?.isNotEmpty == true) '${t('unit')}: $unit',
          '${t('points')}: ${points.length}',
        ].where((value) => value.isNotEmpty).join(' · ')),
        children: [
          if (numeric.length >= 2)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
              child: SizedBox(
                height: 150,
                width: double.infinity,
                child: CustomPaint(
                  key: ValueKey('doctor-lab-series-chart-${item['key']}'),
                  painter: _LabSeriesPainter(
                    points: numeric,
                    lineColor: Theme.of(context).colorScheme.primary,
                    gridColor: Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
              ),
            ),
          if (numeric.length < 2)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Text(
                t('chartUnavailable'),
                style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
          ...points.reversed.map(_pointTile),
        ],
      ),
    );
  }

  Widget _pointTile(Map<String, dynamic> point) {
    final value = point['value']?.toString() ?? '—';
    final unit = point['unit']?.toString();
    final range = point['referenceRange']?.toString();
    final flag = point['flag']?.toString();
    final status = point['status']?.toString() ?? '';
    final source = '${point['laboratoryResultId'] ?? '—'} / ${point['orderId'] ?? '—'}';
    return ListTile(
      dense: true,
      leading: const Icon(Icons.biotech_outlined),
      title: Text(
        '$value${unit?.isNotEmpty == true ? ' $unit' : ''}',
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text([
        _dateTime(point['observedAt']),
        '${t('status')}: $status',
        if (range?.isNotEmpty == true) '${t('reference')}: $range',
        if (flag?.isNotEmpty == true) '${t('flag')}: $flag',
        '${t('source')}: $source',
      ].join('\n')),
      isThreeLine: true,
    );
  }

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
  }
}

class _NumericPoint {
  const _NumericPoint(this.value);
  final double value;

  static _NumericPoint? from(Map<String, dynamic> point) {
    final raw = point['value'];
    final value = raw is num ? raw.toDouble() : double.tryParse(raw?.toString() ?? '');
    if (value == null || !value.isFinite) return null;
    return _NumericPoint(value);
  }
}

class _LabSeriesPainter extends CustomPainter {
  const _LabSeriesPainter({
    required this.points,
    required this.lineColor,
    required this.gridColor,
  });

  final List<_NumericPoint> points;
  final Color lineColor;
  final Color gridColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2 || size.width <= 0 || size.height <= 0) return;
    const inset = 12.0;
    final width = math.max(1.0, size.width - inset * 2);
    final height = math.max(1.0, size.height - inset * 2);
    final values = points.map((point) => point.value);
    final minValue = values.reduce(math.min);
    final maxValue = values.reduce(math.max);
    final span = maxValue == minValue ? 1.0 : maxValue - minValue;

    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var row = 0; row <= 3; row++) {
      final y = inset + height * row / 3;
      canvas.drawLine(Offset(inset, y), Offset(inset + width, y), gridPaint);
    }

    final linePaint = Paint()
      ..color = lineColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final pointPaint = Paint()
      ..color = lineColor
      ..style = PaintingStyle.fill;
    final path = Path();

    for (var index = 0; index < points.length; index++) {
      final x = inset + width * index / (points.length - 1);
      final normalized = (points[index].value - minValue) / span;
      final y = inset + height * (1 - normalized);
      if (index == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
      canvas.drawCircle(Offset(x, y), 3.5, pointPaint);
    }
    canvas.drawPath(path, linePaint);
  }

  @override
  bool shouldRepaint(covariant _LabSeriesPainter oldDelegate) {
    if (oldDelegate.lineColor != lineColor ||
        oldDelegate.gridColor != gridColor ||
        oldDelegate.points.length != points.length) {
      return true;
    }
    for (var index = 0; index < points.length; index++) {
      if (oldDelegate.points[index].value != points[index].value) return true;
    }
    return false;
  }
}

String doctorLabSeriesText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Laboratory series',
      'subtitle':'Validated/released results only. The chart is descriptive and performs no clinical inference.',
      'refresh':'Refresh',
      'empty':'No validated or released laboratory series are available.',
      'accessBasis':'Access basis',
      'analyte':'Analyte',
      'unit':'Unit',
      'points':'Points',
      'chartUnavailable':'A chart requires at least two numeric results; all source results remain listed below.',
      'status':'Status',
      'reference':'Reference range',
      'flag':'Source flag',
      'source':'Result / order source',
    },
    CarePointLocale.ar: {
      'title':'سلاسل نتائج المختبر',
      'subtitle':'تُعرض النتائج المعتمدة/المحررة فقط. الرسم وصفي ولا يجري أي استنتاج سريري.',
      'refresh':'تحديث',
      'empty':'لا توجد سلاسل مختبرية معتمدة أو محررة.',
      'accessBasis':'أساس الوصول',
      'analyte':'التحليل',
      'unit':'الوحدة',
      'points':'النقاط',
      'chartUnavailable':'يتطلب الرسم نتيجتين رقميتين على الأقل؛ تبقى كل النتائج المصدرية معروضة أدناه.',
      'status':'الحالة',
      'reference':'المجال المرجعي',
      'flag':'علامة المصدر',
      'source':'مصدر النتيجة / الطلب',
    },
    CarePointLocale.fr: {
      'title':'Séries de laboratoire',
      'subtitle':'Résultats validés/libérés uniquement. Le graphique est descriptif et ne produit aucune inférence clinique.',
      'refresh':'Actualiser',
      'empty':'Aucune série de laboratoire validée ou libérée.',
      'accessBasis':'Base d’accès',
      'analyte':'Analyte',
      'unit':'Unité',
      'points':'Points',
      'chartUnavailable':'Un graphique exige au moins deux résultats numériques ; tous les résultats sources restent listés ci-dessous.',
      'status':'Statut',
      'reference':'Intervalle de référence',
      'flag':'Indicateur source',
      'source':'Source résultat / ordre',
    },
    CarePointLocale.es: {
      'title':'Series de laboratorio',
      'subtitle':'Solo resultados validados/liberados. La gráfica es descriptiva y no realiza inferencia clínica.',
      'refresh':'Actualizar',
      'empty':'No hay series de laboratorio validadas o liberadas.',
      'accessBasis':'Base de acceso',
      'analyte':'Analito',
      'unit':'Unidad',
      'points':'Puntos',
      'chartUnavailable':'La gráfica requiere al menos dos resultados numéricos; todos los resultados fuente siguen listados debajo.',
      'status':'Estado',
      'reference':'Intervalo de referencia',
      'flag':'Bandera de origen',
      'source':'Fuente resultado / orden',
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
