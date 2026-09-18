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
      final type = result['type']?.toString();
      if (type == 'LABORATORY') {
        final labResult = _map(result['labResult']);
        if (labResult['status']?.toString() != 'RELEASED' || labResult['released'] != true || labResult['data'] == null) {
          throw const FormatException('Released laboratory result unavailable.');
        }
      } else if (type == 'PRESCRIPTION') {
        if (result['data'] is! Map) throw const FormatException('Prescription data unavailable.');
      } else {
        throw const FormatException('Unsupported clinical order type.');
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
    final prescription = value?['type']?.toString() == 'PRESCRIPTION';
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        appBar: AppBar(
          title: Text(prescription ? t('prescriptionTitle') : t('labTitle')),
          actions: widget.session.role == 'PATIENT'
              ? [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), tooltip: orderText(widget.locale, 'refresh'))]
              : const [],
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
    return order['type']?.toString() == 'PRESCRIPTION' ? _prescription(order) : _laboratory(order);
  }

  Widget _prescription(Map<String, dynamic> order) {
    final data = _map(order['data']);
    final medication = _map(data['medication']);
    final status = order['status']?.toString() ?? '';
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        key: const ValueKey('patient-prescription-result'),
        padding: const EdgeInsets.all(16),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Row(children: [
            const CircleAvatar(child: Icon(Icons.medication_outlined)),
            const SizedBox(width: 10),
            Expanded(child: Text(t('prescriptionReady'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900))),
          ]),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                _line(orderText(widget.locale, 'status'), _status(status)),
                _line(t('signedAt'), _dateTime(order['signedAt'])),
                if (status == 'CANCELLED') _line(t('cancelledAt'), _dateTime(order['cancelledAt'])),
              ]),
            ),
          ),
          _card(orderText(widget.locale, 'medication'), medication['name']),
          if (medication['strength'] != null) _card(orderText(widget.locale, 'strength'), medication['strength']),
          if (medication['form'] != null) _card(t('form'), medication['form']),
          _card(orderText(widget.locale, 'instruction'), data['dosageInstruction']),
          if (data['route'] != null) _card(t('route'), data['route']),
          if (data['frequency'] != null) _card(t('frequency'), data['frequency']),
          if (data['duration'] != null) _card(t('duration'), data['duration']),
          if (data['quantity'] != null) _card(orderText(widget.locale, 'quantity'), data['quantity']),
          if (data['refills'] != null) _card(t('refills'), data['refills']),
          if (data['reason'] != null) _card(orderText(widget.locale, 'reason'), data['reason']),
          if (data['instructions'] != null) _card(t('additionalInstructions'), data['instructions']),
          if (status == 'CANCELLED') ...[
            const SizedBox(height: 6),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(Icons.info_outline, color: Theme.of(context).colorScheme.error),
                  const SizedBox(width: 8),
                  Expanded(child: Text(t('cancelledHint'))),
                ]),
              ),
            ),
          ],
          const SizedBox(height: 8),
          _authorizedHint(t('prescriptionAuthorizedHint')),
        ],
      ),
    );
  }

  Widget _laboratory(Map<String, dynamic> order) {
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
          _authorizedHint(t('authorizedHint')),
        ],
      ),
    );
  }

  Widget _authorizedHint(String text) => Row(children: [
        const Icon(Icons.verified_user_outlined, size: 17, color: Color(0xFF10B981)),
        const SizedBox(width: 6),
        Expanded(child: Text(text, style: const TextStyle(color: Color(0xFF475569)))),
      ]);

  Widget _card(String label, dynamic value) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: _line(label, value),
        ),
      );

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

  String _status(String status) => switch (status) {
        'SIGNED' => t('statusSigned'),
        'CANCELLED' => t('statusCancelled'),
        'FULFILLED' => t('statusFulfilled'),
        _ => status,
      };

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
    'labTitle': 'Laboratory result',
    'prescriptionTitle': 'Prescription',
    'ready': 'Your laboratory result is ready',
    'prescriptionReady': 'Your prescription',
    'releasedAt': 'Released',
    'signedAt': 'Signed',
    'cancelledAt': 'Cancelled',
    'form': 'Form',
    'route': 'Route',
    'frequency': 'Frequency',
    'duration': 'Duration',
    'refills': 'Refills',
    'additionalInstructions': 'Additional instructions',
    'statusSigned': 'Active signed prescription',
    'statusCancelled': 'Cancelled prescription',
    'statusFulfilled': 'Completed prescription order',
    'cancelledHint': 'This prescription was cancelled by the ordering clinician. Do not rely on it as an active prescription.',
    'empty': 'No released result values are available.',
    'authorizedHint': 'Sensitive details are loaded only after CarePoint verifies access to this clinical order.',
    'prescriptionAuthorizedHint': 'Prescription details are read-only and are loaded only after CarePoint verifies that this order belongs to your patient account.',
    'unavailable': 'This clinical order is not available to this account.',
    'denied': 'Clinical orders are available only to the Patient app.',
    'retry': 'Retry',
  },
  'ar': {
    'labTitle': 'نتيجة المختبر',
    'prescriptionTitle': 'الوصفة الطبية',
    'ready': 'نتيجة المختبر جاهزة',
    'prescriptionReady': 'وصفتك الطبية',
    'releasedAt': 'تم الإصدار',
    'signedAt': 'تم التوقيع',
    'cancelledAt': 'تم الإلغاء',
    'form': 'الشكل الدوائي',
    'route': 'طريقة الاستعمال',
    'frequency': 'التكرار',
    'duration': 'المدة',
    'refills': 'مرات إعادة الصرف',
    'additionalInstructions': 'تعليمات إضافية',
    'statusSigned': 'وصفة موقعة فعالة',
    'statusCancelled': 'وصفة ملغاة',
    'statusFulfilled': 'طلب وصفة مكتمل',
    'cancelledHint': 'تم إلغاء هذه الوصفة من قبل الطبيب الذي أصدرها. لا تعتمد عليها كوصفة فعالة.',
    'empty': 'لا توجد قيم نتائج مُصدرة متاحة.',
    'authorizedHint': 'يتم تحميل التفاصيل الحساسة فقط بعد أن يتحقق CarePoint من صلاحية الوصول إلى هذا الطلب السريري.',
    'prescriptionAuthorizedHint': 'تفاصيل الوصفة للقراءة فقط ولا يتم تحميلها إلا بعد أن يتحقق CarePoint من أن الطلب يخص حساب المريض الخاص بك.',
    'unavailable': 'هذا الطلب السريري غير متاح لهذا الحساب.',
    'denied': 'الطلبات السريرية متاحة فقط في تطبيق المريض.',
    'retry': 'إعادة المحاولة',
  },
  'fr': {
    'labTitle': 'Résultat de laboratoire',
    'prescriptionTitle': 'Prescription',
    'ready': 'Votre résultat de laboratoire est disponible',
    'prescriptionReady': 'Votre prescription',
    'releasedAt': 'Publié',
    'signedAt': 'Signée',
    'cancelledAt': 'Annulée',
    'form': 'Forme',
    'route': 'Voie',
    'frequency': 'Fréquence',
    'duration': 'Durée',
    'refills': 'Renouvellements',
    'additionalInstructions': 'Instructions supplémentaires',
    'statusSigned': 'Prescription signée active',
    'statusCancelled': 'Prescription annulée',
    'statusFulfilled': 'Ordre de prescription terminé',
    'cancelledHint': 'Cette prescription a été annulée par le clinicien prescripteur. Ne la considérez pas comme une prescription active.',
    'empty': 'Aucune valeur de résultat publiée n’est disponible.',
    'authorizedHint': 'Les détails sensibles sont chargés uniquement après vérification de l’accès à cet ordre clinique par CarePoint.',
    'prescriptionAuthorizedHint': 'Les détails de la prescription sont en lecture seule et ne sont chargés qu’après vérification par CarePoint que cet ordre appartient à votre compte patient.',
    'unavailable': 'Cet ordre clinique n’est pas disponible pour ce compte.',
    'denied': 'Les ordres cliniques sont réservés à l’application Patient.',
    'retry': 'Réessayer',
  },
  'es': {
    'labTitle': 'Resultado de laboratorio',
    'prescriptionTitle': 'Prescripción',
    'ready': 'Tu resultado de laboratorio está disponible',
    'prescriptionReady': 'Tu prescripción',
    'releasedAt': 'Liberado',
    'signedAt': 'Firmada',
    'cancelledAt': 'Cancelada',
    'form': 'Forma',
    'route': 'Vía',
    'frequency': 'Frecuencia',
    'duration': 'Duración',
    'refills': 'Renovaciones',
    'additionalInstructions': 'Instrucciones adicionales',
    'statusSigned': 'Prescripción firmada activa',
    'statusCancelled': 'Prescripción cancelada',
    'statusFulfilled': 'Orden de prescripción completada',
    'cancelledHint': 'Esta prescripción fue cancelada por el profesional que la emitió. No debe considerarse una prescripción activa.',
    'empty': 'No hay valores de resultado liberados disponibles.',
    'authorizedHint': 'Los detalles sensibles solo se cargan después de que CarePoint verifique el acceso a esta orden clínica.',
    'prescriptionAuthorizedHint': 'Los detalles de la prescripción son de solo lectura y solo se cargan después de que CarePoint verifique que la orden pertenece a tu cuenta de paciente.',
    'unavailable': 'Esta orden clínica no está disponible para esta cuenta.',
    'denied': 'Las órdenes clínicas solo están disponibles en la aplicación del paciente.',
    'retry': 'Reintentar',
  },
};
