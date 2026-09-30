import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientRefillRequestsPage extends StatefulWidget {
  const PatientRefillRequestsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientRefillRequestsPage> createState() => _PatientRefillRequestsPageState();
}

class _PatientRefillRequestsPageState extends State<PatientRefillRequestsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> prescriptions = const [];
  List<Map<String, dynamic>> requests = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => patientRefillText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        api.patientClinicalOrders(),
        api.patientRefillRequests(),
      ]);
      if (!mounted) return;
      final orders = _maps(values[0]['items']);
      setState(() {
        prescriptions = orders
            .where((item) => item['type']?.toString() == 'PRESCRIPTION')
            .toList(growable: false);
        requests = _maps(values[1]['items']);
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
      actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    body: loading && prescriptions.isEmpty
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(12),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Card(child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Text(t('intro'), style: const TextStyle(color: Color(0xFF475569))),
                )),
                if (error != null)
                  Card(child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  )),
                if (!loading && error == null && prescriptions.isEmpty)
                  Padding(padding: const EdgeInsets.all(28), child: Text(t('empty'), textAlign: TextAlign.center)),
                ...prescriptions.map(_prescriptionCard),
              ],
            ),
          ),
  );

  Widget _prescriptionCard(Map<String, dynamic> order) {
    final data = _map(order['data']);
    final medication = _map(data['medication']);
    final sourceId = order['id']?.toString() ?? '';
    final related = requests
        .where((item) => item['sourcePrescriptionId']?.toString() == sourceId)
        .toList(growable: false)
      ..sort((a, b) => (b['requestedAt']?.toString() ?? '').compareTo(a['requestedAt']?.toString() ?? ''));
    final latest = related.isEmpty ? const <String, dynamic>{} : related.first;
    final allowance = _map(latest['refillAllowance']);
    final allowed = _int(data['refills'], 0);
    final remaining = latest.isEmpty ? allowed : _int(allowance['remaining'], 0);
    final open = latest['status']?.toString() == 'REQUESTED';
    final signed = order['status']?.toString() == 'SIGNED';
    final canRequest = signed && !open && remaining > 0;
    final name = medication['name']?.toString().trim();

    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.medication_outlined),
          title: Text(name?.isNotEmpty == true ? name! : t('prescription'), style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text([
            if (medication['strength']?.toString().trim().isNotEmpty == true) medication['strength'].toString(),
            if (data['dosageInstruction']?.toString().trim().isNotEmpty == true) data['dosageInstruction'].toString(),
            '${t('status')}: ${order['status'] ?? ''}',
            '${t('remaining')}: $remaining',
            if (latest.isNotEmpty) '${t('requestStatus')}: ${latest['status'] ?? ''} · ${_dateTime(latest['requestedAt'])}',
            if (_map(latest['review'])['reason']?.toString().trim().isNotEmpty == true)
              '${t('reviewReason')}: ${_map(latest['review'])['reason']}',
          ].where((value) => value.trim().isNotEmpty).join('\n')),
          isThreeLine: true,
        ),
        if (canRequest)
          FilledButton.tonalIcon(
            key: ValueKey('patient-refill-request-$sourceId'),
            onPressed: () => _request(order),
            icon: const Icon(Icons.autorenew_outlined),
            label: Text(t('request')),
          )
        else
          Text(
            open
                ? t('awaiting')
                : (!signed ? t('inactive') : (remaining <= 0 ? t('noneRemaining') : '')),
            style: const TextStyle(color: Color(0xFF64748B)),
          ),
      ]),
    ));
  }

  Future<void> _request(Map<String, dynamic> order) async {
    final controller = TextEditingController();
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(t('request')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(t('requestPrompt')),
        const SizedBox(height: 12),
        TextField(
          controller: controller,
          maxLines: 3,
          decoration: InputDecoration(labelText: t('optionalReason'), border: const OutlineInputBorder()),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
      ],
    ));
    final reason = controller.text.trim();
    controller.dispose();
    if (accepted != true) return;

    try {
      await api.requestPatientRefill(order['id'].toString(), reason: reason);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('submitted'))));
      await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }
}

String patientRefillText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Prescription refills','intro':'You can request a refill only for a signed prescription with remaining refill allowance. The responsible prescriber reviews every request; no prescription is created automatically.','refresh':'Refresh','empty':'No prescription orders are available.','prescription':'Prescription','status':'Prescription status','remaining':'Refills remaining','requestStatus':'Latest request','reviewReason':'Review reason','request':'Request refill','requestPrompt':'Send this prescription to the responsible prescriber for refill review?','optionalReason':'Reason (optional)','confirm':'Send request','cancel':'Cancel','submitted':'Refill request submitted.','awaiting':'A refill request is already awaiting review.','inactive':'This prescription is not active for refill.','noneRemaining':'No refill allowance remains.'
    },
    CarePointLocale.ar: {
      'title':'تجديد الوصفات','intro':'يمكنك طلب التجديد لوصفة موقعة لديها عدد تجديدات متبقٍ. يراجع الطبيب المسؤول كل طلب ولا يتم إنشاء وصفة تلقائياً.','refresh':'تحديث','empty':'لا توجد وصفات دوائية متاحة.','prescription':'وصفة','status':'حالة الوصفة','remaining':'التجديدات المتبقية','requestStatus':'آخر طلب','reviewReason':'سبب المراجعة','request':'طلب تجديد','requestPrompt':'إرسال هذه الوصفة إلى الطبيب المسؤول لمراجعة التجديد؟','optionalReason':'السبب (اختياري)','confirm':'إرسال الطلب','cancel':'إلغاء','submitted':'تم إرسال طلب التجديد.','awaiting':'يوجد طلب تجديد قيد المراجعة.','inactive':'هذه الوصفة غير نشطة للتجديد.','noneRemaining':'لا توجد تجديدات متبقية.'
    },
    CarePointLocale.fr: {
      'title':'Renouvellements d’ordonnance','intro':'Vous pouvez demander un renouvellement uniquement pour une ordonnance signée avec des renouvellements restants. Le prescripteur responsable examine chaque demande; aucune ordonnance n’est créée automatiquement.','refresh':'Actualiser','empty':'Aucune ordonnance disponible.','prescription':'Ordonnance','status':'Statut de l’ordonnance','remaining':'Renouvellements restants','requestStatus':'Dernière demande','reviewReason':'Motif de décision','request':'Demander un renouvellement','requestPrompt':'Envoyer cette ordonnance au prescripteur responsable pour examen du renouvellement ?','optionalReason':'Motif (facultatif)','confirm':'Envoyer','cancel':'Annuler','submitted':'Demande de renouvellement envoyée.','awaiting':'Une demande est déjà en attente d’examen.','inactive':'Cette ordonnance n’est pas active pour renouvellement.','noneRemaining':'Aucun renouvellement restant.'
    },
    CarePointLocale.es: {
      'title':'Renovación de recetas','intro':'Puedes solicitar renovación solo para una receta firmada con renovaciones restantes. El prescriptor responsable revisa cada solicitud; nunca se crea una receta automáticamente.','refresh':'Actualizar','empty':'No hay recetas disponibles.','prescription':'Receta','status':'Estado de la receta','remaining':'Renovaciones restantes','requestStatus':'Última solicitud','reviewReason':'Motivo de revisión','request':'Solicitar renovación','requestPrompt':'¿Enviar esta receta al prescriptor responsable para revisar la renovación?','optionalReason':'Motivo (opcional)','confirm':'Enviar solicitud','cancel':'Cancelar','submitted':'Solicitud de renovación enviada.','awaiting':'Ya hay una solicitud pendiente de revisión.','inactive':'Esta receta no está activa para renovación.','noneRemaining':'No quedan renovaciones disponibles.'
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

int _int(dynamic value, int fallback) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;

String _dateTime(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
