import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'clinical_documents.dart';

String patientDiagnosticReportText(CarePointLocale locale, String key) =>
    _diagnosticCopy[locale.name]?[key] ?? _diagnosticCopy['en']?[key] ?? key;

class PatientDiagnosticReportPage extends StatefulWidget {
  const PatientDiagnosticReportPage({
    super.key,
    required this.session,
    required this.locale,
    required this.reportId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String reportId;

  @override
  State<PatientDiagnosticReportPage> createState() => _PatientDiagnosticReportPageState();
}

class _PatientDiagnosticReportPageState extends State<PatientDiagnosticReportPage> {
  Map<String, dynamic>? report;
  bool busy = true;
  String? error;

  String t(String key) => patientDiagnosticReportText(widget.locale, key);

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
    final id = widget.reportId.trim();
    if (id.isEmpty) {
      if (mounted) setState(() { busy = false; report = null; error = t('unavailable'); });
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      final value = await widget.session.api.diagnosticReport(id).timeout(const Duration(seconds: 30));
      if (value['status']?.toString() != 'RELEASED' || value['data'] is! Map) {
        throw const FormatException('Released diagnostic report unavailable.');
      }
      if (mounted) setState(() => report = value);
    } catch (_) {
      if (mounted) setState(() { report = null; error = t('unavailable'); });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: widget.locale.textDirection,
        child: Scaffold(
          appBar: AppBar(
            title: Text(t('title')),
            actions: widget.session.role == 'PATIENT'
                ? [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), tooltip: documentText(widget.locale, 'refresh'))]
                : const [],
          ),
          body: _body(),
        ),
      );

  Widget _body() {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null || report == null) {
      return Center(
        key: const ValueKey('patient-diagnostic-report-unavailable'),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.radiology_outlined, size: 38),
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

    final value = report!;
    final data = _map(value['data']);
    final type = value['type']?.toString().trim();
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        key: const ValueKey('patient-diagnostic-report-result'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Row(children: [
            const CircleAvatar(child: Icon(Icons.radiology_outlined)),
            const SizedBox(width: 10),
            Expanded(child: Text(t('ready'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900))),
          ]),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (type?.isNotEmpty == true) _section(documentText(widget.locale, 'type'), type),
                _section(documentText(widget.locale, 'status'), documentText(widget.locale, 'released')),
                _section(t('releasedAt'), _dateTime(value['releasedAt'])),
              ]),
            ),
          ),
          if (data['findings'] != null) _card(documentText(widget.locale, 'findings'), data['findings']),
          if (data['impression'] != null) _card(documentText(widget.locale, 'impression'), data['impression']),
          if (data['recommendation'] != null) _card(t('recommendation'), data['recommendation']),
          if (data['method'] != null) _card(t('method'), data['method']),
          if (data['comparison'] != null) _card(t('comparison'), data['comparison']),
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

  Widget _card(String label, dynamic value) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: _section(label, value),
        ),
      );

  Widget _section(String label, dynamic raw) {
    final text = raw?.toString().trim() ?? '';
    if (text.isEmpty || text == '—') return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 3),
        Text(text),
      ]),
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

const Map<String, Map<String, String>> _diagnosticCopy = {
  'en': {
    'title': 'Diagnostic report',
    'ready': 'Your diagnostic report is ready',
    'releasedAt': 'Released',
    'recommendation': 'Recommendation',
    'method': 'Method',
    'comparison': 'Comparison',
    'authorizedHint': 'Sensitive report details are loaded only after CarePoint verifies access to this released report.',
    'unavailable': 'This diagnostic report is not available to this account.',
    'denied': 'Diagnostic reports are available only to the Patient app.',
    'retry': 'Retry',
  },
  'ar': {
    'title': 'التقرير التشخيصي',
    'ready': 'تقريرك التشخيصي جاهز',
    'releasedAt': 'تم الإصدار',
    'recommendation': 'التوصية',
    'method': 'الطريقة',
    'comparison': 'المقارنة',
    'authorizedHint': 'يتم تحميل تفاصيل التقرير الحساسة فقط بعد أن يتحقق CarePoint من صلاحية الوصول إلى هذا التقرير المُصدر.',
    'unavailable': 'هذا التقرير التشخيصي غير متاح لهذا الحساب.',
    'denied': 'التقارير التشخيصية متاحة فقط في تطبيق المريض.',
    'retry': 'إعادة المحاولة',
  },
  'fr': {
    'title': 'Rapport diagnostique',
    'ready': 'Votre rapport diagnostique est disponible',
    'releasedAt': 'Publié',
    'recommendation': 'Recommandation',
    'method': 'Méthode',
    'comparison': 'Comparaison',
    'authorizedHint': 'Les détails sensibles sont chargés uniquement après vérification par CarePoint de l’accès à ce rapport publié.',
    'unavailable': 'Ce rapport diagnostique n’est pas disponible pour ce compte.',
    'denied': 'Les rapports diagnostiques sont réservés à l’application Patient.',
    'retry': 'Réessayer',
  },
  'es': {
    'title': 'Informe diagnóstico',
    'ready': 'Tu informe diagnóstico está disponible',
    'releasedAt': 'Liberado',
    'recommendation': 'Recomendación',
    'method': 'Método',
    'comparison': 'Comparación',
    'authorizedHint': 'Los detalles sensibles solo se cargan después de que CarePoint verifique el acceso a este informe liberado.',
    'unavailable': 'Este informe diagnóstico no está disponible para esta cuenta.',
    'denied': 'Los informes diagnósticos solo están disponibles en la aplicación del paciente.',
    'retry': 'Reintentar',
  },
};
