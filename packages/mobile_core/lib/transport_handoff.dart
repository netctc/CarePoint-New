import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

const _handoffCopy = <CarePointLocale, Map<String, String>>{
  CarePointLocale.en: {
    'action': 'Destination handoff',
    'title': 'Destination handoff',
    'receiverName': 'Receiver name',
    'receiverRole': 'Receiver role',
    'receiverOrganization': 'Receiving organization (optional)',
    'summary': 'Handoff summary',
    'confirm': 'Receiver confirms handoff and receipt',
    'save': 'Record immutable handoff',
    'recorded': 'Destination handoff recorded.',
    'existing': 'Recorded handoff',
    'immutable': 'This handoff is immutable and linked to the transport job, crew and unit assignment.',
    'signature': 'Typed confirmation',
    'required': 'Complete all required fields and receiver confirmation.',
    'closed': 'A destination handoff can only be recorded while the transport is in progress.',
    'receiver': 'Receiver',
    'role': 'Role',
    'organization': 'Organization',
    'time': 'Handed off',
    'integrity': 'Integrity hash',
  },
  CarePointLocale.ar: {
    'action': 'تسليم في الوجهة',
    'title': 'تسليم المريض في الوجهة',
    'receiverName': 'اسم المستلم',
    'receiverRole': 'صفة المستلم',
    'receiverOrganization': 'الجهة المستلمة (اختياري)',
    'summary': 'ملخص التسليم',
    'confirm': 'يؤكد المستلم عملية التسليم والاستلام',
    'save': 'تسجيل التسليم غير القابل للتعديل',
    'recorded': 'تم تسجيل التسليم في الوجهة.',
    'existing': 'التسليم المسجل',
    'immutable': 'سجل التسليم غير قابل للتعديل ومرتبط بمهمة النقل والطاقم والمركبة.',
    'signature': 'تأكيد كتابي',
    'required': 'أكمل جميع الحقول المطلوبة وتأكيد المستلم.',
    'closed': 'يمكن تسجيل التسليم في الوجهة فقط أثناء نقل المريض.',
    'receiver': 'المستلم',
    'role': 'الصفة',
    'organization': 'الجهة',
    'time': 'وقت التسليم',
    'integrity': 'بصمة السلامة',
  },
  CarePointLocale.fr: {
    'action': 'Remise à destination',
    'title': 'Remise à destination',
    'receiverName': 'Nom du destinataire',
    'receiverRole': 'Rôle du destinataire',
    'receiverOrganization': 'Organisation destinataire (facultatif)',
    'summary': 'Résumé de la remise',
    'confirm': 'Le destinataire confirme la remise et la réception',
    'save': 'Enregistrer la remise immuable',
    'recorded': 'Remise à destination enregistrée.',
    'existing': 'Remise enregistrée',
    'immutable': 'Cette remise est immuable et liée à la mission, à l’équipe et au véhicule.',
    'signature': 'Confirmation saisie',
    'required': 'Complétez les champs requis et la confirmation du destinataire.',
    'closed': 'La remise à destination ne peut être enregistrée que pendant le transport.',
    'receiver': 'Destinataire',
    'role': 'Rôle',
    'organization': 'Organisation',
    'time': 'Remis à',
    'integrity': 'Empreinte d’intégrité',
  },
  CarePointLocale.es: {
    'action': 'Handoff en destino',
    'title': 'Handoff en destino',
    'receiverName': 'Nombre de quien recibe',
    'receiverRole': 'Rol de quien recibe',
    'receiverOrganization': 'Organización receptora (opcional)',
    'summary': 'Resumen del handoff',
    'confirm': 'La persona receptora confirma la entrega y recepción',
    'save': 'Registrar handoff inmutable',
    'recorded': 'Handoff en destino registrado.',
    'existing': 'Handoff registrado',
    'immutable': 'Este handoff es inmutable y está vinculado al servicio, tripulación y unidad asignada.',
    'signature': 'Confirmación escrita',
    'required': 'Completa los campos obligatorios y la confirmación de recepción.',
    'closed': 'El handoff en destino sólo puede registrarse mientras el transporte está en curso.',
    'receiver': 'Receptor',
    'role': 'Rol',
    'organization': 'Organización',
    'time': 'Entregado',
    'integrity': 'Hash de integridad',
  },
};

String transportHandoffText(CarePointLocale locale, String key) =>
    _handoffCopy[locale]?[key] ?? _handoffCopy[CarePointLocale.en]?[key] ?? key;

Future<bool?> showTransportHandoffSheet({
  required BuildContext context,
  required CarePointApi api,
  required String requestId,
  required String status,
  required CarePointLocale locale,
}) async {
  final envelope = await api.providerTransportHandoff(requestId);
  if (!context.mounted) return null;
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: _TransportHandoffSheet(
        api: api,
        requestId: requestId,
        status: status,
        locale: locale,
        initialEnvelope: envelope,
      ),
    ),
  );
}

class _TransportHandoffSheet extends StatefulWidget {
  const _TransportHandoffSheet({
    required this.api,
    required this.requestId,
    required this.status,
    required this.locale,
    required this.initialEnvelope,
  });

  final CarePointApi api;
  final String requestId;
  final String status;
  final CarePointLocale locale;
  final Map<String, dynamic> initialEnvelope;

  @override
  State<_TransportHandoffSheet> createState() => _TransportHandoffSheetState();
}

class _TransportHandoffSheetState extends State<_TransportHandoffSheet> {
  final receiverName = TextEditingController();
  final receiverRole = TextEditingController();
  final receiverOrganization = TextEditingController();
  final summary = TextEditingController();
  bool confirmed = false;
  bool saving = false;
  String? error;
  late Map<String, dynamic>? existing;

  @override
  void initState() {
    super.initState();
    final value = widget.initialEnvelope['handoff'];
    existing = value is Map ? value.map((key, item) => MapEntry(key.toString(), item)) : null;
  }

  @override
  void dispose() {
    receiverName.dispose();
    receiverRole.dispose();
    receiverOrganization.dispose();
    summary.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: .88,
        minChildSize: .55,
        maxChildSize: .97,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 30),
          children: [
            Center(child: Container(width: 44, height: 4, decoration: BoxDecoration(color: Theme.of(context).dividerColor, borderRadius: BorderRadius.circular(8)))),
            const SizedBox(height: 18),
            Text(transportHandoffText(widget.locale, 'title'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
            const SizedBox(height: 16),
            if (existing != null) _existing(existing!) else _form(),
          ],
        ),
      );

  Widget _existing(Map<String, dynamic> handoff) {
    final data = _map(handoff['data']);
    final digest = handoff['transportContextDigest']?.toString() ?? '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _notice(transportHandoffText(widget.locale, 'immutable')),
        const SizedBox(height: 14),
        _row(transportHandoffText(widget.locale, 'receiver'), handoff['receiverName']),
        _row(transportHandoffText(widget.locale, 'role'), handoff['receiverRole']),
        if (data['receiverOrganization'] != null) _row(transportHandoffText(widget.locale, 'organization'), data['receiverOrganization']),
        _row(transportHandoffText(widget.locale, 'time'), handoff['handedOffAt']),
        _row(transportHandoffText(widget.locale, 'signature'), handoff['signatureMethod'] ?? '—'),
        _row(transportHandoffText(widget.locale, 'integrity'), digest.length > 20 ? '${digest.substring(0, 20)}…' : digest),
        const SizedBox(height: 12),
        Text(data['handoffSummary']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _form() {
    final enabled = widget.status == 'TRANSPORTING';
    if (!enabled) return _notice(transportHandoffText(widget.locale, 'closed'));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(controller: receiverName, maxLength: 160, decoration: InputDecoration(labelText: transportHandoffText(widget.locale, 'receiverName'))),
        TextField(controller: receiverRole, maxLength: 120, decoration: InputDecoration(labelText: transportHandoffText(widget.locale, 'receiverRole'))),
        TextField(controller: receiverOrganization, maxLength: 200, decoration: InputDecoration(labelText: transportHandoffText(widget.locale, 'receiverOrganization'))),
        TextField(controller: summary, maxLength: 4000, minLines: 3, maxLines: 6, decoration: InputDecoration(labelText: transportHandoffText(widget.locale, 'summary'))),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: confirmed,
          controlAffinity: ListTileControlAffinity.leading,
          title: Text(transportHandoffText(widget.locale, 'confirm')),
          subtitle: Text(transportHandoffText(widget.locale, 'signature')),
          onChanged: saving ? null : (value) => setState(() => confirmed = value == true),
        ),
        if (error != null) Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ),
        FilledButton.icon(
          onPressed: saving ? null : _save,
          icon: saving
              ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.verified_outlined),
          label: Text(transportHandoffText(widget.locale, 'save')),
        ),
      ],
    );
  }

  Future<void> _save() async {
    if (receiverName.text.trim().isEmpty || receiverRole.text.trim().isEmpty || summary.text.trim().isEmpty || !confirmed) {
      setState(() => error = transportHandoffText(widget.locale, 'required'));
      return;
    }
    setState(() { saving = true; error = null; });
    try {
      final result = await widget.api.recordProviderTransportHandoff(
        widget.requestId,
        idempotencyKey: 'transport-handoff-${widget.requestId}-${DateTime.now().microsecondsSinceEpoch}',
        receiverName: receiverName.text,
        receiverRole: receiverRole.text,
        receiverOrganization: receiverOrganization.text,
        handoffSummary: summary.text,
        handedOffAt: DateTime.now(),
        signatureMethod: 'TYPED_CONFIRMATION',
      );
      if (!mounted) return;
      setState(() => existing = result);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(transportHandoffText(widget.locale, 'recorded'))));
      Navigator.of(context).pop(true);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Widget _notice(String text) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
        child: Text(text),
      );

  Widget _row(String label, dynamic value) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 120, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
          Expanded(child: Text(value?.toString() ?? '—')),
        ]),
      );
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}
