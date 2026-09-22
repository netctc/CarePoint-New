import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String serviceSignatureText(CarePointLocale locale, String key) =>
    _signatureStrings[locale.name]?[key] ?? _signatureStrings['en']?[key] ?? key;

const _signatureStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Service receipt confirmation', 'new': 'Record confirmation', 'signer': 'Signer name',
    'signerType': 'Signer', 'patient': 'Patient', 'representative': 'Representative',
    'relationship': 'Relationship to patient', 'summary': 'Exact service summary being confirmed',
    'ack': 'I confirm that the service described above was received.', 'save': 'Record confirmation',
    'cancel': 'Cancel', 'empty': 'No service confirmations recorded.', 'saved': 'Service confirmation recorded.',
    'notice': 'This confirmation is evidence of service receipt only. It does not grant or replace clinical consent.',
    'confirmedAt': 'Confirmed',
  },
  'ar': {
    'title': 'تأكيد استلام الخدمة', 'new': 'تسجيل التأكيد', 'signer': 'اسم الموقّع',
    'signerType': 'الموقّع', 'patient': 'المريض', 'representative': 'الممثل',
    'relationship': 'صلة الممثل بالمريض', 'summary': 'الملخص الدقيق للخدمة التي يتم تأكيدها',
    'ack': 'أؤكد استلام الخدمة الموضحة أعلاه.', 'save': 'تسجيل التأكيد', 'cancel': 'إلغاء',
    'empty': 'لا توجد تأكيدات خدمة مسجلة.', 'saved': 'تم تسجيل تأكيد الخدمة.',
    'notice': 'هذا التأكيد دليل على استلام الخدمة فقط ولا يمنح أو يستبدل الموافقة السريرية.',
    'confirmedAt': 'وقت التأكيد',
  },
  'fr': {
    'title': 'Confirmation de réception du service', 'new': 'Enregistrer la confirmation', 'signer': 'Nom du signataire',
    'signerType': 'Signataire', 'patient': 'Patient', 'representative': 'Représentant',
    'relationship': 'Lien avec le patient', 'summary': 'Résumé exact du service confirmé',
    'ack': 'Je confirme la réception du service décrit ci-dessus.', 'save': 'Enregistrer', 'cancel': 'Annuler',
    'empty': 'Aucune confirmation de service enregistrée.', 'saved': 'Confirmation de service enregistrée.',
    'notice': 'Cette confirmation prouve uniquement la réception du service. Elle ne donne ni ne remplace le consentement clinique.',
    'confirmedAt': 'Confirmé',
  },
  'es': {
    'title': 'Confirmación de recepción del servicio', 'new': 'Registrar confirmación', 'signer': 'Nombre del firmante',
    'signerType': 'Firmante', 'patient': 'Paciente', 'representative': 'Representante',
    'relationship': 'Relación con el paciente', 'summary': 'Resumen exacto del servicio que se confirma',
    'ack': 'Confirmo que se recibió el servicio descrito arriba.', 'save': 'Registrar confirmación', 'cancel': 'Cancelar',
    'empty': 'No hay confirmaciones de servicio registradas.', 'saved': 'Confirmación de servicio registrada.',
    'notice': 'Esta confirmación solo acredita la recepción del servicio. No concede ni sustituye el consentimiento clínico.',
    'confirmedAt': 'Confirmado',
  },
};

class ProviderServiceSignaturePage extends StatefulWidget {
  const ProviderServiceSignaturePage({super.key, required this.session, required this.locale, required this.appointment});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<ProviderServiceSignaturePage> createState() => _ProviderServiceSignaturePageState();
}

class _ProviderServiceSignaturePageState extends State<ProviderServiceSignaturePage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  _SignatureApi get api => _SignatureApi(widget.session);

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    if (appointmentId.isEmpty) { setState(() { busy = false; error = 'Appointment context is unavailable.'; }); return; }
    setState(() { busy = true; error = null; });
    try {
      final result = await api.list(appointmentId);
      if (mounted) setState(() => items = _list(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(serviceSignatureText(widget.locale, 'title'))),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('provider-service-signature-create'), onPressed: busy ? null : create,
      icon: const Icon(Icons.draw_outlined), label: Text(serviceSignatureText(widget.locale, 'new')),
    ),
    body: SafeArea(child: busy
      ? const Center(child: CircularProgressIndicator())
      : error != null
        ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
        : RefreshIndicator(onRefresh: load, child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
            children: [
              Card(child: Padding(padding: const EdgeInsets.all(16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.info_outline), const SizedBox(width: 12), Expanded(child: Text(serviceSignatureText(widget.locale, 'notice'))),
              ]))),
              const SizedBox(height: 12),
              if (items.isEmpty)
                Padding(padding: const EdgeInsets.all(24), child: Text(serviceSignatureText(widget.locale, 'empty'), textAlign: TextAlign.center))
              else
                ...items.map(_card),
            ],
          )),
    ),
  );

  Widget _card(Map<String, dynamic> item) {
    final data = _map(item['data']);
    return Card(child: ListTile(
      leading: const CircleAvatar(child: Icon(Icons.verified_outlined)),
      title: Text(data['signerName']?.toString() ?? '—', style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text('${item['signerType'] == 'REPRESENTATIVE' ? serviceSignatureText(widget.locale, 'representative') : serviceSignatureText(widget.locale, 'patient')}\n${serviceSignatureText(widget.locale, 'confirmedAt')}: ${_dateTime(item['confirmedAt'])}'),
      isThreeLine: true,
    ));
  }

  Future<void> create() async {
    var signerType = 'PATIENT';
    var acknowledged = false;
    final signerName = TextEditingController();
    final relationship = TextEditingController();
    final summary = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => Directionality(
        textDirection: widget.locale.textDirection,
        child: AlertDialog(
          title: Text(serviceSignatureText(widget.locale, 'new')),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: signerType,
              decoration: InputDecoration(labelText: serviceSignatureText(widget.locale, 'signerType')),
              items: [
                DropdownMenuItem(value: 'PATIENT', child: Text(serviceSignatureText(widget.locale, 'patient'))),
                DropdownMenuItem(value: 'REPRESENTATIVE', child: Text(serviceSignatureText(widget.locale, 'representative'))),
              ],
              onChanged: (value) { if (value != null) setDialogState(() => signerType = value); },
            ),
            const SizedBox(height: 12),
            TextField(controller: signerName, decoration: InputDecoration(labelText: serviceSignatureText(widget.locale, 'signer'))),
            if (signerType == 'REPRESENTATIVE') ...[
              const SizedBox(height: 12),
              TextField(controller: relationship, decoration: InputDecoration(labelText: serviceSignatureText(widget.locale, 'relationship'))),
            ],
            const SizedBox(height: 12),
            TextField(controller: summary, maxLines: 5, decoration: InputDecoration(labelText: serviceSignatureText(widget.locale, 'summary'))),
            const SizedBox(height: 12),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: acknowledged,
              onChanged: (value) => setDialogState(() => acknowledged = value == true),
              title: Text(serviceSignatureText(widget.locale, 'ack')),
            ),
            Text(serviceSignatureText(widget.locale, 'notice'), style: Theme.of(context).textTheme.bodySmall),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(serviceSignatureText(widget.locale, 'cancel'))),
            FilledButton(onPressed: acknowledged ? () => Navigator.pop(dialogContext, true) : null, child: Text(serviceSignatureText(widget.locale, 'save'))),
          ],
        ),
      )),
    );
    if (accepted != true) return;
    if (signerName.text.trim().isEmpty || summary.text.trim().isEmpty || (signerType == 'REPRESENTATIVE' && relationship.text.trim().isEmpty)) return;
    try {
      await api.create(appointmentId, {
        'idempotencyKey': 'mobile-signature-${DateTime.now().microsecondsSinceEpoch}',
        'signerType': signerType,
        'signerName': signerName.text.trim(),
        if (signerType == 'REPRESENTATIVE') 'representativeRelationship': relationship.text.trim(),
        'confirmationMethod': 'TYPED_CONFIRMATION',
        'serviceSummary': summary.text.trim(),
        'confirmedAt': DateTime.now().toUtc().toIso8601String(),
        'acknowledgesServiceReceipt': true,
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(serviceSignatureText(widget.locale, 'saved'))));
      await load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }
}

class _SignatureApi {
  const _SignatureApi(this.session);
  final CarePointSession session;
  Future<Map<String, dynamic>> list(String appointmentId) => _request('GET', '/provider/service-signatures/appointments/$appointmentId');
  Future<Map<String, dynamic>> create(String appointmentId, Map<String, dynamic> body) => _request('POST', '/provider/service-signatures/appointments/$appointmentId', body: body);
  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body}) async {
    await session.api.me();
    final token = session.api.accessToken;
    if (token == null || token.isEmpty) throw const CarePointApiException('Authentication is required.');
    final uri = Uri.parse('${session.api.baseUrl}$path');
    final headers = <String, String>{'accept': 'application/json', 'authorization': 'Bearer $token', if (body != null) 'content-type': 'application/json'};
    final response = method == 'GET' ? await http.get(uri, headers: headers) : await http.post(uri, headers: headers, body: jsonEncode(body));
    dynamic payload;
    if (response.body.isNotEmpty) { try { payload = jsonDecode(response.body); } catch (_) { payload = response.body; } }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null ? payload['message'].toString() : 'Request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    return _map(payload);
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}
List<Map<String, dynamic>> _list(dynamic value) => value is List ? value.map(_map).toList(growable: false) : const [];
String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year} ${two(value.hour)}:${two(value.minute)}';
}
