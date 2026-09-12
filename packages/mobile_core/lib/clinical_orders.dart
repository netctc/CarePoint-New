import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String orderText(CarePointLocale locale, String key) => _orderStrings[locale.name]?[key] ?? _orderStrings['en']![key] ?? key;

const _orderStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Clinical orders', 'newPrescription': 'New prescription', 'newLab': 'New laboratory order',
    'prescription': 'Prescription', 'laboratory': 'Laboratory', 'medication': 'Medication', 'strength': 'Strength',
    'form': 'Form', 'route': 'Route', 'frequency': 'Frequency', 'duration': 'Duration', 'refills': 'Refills',
    'additionalInstructions': 'Additional instructions', 'signedAt': 'Signed', 'cancelledAt': 'Cancelled',
    'instruction': 'Dosage instruction', 'quantity': 'Quantity', 'test': 'Test', 'reason': 'Reason', 'priority': 'Priority',
    'enterResult': 'Enter result', 'observation': 'Observation', 'value': 'Value', 'unit': 'Unit', 'conclusion': 'Conclusion',
    'validate': 'Validate result', 'release': 'Release to patient', 'cancel': 'Cancel order', 'signed': 'Signed',
    'attested': 'Clinically attested', 'noOrders': 'No clinical orders for this patient.', 'saved': 'Order saved',
    'resultHidden': 'Result is not released to the patient yet.', 'released': 'Released to patient', 'refresh': 'Refresh',
    'close': 'Close', 'save': 'Save', 'confirmRelease': 'Release this validated result to the patient?',
    'confirmValidate': 'Validate this laboratory result?', 'confirmCancel': 'Cancel this signed order?', 'required': 'Required fields are missing.',
    'accessBasis': 'Access basis', 'status': 'Status', 'result': 'Result',
  },
  'ar': {
    'title': 'الطلبات السريرية', 'newPrescription': 'وصفة جديدة', 'newLab': 'طلب مختبر جديد',
    'prescription': 'وصفة', 'laboratory': 'مختبر', 'medication': 'الدواء', 'strength': 'التركيز',
    'form': 'الشكل الدوائي', 'route': 'طريقة الاستعمال', 'frequency': 'التكرار', 'duration': 'المدة', 'refills': 'مرات إعادة الصرف',
    'additionalInstructions': 'تعليمات إضافية', 'signedAt': 'تم التوقيع', 'cancelledAt': 'تم الإلغاء',
    'instruction': 'تعليمات الجرعة', 'quantity': 'الكمية', 'test': 'الفحص', 'reason': 'السبب', 'priority': 'الأولوية',
    'enterResult': 'إدخال النتيجة', 'observation': 'الملاحظة', 'value': 'القيمة', 'unit': 'الوحدة', 'conclusion': 'الخلاصة',
    'validate': 'اعتماد النتيجة', 'release': 'إرسال للمريض', 'cancel': 'إلغاء الطلب', 'signed': 'موقّع',
    'attested': 'موثّق سريرياً', 'noOrders': 'لا توجد طلبات سريرية لهذا المريض.', 'saved': 'تم حفظ الطلب',
    'resultHidden': 'النتيجة لم تُرسل للمريض بعد.', 'released': 'أُرسلت للمريض', 'refresh': 'تحديث',
    'close': 'إغلاق', 'save': 'حفظ', 'confirmRelease': 'إرسال هذه النتيجة المعتمدة إلى المريض؟',
    'confirmValidate': 'اعتماد نتيجة المختبر هذه؟', 'confirmCancel': 'إلغاء هذا الطلب الموقّع؟', 'required': 'بعض الحقول المطلوبة غير مكتملة.',
    'accessBasis': 'أساس الوصول', 'status': 'الحالة', 'result': 'النتيجة',
  },
  'fr': {
    'title': 'Ordres cliniques', 'newPrescription': 'Nouvelle prescription', 'newLab': 'Nouvelle demande de laboratoire',
    'prescription': 'Prescription', 'laboratory': 'Laboratoire', 'medication': 'Médicament', 'strength': 'Dosage',
    'form': 'Forme', 'route': 'Voie', 'frequency': 'Fréquence', 'duration': 'Durée', 'refills': 'Renouvellements',
    'additionalInstructions': 'Instructions supplémentaires', 'signedAt': 'Signée', 'cancelledAt': 'Annulée',
    'instruction': 'Instruction posologique', 'quantity': 'Quantité', 'test': 'Analyse', 'reason': 'Motif', 'priority': 'Priorité',
    'enterResult': 'Saisir le résultat', 'observation': 'Observation', 'value': 'Valeur', 'unit': 'Unité', 'conclusion': 'Conclusion',
    'validate': 'Valider le résultat', 'release': 'Publier au patient', 'cancel': 'Annuler l’ordre', 'signed': 'Signé',
    'attested': 'Attestation clinique', 'noOrders': 'Aucun ordre clinique pour ce patient.', 'saved': 'Ordre enregistré',
    'resultHidden': 'Le résultat n’est pas encore publié au patient.', 'released': 'Publié au patient', 'refresh': 'Actualiser',
    'close': 'Fermer', 'save': 'Enregistrer', 'confirmRelease': 'Publier ce résultat validé au patient ?',
    'confirmValidate': 'Valider ce résultat de laboratoire ?', 'confirmCancel': 'Annuler cet ordre signé ?', 'required': 'Des champs obligatoires sont manquants.',
    'accessBasis': 'Base d’accès', 'status': 'Statut', 'result': 'Résultat',
  },
  'es': {
    'title': 'Órdenes clínicas', 'newPrescription': 'Nueva prescripción', 'newLab': 'Nueva orden de laboratorio',
    'prescription': 'Prescripción', 'laboratory': 'Laboratorio', 'medication': 'Medicamento', 'strength': 'Concentración',
    'form': 'Forma', 'route': 'Vía', 'frequency': 'Frecuencia', 'duration': 'Duración', 'refills': 'Renovaciones',
    'additionalInstructions': 'Instrucciones adicionales', 'signedAt': 'Firmada', 'cancelledAt': 'Cancelada',
    'instruction': 'Instrucción de dosificación', 'quantity': 'Cantidad', 'test': 'Prueba', 'reason': 'Motivo', 'priority': 'Prioridad',
    'enterResult': 'Introducir resultado', 'observation': 'Observación', 'value': 'Valor', 'unit': 'Unidad', 'conclusion': 'Conclusión',
    'validate': 'Validar resultado', 'release': 'Liberar al paciente', 'cancel': 'Cancelar orden', 'signed': 'Firmada',
    'attested': 'Atestación clínica', 'noOrders': 'No hay órdenes clínicas para este paciente.', 'saved': 'Orden guardada',
    'resultHidden': 'El resultado todavía no ha sido liberado al paciente.', 'released': 'Liberado al paciente', 'refresh': 'Actualizar',
    'close': 'Cerrar', 'save': 'Guardar', 'confirmRelease': '¿Liberar este resultado validado al paciente?',
    'confirmValidate': '¿Validar este resultado de laboratorio?', 'confirmCancel': '¿Cancelar esta orden firmada?', 'required': 'Faltan campos obligatorios.',
    'accessBasis': 'Base de acceso', 'status': 'Estado', 'result': 'Resultado',
  },
};

class ClinicalOrdersActionButton extends StatelessWidget {
  const ClinicalOrdersActionButton({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
    this.clinicalOrderCapabilities,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Set<String>? clinicalOrderCapabilities;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: ProviderClinicalOrdersPage(
            session: session,
            locale: locale,
            appointment: appointment,
            clinicalOrderCapabilities: clinicalOrderCapabilities,
          ),
        ))),
        icon: const Icon(Icons.receipt_long_outlined),
        label: Text(orderText(locale, 'title')),
      );
}

class ProviderClinicalOrdersPage extends StatefulWidget {
  const ProviderClinicalOrdersPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
    this.clinicalOrderCapabilities,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Set<String>? clinicalOrderCapabilities;

  @override
  State<ProviderClinicalOrdersPage> createState() => _ProviderClinicalOrdersPageState();
}

class _ProviderClinicalOrdersPageState extends State<ProviderClinicalOrdersPage> {
  bool busy = true;
  String? error;
  String? accessBasis;
  List<Map<String, dynamic>> items = const [];
  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;
  String get appointmentId => widget.appointment['id'].toString();
  String? get patientId => _map(widget.appointment['patient'])['id']?.toString();
  bool _can(String capability) => widget.clinicalOrderCapabilities == null || widget.clinicalOrderCapabilities!.contains(capability);

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    final id = patientId;
    if (id == null || id.isEmpty) { setState(() { busy = false; error = 'Patient id unavailable.'; }); return; }
    setState(() { busy = true; error = null; });
    try {
      final result = await api.providerClinicalOrders(id);
      if (mounted) setState(() { items = _list(result['items']); accessBasis = result['accessBasis']?.toString(); });
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final canCreatePrescription = _can('PRESCRIPTION');
    final canCreateLab = _can('LABORATORY');
    return Scaffold(
      appBar: AppBar(title: Text(orderText(locale, 'title')), actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh), tooltip: orderText(locale, 'refresh'))]),
      body: busy
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
              : RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 100), children: [
                  if (accessBasis != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text('${orderText(locale, 'accessBasis')}: $accessBasis', style: const TextStyle(color: Color(0xFF64748B)))),
                  if (items.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(orderText(locale, 'noOrders')))),
                  ...items.map(_orderCard),
                ])),
      floatingActionButton: canCreatePrescription || canCreateLab
          ? PopupMenuButton<String>(
              onSelected: (value) => value == 'rx' ? _createPrescription() : _createLabOrder(),
              itemBuilder: (_) => [
                if (canCreatePrescription) PopupMenuItem(value: 'rx', child: ListTile(leading: const Icon(Icons.medication_outlined), title: Text(orderText(locale, 'newPrescription')))),
                if (canCreateLab) PopupMenuItem(value: 'lab', child: ListTile(leading: const Icon(Icons.science_outlined), title: Text(orderText(locale, 'newLab')))),
              ],
              child: FloatingActionButton(onPressed: null, child: const Icon(Icons.add)),
            )
          : null,
    );
  }

  Widget _orderCard(Map<String, dynamic> order) {
    final data = _map(order['data']);
    final result = _map(order['labResult']);
    final prescription = order['type'] == 'PRESCRIPTION';
    final medication = _map(data['medication']);
    final tests = _list(data['tests']);
    final title = prescription ? (medication['name']?.toString() ?? orderText(locale, 'prescription')) : (tests.isEmpty ? orderText(locale, 'laboratory') : tests.map((e) => e['display']).whereType<String>().join(', '));
    return Card(child: ExpansionTile(
      leading: CircleAvatar(child: Icon(prescription ? Icons.medication_outlined : Icons.science_outlined)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text('${orderText(locale, 'status')}: ${order['status'] ?? ''}'),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        if (prescription && medication['strength'] != null) _line(orderText(locale, 'strength'), medication['strength']),
        if (prescription && medication['form'] != null) _line(orderText(locale, 'form'), medication['form']),
        if (data['reason'] != null) _line(orderText(locale, 'reason'), data['reason']),
        if (prescription && data['dosageInstruction'] != null) _line(orderText(locale, 'instruction'), data['dosageInstruction']),
        if (prescription && data['route'] != null) _line(orderText(locale, 'route'), data['route']),
        if (prescription && data['frequency'] != null) _line(orderText(locale, 'frequency'), data['frequency']),
        if (prescription && data['duration'] != null) _line(orderText(locale, 'duration'), data['duration']),
        if (prescription && data['quantity'] != null) _line(orderText(locale, 'quantity'), data['quantity']),
        if (prescription && data['refills'] != null) _line(orderText(locale, 'refills'), data['refills']),
        if (prescription && data['instructions'] != null) _line(orderText(locale, 'additionalInstructions'), data['instructions']),
        if (prescription && order['signedAt'] != null) _line(orderText(locale, 'signedAt'), _dateTime(order['signedAt'])),
        if (prescription && order['cancelledAt'] != null) _line(orderText(locale, 'cancelledAt'), _dateTime(order['cancelledAt'])),
        if (!prescription && result.isNotEmpty) _line(orderText(locale, 'result'), result['status']),
        if (!prescription && result['data'] != null) _labResultData(_map(result['data'])),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (order['status'] == 'SIGNED' && result.isEmpty && !prescription && _can('LAB_RESULT_ENTRY')) OutlinedButton.icon(onPressed: () => _enterResult(order), icon: const Icon(Icons.add_chart_outlined), label: Text(orderText(locale, 'enterResult'))),
          if (!prescription && result['status'] == 'ENTERED' && _can('LAB_RESULT_VALIDATE')) FilledButton.tonalIcon(onPressed: () => _confirmAction(orderText(locale, 'confirmValidate'), () => api.validateLaboratoryResult(order['id'].toString())), icon: const Icon(Icons.verified_outlined), label: Text(orderText(locale, 'validate'))),
          if (!prescription && result['status'] == 'VALIDATED') FilledButton.icon(onPressed: () => _confirmAction(orderText(locale, 'confirmRelease'), () => api.releaseLaboratoryResult(order['id'].toString())), icon: const Icon(Icons.send_outlined), label: Text(orderText(locale, 'release'))),
          if (order['status'] == 'SIGNED' && result.isEmpty) TextButton.icon(onPressed: () => _confirmAction(orderText(locale, 'confirmCancel'), () => api.cancelClinicalOrder(order['id'].toString())), icon: const Icon(Icons.cancel_outlined), label: Text(orderText(locale, 'cancel'))),
        ]),
      ],
    ));
  }

  Widget _labResultData(Map<String, dynamic> data) {
    final observations = _list(data['observations']);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ...observations.map((item) => _line(item['display']?.toString() ?? orderText(locale, 'observation'), '${item['value'] ?? ''}${item['unit'] == null ? '' : ' ${item['unit']}'}')),
      if (data['conclusion'] != null) _line(orderText(locale, 'conclusion'), data['conclusion']),
    ]);
  }

  Widget _line(String label, dynamic value) => Padding(padding: const EdgeInsets.only(top: 7), child: Align(alignment: AlignmentDirectional.centerStart, child: RichText(text: TextSpan(style: DefaultTextStyle.of(context).style, children: [TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w800)), TextSpan(text: value?.toString() ?? '')]))));

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
  }

  Future<void> _createPrescription() async {
    final medication = TextEditingController();
    final strength = TextEditingController();
    final form = TextEditingController();
    final instruction = TextEditingController();
    final route = TextEditingController();
    final frequency = TextEditingController();
    final duration = TextEditingController();
    final quantity = TextEditingController();
    final refills = TextEditingController();
    final reason = TextEditingController();
    final additionalInstructions = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(
      title: Text(orderText(locale, 'newPrescription')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: medication, decoration: InputDecoration(labelText: orderText(locale, 'medication'))),
        TextField(controller: strength, decoration: InputDecoration(labelText: orderText(locale, 'strength'))),
        TextField(controller: form, decoration: InputDecoration(labelText: orderText(locale, 'form'))),
        TextField(controller: instruction, maxLines: 2, decoration: InputDecoration(labelText: orderText(locale, 'instruction'))),
        TextField(controller: route, decoration: InputDecoration(labelText: orderText(locale, 'route'))),
        TextField(controller: frequency, decoration: InputDecoration(labelText: orderText(locale, 'frequency'))),
        TextField(controller: duration, decoration: InputDecoration(labelText: orderText(locale, 'duration'))),
        TextField(controller: quantity, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: orderText(locale, 'quantity'))),
        TextField(controller: refills, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: orderText(locale, 'refills'))),
        TextField(controller: reason, maxLines: 2, decoration: InputDecoration(labelText: orderText(locale, 'reason'))),
        TextField(controller: additionalInstructions, maxLines: 3, decoration: InputDecoration(labelText: orderText(locale, 'additionalInstructions'))),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(orderText(locale, 'save')))],
    ));
    if (ok != true) return;
    if (medication.text.trim().isEmpty || instruction.text.trim().isEmpty) { _message(orderText(locale, 'required')); return; }
    final parsedQuantity = int.tryParse(quantity.text.trim());
    final parsedRefills = int.tryParse(refills.text.trim());
    final body = <String, dynamic>{
      'idempotencyKey': 'mobile-rx-${DateTime.now().microsecondsSinceEpoch}',
      'medication': {
        'name': medication.text.trim(),
        if (strength.text.trim().isNotEmpty) 'strength': strength.text.trim(),
        if (form.text.trim().isNotEmpty) 'form': form.text.trim(),
      },
      'dosageInstruction': instruction.text.trim(),
      if (route.text.trim().isNotEmpty) 'route': route.text.trim(),
      if (frequency.text.trim().isNotEmpty) 'frequency': frequency.text.trim(),
      if (duration.text.trim().isNotEmpty) 'duration': duration.text.trim(),
      if (parsedQuantity != null) 'quantity': parsedQuantity,
      if (parsedRefills != null) 'refills': parsedRefills,
      if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
      if (additionalInstructions.text.trim().isNotEmpty) 'instructions': additionalInstructions.text.trim(),
    };
    await _run(() => api.createPrescription(appointmentId, body));
  }

  Future<void> _createLabOrder() async {
    final test = TextEditingController();
    final reason = TextEditingController();
    String priority = 'ROUTINE';
    final ok = await showDialog<bool>(context: context, builder: (_) => StatefulBuilder(builder: (context, setModal) => AlertDialog(
      title: Text(orderText(locale, 'newLab')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: test, decoration: InputDecoration(labelText: orderText(locale, 'test'))),
        DropdownButtonFormField<String>(initialValue: priority, decoration: InputDecoration(labelText: orderText(locale, 'priority')), items: const [DropdownMenuItem(value: 'ROUTINE', child: Text('ROUTINE')), DropdownMenuItem(value: 'URGENT', child: Text('URGENT'))], onChanged: (value) => setModal(() => priority = value ?? priority)),
        TextField(controller: reason, maxLines: 2, decoration: InputDecoration(labelText: orderText(locale, 'reason'))),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(orderText(locale, 'save')))],
    )));
    if (ok != true) return;
    if (test.text.trim().isEmpty) { _message(orderText(locale, 'required')); return; }
    await _run(() => api.createLaboratoryOrder(appointmentId, {
      'idempotencyKey': 'mobile-lab-${DateTime.now().microsecondsSinceEpoch}',
      'tests': [{'display': test.text.trim()}], 'priority': priority,
      if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
    }));
  }

  Future<void> _enterResult(Map<String, dynamic> order) async {
    final observation = TextEditingController();
    final value = TextEditingController();
    final unit = TextEditingController();
    final conclusion = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(
      title: Text(orderText(locale, 'enterResult')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: observation, decoration: InputDecoration(labelText: orderText(locale, 'observation'))),
        TextField(controller: value, decoration: InputDecoration(labelText: orderText(locale, 'value'))),
        TextField(controller: unit, decoration: InputDecoration(labelText: orderText(locale, 'unit'))),
        TextField(controller: conclusion, maxLines: 3, decoration: InputDecoration(labelText: orderText(locale, 'conclusion'))),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(orderText(locale, 'save')))],
    ));
    if (ok != true) return;
    if (observation.text.trim().isEmpty || value.text.trim().isEmpty) { _message(orderText(locale, 'required')); return; }
    await _run(() => api.enterLaboratoryResult(order['id'].toString(), {
      'observations': [{'display': observation.text.trim(), 'value': value.text.trim(), if (unit.text.trim().isNotEmpty) 'unit': unit.text.trim()}],
      if (conclusion.text.trim().isNotEmpty) 'conclusion': conclusion.text.trim(),
    }));
  }

  Future<void> _confirmAction(String prompt, Future<Map<String, dynamic>> Function() action) async {
    final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(content: Text(prompt), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(orderText(locale, 'save')))]));
    if (ok == true) await _run(action);
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() action) async {
    try { await action(); _message(orderText(locale, 'saved')); await load(); }
    catch (value) { _message(value.toString()); }
  }

  void _message(String text) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text))); }
}

Map<String, dynamic> _map(dynamic value) { if (value is Map<String, dynamic>) return value; if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item)); return <String, dynamic>{}; }
List<Map<String, dynamic>> _list(dynamic value) { if (value is! List) return const []; return value.map(_map).toList(growable: false); }
