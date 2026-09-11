import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'clinical_orders.dart';

String patientClinicalOrderText(CarePointLocale locale, String key) =>
    _patientClinicalOrderCopy[locale.name]?[key] ?? _patientClinicalOrderCopy['en']?[key] ?? key;

class PatientClinicalOrderResultPage extends StatefulWidget {
  const PatientClinicalOrderResultPage({
    super.key,
    required this.session,
    required this.locale,
    required this.orderId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String orderId;

  @override
  State<PatientClinicalOrderResultPage> createState() => _PatientClinicalOrderResultPageState();
}

class _PatientClinicalOrderResultPageState extends State<PatientClinicalOrderResultPage> {
  Map<String, dynamic>? value;
  bool busy = true;
  String? error;

  String t(String key) => patientClinicalOrderText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    if (widget.session.role != 'PATIENT') {
      busy = false;
      error = t('denied');
    } else {
      load();
    }
  }

  Future<void> load() async {
    if (widget.session.role != 'PATIENT') return;
    final id = widget.orderId.trim();
    if (id.isEmpty) {
      if (mounted) setState(() { busy = false; value = null; error = t('unavailable'); });
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      final result = await widget.session.api.clinicalOrder(id).timeout(const Duration(seconds: 30));
      final labResult = _map(result['labResult']);
      if (result['type']?.toString() != 'LABORATORY' || labResult['status']?.toString() != 'RELEASED' || labResult['released'] != true || labResult['data'] == null) {
        throw const FormatException('Released laboratory result unavailable.');
      }
      if (mounted) setState(() => value = result);
    } catch (_) {
      if (mounted) setState(() { value = null; error = t('unavailable'); });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t('title')),
          actions: widget.session.role == 'PATIENT' ? [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), tooltip: orderText(widget.locale, 'refresh'))] : const [],
        ),
        body: _body(),
      ),
    );
  }

  Widget _body() {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null || value == null) {
      return Center(
        key: const ValueKey('patient-clinical-order-unavailable'),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.health_and_safety_outlined, size: 36),
            const SizedBox(height: 12),
            Text(error ?? t('unavailable'), textAlign: TextAlign.center),
            if (widget.session.role == 'PATIENT') ...[
              const SizedBox(height: 12),
              FilledButton.tonal(onPressed: load, child: Text(t('retry'))),
            ],
          ]),
        ),
      );
    }

    final order = value!;
    final orderData = _map(order['data']);
    final labResult = _map(order['labResult']);
    final resultData = _map(labResult['data']);
    final tests = _list(orderData['tests']);
    final observations = _list(resultData['observations']);
    final testNames = tests.map((item) => item['display']?.toString().trim() ?? '').where((text) => text.isNotEmpty).toList(growable: false);

    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        key: const ValueKey('patient-clinical-order-result'),
        padding: const EdgeInsets.all(16),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Row(children: [
            const CircleAvatar(child: Icon(Icons.science_outlined)),
            const SizedBox(width: 10),
            Expanded(child: Text(t('ready'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900))),
          ]),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                _line(orderText(widget.locale, 'status'), orderText(widget.locale, 'released')),
                if (testNames.isNotEmpty) _line(orderText(widget.locale, 'test'), testNames.join(', ')),
                _line(t('releasedAt'), _dateTime(labResult['releasedAt'])),
              ]),
            ),
          ),
          const SizedBox(height: 10),
          Text(orderText(widget.locale, 'result'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (observations.isEmpty && resultData['conclusion'] == null)
            Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(t('empty'))))
          else ...[
            for (var index = 0; index < observations.length; index++)
              Card(
                key: ValueKey('patient-clinical-order-observation-$index'),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: _observation(observations[index]),
                ),
              ),
            if (resultData['conclusion'] != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: _line(orderText(widget.locale, 'conclusion'), resultData['conclusion']),
                ),
              ),
          ],
          const SizedBox(height: 8),
          Row(children: [
            const Icon(Icons.verified_user_outlined, size: 17, color: Color(0xFF10B981)),
            const SizedBox(width: 6),
            Expanded(child: Text(t('authorizedHint'), style: const TextStyle(color: Color(0xFF475569)))),
          ]),
        ],
      ),
    );
  }

  Widget _observation(Map<String, dynamic> item) {
    final label = item['display']?.toString().trim();
    final value = item['value']?.toString().trim() ?? '';
    final unit = item['unit']?.toString().trim();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(label?.isNotEmpty == true ? label! : orderText(widget.locale, 'observation'), style: const TextStyle(fontWeight: FontWeight.w800)),
      const SizedBox(height: 4),
      Text(unit?.isNotEmpty == true ? '$value $unit' : value),
    ]);
  }

  Widget _line(String label, dynamic raw) {
    final text = raw?.toString().trim() ?? '';
    if (text.isEmpty || text == '—') return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 3),
          Text(text),
        ],
      ),
    );
  }

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

const Map<String, Map<String, String>> _patientClinicalOrderCopy = {
  'en': {
    'title': 'Laboratory result',
    'ready': 'Your laboratory result is ready',
    'releasedAt': 'Released',
    'empty': 'No released result values are available.',
    'authorizedHint': 'Sensitive details are loaded only after CarePoint verifies access to this clinical order.',
    'unavailable': 'This laboratory result is not available to this account.',
    'denied': 'Laboratory results are available only to the Patient app.',
    'retry': 'Retry',
  },
  'ar': {
    'title': 'نتيجة المختبر',
    'ready': 'نتيجة المختبر جاهزة',
    'releasedAt': 'تم الإصدار',
    'empty': 'لا توجد قيم نتائج مُصدرة متاحة.',
    'authorizedHint': 'يتم تحميل التفاصيل الحساسة فقط بعد أن يتحقق CarePoint من صلاحية الوصول إلى هذا الطلب السريري.',
    'unavailable': 'نتيجة المختبر هذه غير متاحة لهذا الحساب.',
    'denied': 'نتائج المختبر متاحة فقط في تطبيق المريض.',
    'retry': 'إعادة المحاولة',
  },
  'fr': {
    'title': 'Résultat de laboratoire',
    'ready': 'Votre résultat de laboratoire est disponible',
    'releasedAt': 'Publié',
    'empty': 'Aucune valeur de résultat publiée n’est disponible.',
    'authorizedHint': 'Les détails sensibles sont chargés uniquement après vérification de l’accès à cet ordre clinique par CarePoint.',
    'unavailable': 'Ce résultat de laboratoire n’est pas disponible pour ce compte.',
    'denied': 'Les résultats de laboratoire sont réservés à l’application Patient.',
    'retry': 'Réessayer',
  },
  'es': {
    'title': 'Resultado de laboratorio',
    'ready': 'Tu resultado de laboratorio está disponible',
    'releasedAt': 'Liberado',
    'empty': 'No hay valores de resultado liberados disponibles.',
    'authorizedHint': 'Los detalles sensibles solo se cargan después de que CarePoint verifique el acceso a esta orden clínica.',
    'unavailable': 'Este resultado de laboratorio no está disponible para esta cuenta.',
    'denied': 'Los resultados de laboratorio solo están disponibles en la aplicación del paciente.',
    'retry': 'Reintentar',
  },
};
