import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String specimenText(CarePointLocale locale, String key) =>
    _specimenStrings[locale.name]?[key] ?? _specimenStrings['en']![key] ?? key;

const _specimenStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Specimens', 'collect': 'Collect specimen', 'type': 'Specimen type',
    'barcode': 'Barcode / label', 'condition': 'Condition', 'location': 'Location',
    'identifier': 'Specimen ID', 'collectedAt': 'Collected', 'status': 'Status',
    'custody': 'Add custody event', 'history': 'Custody history', 'event': 'Event',
    'receiver': 'Receiver', 'occurredAt': 'Timestamp', 'integrity': 'Integrity verified',
    'appendOnly': 'Append-only chain', 'empty': 'No specimens recorded for this order.',
    'save': 'Save', 'required': 'Required fields are missing.', 'refresh': 'Refresh',
    'saved': 'Specimen workflow updated', 'events': 'events',
  },
  'ar': {
    'title': 'العينات', 'collect': 'تسجيل أخذ عينة', 'type': 'نوع العينة',
    'barcode': 'الباركود / الملصق', 'condition': 'الحالة', 'location': 'الموقع',
    'identifier': 'معرّف العينة', 'collectedAt': 'وقت الجمع', 'status': 'الحالة',
    'custody': 'إضافة حدث عهدة', 'history': 'سجل سلسلة العهدة', 'event': 'الحدث',
    'receiver': 'المستلم', 'occurredAt': 'الوقت', 'integrity': 'تم التحقق من السلامة',
    'appendOnly': 'سلسلة غير قابلة للتعديل', 'empty': 'لا توجد عينات مسجلة لهذا الطلب.',
    'save': 'حفظ', 'required': 'الحقول المطلوبة غير مكتملة.', 'refresh': 'تحديث',
    'saved': 'تم تحديث مسار العينة', 'events': 'أحداث',
  },
  'fr': {
    'title': 'Prélèvements', 'collect': 'Enregistrer un prélèvement', 'type': 'Type de prélèvement',
    'barcode': 'Code-barres / étiquette', 'condition': 'État', 'location': 'Emplacement',
    'identifier': 'ID prélèvement', 'collectedAt': 'Prélevé', 'status': 'Statut',
    'custody': 'Ajouter un événement de garde', 'history': 'Chaîne de garde', 'event': 'Événement',
    'receiver': 'Récepteur', 'occurredAt': 'Horodatage', 'integrity': 'Intégrité vérifiée',
    'appendOnly': 'Chaîne append-only', 'empty': 'Aucun prélèvement pour cette demande.',
    'save': 'Enregistrer', 'required': 'Des champs obligatoires sont manquants.', 'refresh': 'Actualiser',
    'saved': 'Workflow du prélèvement mis à jour', 'events': 'événements',
  },
  'es': {
    'title': 'Muestras', 'collect': 'Registrar toma de muestra', 'type': 'Tipo de muestra',
    'barcode': 'Barcode / etiqueta', 'condition': 'Condición', 'location': 'Ubicación',
    'identifier': 'ID de muestra', 'collectedAt': 'Toma', 'status': 'Estado',
    'custody': 'Añadir evento de custodia', 'history': 'Cadena de custodia', 'event': 'Evento',
    'receiver': 'Receptor', 'occurredAt': 'Timestamp', 'integrity': 'Integridad verificada',
    'appendOnly': 'Cadena append-only', 'empty': 'No hay muestras registradas para esta orden.',
    'save': 'Guardar', 'required': 'Faltan campos obligatorios.', 'refresh': 'Actualizar',
    'saved': 'Flujo de muestra actualizado', 'events': 'eventos',
  },
};

class SpecimenWorkflowButton extends StatelessWidget {
  const SpecimenWorkflowButton({
    super.key,
    required this.session,
    required this.locale,
    required this.order,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) => Directionality(
              textDirection: locale.textDirection,
              child: SpecimenWorkflowPage(
                session: session,
                locale: locale,
                order: order,
              ),
            ),
          ),
        ),
        icon: const Icon(Icons.biotech_outlined),
        label: Text(specimenText(locale, 'title')),
      );
}

class SpecimenWorkflowPage extends StatefulWidget {
  const SpecimenWorkflowPage({
    super.key,
    required this.session,
    required this.locale,
    required this.order,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> order;

  @override
  State<SpecimenWorkflowPage> createState() => _SpecimenWorkflowPageState();
}

class _SpecimenWorkflowPageState extends State<SpecimenWorkflowPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> specimens = const [];

  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;
  String get orderId => widget.order['id'].toString();

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
      final result = await api.orderSpecimens(orderId);
      if (mounted) setState(() => specimens = _specimenList(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(specimenText(locale, 'title')),
          actions: [
            IconButton(
              onPressed: load,
              icon: const Icon(Icons.refresh),
              tooltip: specimenText(locale, 'refresh'),
            ),
          ],
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(error!, textAlign: TextAlign.center),
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                      children: [
                        if (specimens.isEmpty)
                          Padding(
                            padding: const EdgeInsets.all(32),
                            child: Center(child: Text(specimenText(locale, 'empty'))),
                          ),
                        ...specimens.map(_card),
                      ],
                    ),
                  ),
        floatingActionButton: widget.order['status'] == 'SIGNED'
            ? FloatingActionButton.extended(
                onPressed: _collect,
                icon: const Icon(Icons.add),
                label: Text(specimenText(locale, 'collect')),
              )
            : null,
      );

  Widget _card(Map<String, dynamic> specimen) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.biotech_outlined),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      specimen['specimenIdentifier']?.toString() ?? '—',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                  Chip(label: Text(specimen['status']?.toString() ?? '')),
                ],
              ),
              _line(specimenText(locale, 'type'), specimen['specimenTypeCode']),
              _line(specimenText(locale, 'barcode'), specimen['barcode']),
              _line(specimenText(locale, 'condition'), specimen['conditionCode']),
              if (specimen['collectionLocation'] != null)
                _line(specimenText(locale, 'location'), specimen['collectionLocation']),
              _line(
                specimenText(locale, 'collectedAt'),
                _dateTime(specimen['collectedAt']),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (specimen['status'] != 'DISPOSED')
                    FilledButton.tonalIcon(
                      onPressed: () => _appendCustody(specimen),
                      icon: const Icon(Icons.move_down_outlined),
                      label: Text(specimenText(locale, 'custody')),
                    ),
                  OutlinedButton.icon(
                    onPressed: () => _history(specimen),
                    icon: const Icon(Icons.history),
                    label: Text(specimenText(locale, 'history')),
                  ),
                ],
              ),
            ],
          ),
        ),
      );

  Widget _line(String label, dynamic value) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text.rich(
          TextSpan(
            children: [
              TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w700)),
              TextSpan(text: value?.toString() ?? '—'),
            ],
          ),
        ),
      );

  Future<void> _collect() async {
    final type = TextEditingController(text: 'BLOOD');
    final barcode = TextEditingController();
    final location = TextEditingController();
    String condition = 'ACCEPTABLE';
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setModal) => AlertDialog(
          title: Text(specimenText(locale, 'collect')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: type, decoration: InputDecoration(labelText: specimenText(locale, 'type'))),
                TextField(controller: barcode, decoration: InputDecoration(labelText: specimenText(locale, 'barcode'))),
                DropdownButtonFormField<String>(
                  initialValue: condition,
                  decoration: InputDecoration(labelText: specimenText(locale, 'condition')),
                  items: const [
                    DropdownMenuItem(value: 'ACCEPTABLE', child: Text('ACCEPTABLE')),
                    DropdownMenuItem(value: 'COMPROMISED', child: Text('COMPROMISED')),
                    DropdownMenuItem(value: 'REJECTED', child: Text('REJECTED')),
                  ],
                  onChanged: (value) => setModal(() => condition = value ?? condition),
                ),
                TextField(controller: location, decoration: InputDecoration(labelText: specimenText(locale, 'location'))),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(specimenText(locale, 'save'))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    if (type.text.trim().isEmpty) {
      _message(specimenText(locale, 'required'));
      return;
    }
    await _run(() => api.collectSpecimen(
          orderId: orderId,
          specimenTypeCode: type.text,
          collectedAt: DateTime.now(),
          conditionCode: condition,
          barcode: barcode.text,
          collectionLocation: location.text,
        ));
  }

  Future<void> _appendCustody(Map<String, dynamic> specimen) async {
    String eventType = 'TRANSFERRED';
    String condition = specimen['conditionCode']?.toString() ?? 'ACCEPTABLE';
    final receiver = TextEditingController();
    final location = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setModal) => AlertDialog(
          title: Text(specimenText(locale, 'custody')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: eventType,
                  decoration: InputDecoration(labelText: specimenText(locale, 'event')),
                  items: const [
                    DropdownMenuItem(value: 'TRANSFERRED', child: Text('TRANSFERRED')),
                    DropdownMenuItem(value: 'RECEIVED', child: Text('RECEIVED')),
                    DropdownMenuItem(value: 'PROCESSING', child: Text('PROCESSING')),
                    DropdownMenuItem(value: 'STORED', child: Text('STORED')),
                    DropdownMenuItem(value: 'DISPOSED', child: Text('DISPOSED')),
                  ],
                  onChanged: (value) => setModal(() => eventType = value ?? eventType),
                ),
                TextField(controller: receiver, decoration: InputDecoration(labelText: specimenText(locale, 'receiver'))),
                DropdownButtonFormField<String>(
                  initialValue: condition,
                  decoration: InputDecoration(labelText: specimenText(locale, 'condition')),
                  items: const [
                    DropdownMenuItem(value: 'ACCEPTABLE', child: Text('ACCEPTABLE')),
                    DropdownMenuItem(value: 'COMPROMISED', child: Text('COMPROMISED')),
                    DropdownMenuItem(value: 'REJECTED', child: Text('REJECTED')),
                  ],
                  onChanged: (value) => setModal(() => condition = value ?? condition),
                ),
                TextField(controller: location, decoration: InputDecoration(labelText: specimenText(locale, 'location'))),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(specimenText(locale, 'save'))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    if ((eventType == 'TRANSFERRED' || eventType == 'RECEIVED') && receiver.text.trim().isEmpty) {
      _message(specimenText(locale, 'required'));
      return;
    }
    await _run(() => api.appendSpecimenCustody(
          specimenId: specimen['id'].toString(),
          eventType: eventType,
          occurredAt: DateTime.now(),
          conditionCode: condition,
          receiverRef: receiver.text,
          location: location.text,
        ));
  }

  Future<void> _history(Map<String, dynamic> specimen) async {
    try {
      final result = await api.specimenCustodyHistory(specimen['id'].toString());
      if (!mounted) return;
      final integrity = _specimenMap(result['integrity']);
      final events = _specimenList(result['events']);
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: SafeArea(
            child: FractionallySizedBox(
              heightFactor: .82,
              child: Column(
                children: [
                  ListTile(
                    leading: Icon(
                      integrity['verified'] == true ? Icons.verified_user_outlined : Icons.warning_amber_outlined,
                    ),
                    title: Text(specimenText(locale, 'history'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: Text(
                      integrity['verified'] == true
                          ? '${specimenText(locale, 'integrity')} · ${events.length} ${specimenText(locale, 'events')} · ${specimenText(locale, 'appendOnly')}'
                          : 'Integrity verification failed',
                    ),
                    trailing: IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
                  ),
                  Expanded(
                    child: ListView.builder(
                      itemCount: events.length,
                      itemBuilder: (_, index) {
                        final event = events[index];
                        return ListTile(
                          leading: CircleAvatar(child: Text('${event['sequence'] ?? index + 1}')),
                          title: Text(event['eventType']?.toString() ?? ''),
                          subtitle: Text(
                            '${_dateTime(event['occurredAt'])}\n'
                            '${specimenText(locale, 'condition')}: ${event['conditionCode'] ?? ''}'
                            '${event['receiverRef'] == null ? '' : '\n${specimenText(locale, 'receiver')}: ${event['receiverRef']}'}'
                            '${event['location'] == null ? '' : '\n${specimenText(locale, 'location')}: ${event['location']}'}',
                          ),
                          isThreeLine: true,
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() action) async {
    try {
      await action();
      _message(specimenText(locale, 'saved'));
      await load();
    } catch (value) {
      _message(value.toString());
    }
  }

  void _message(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }
}

Map<String, dynamic> _specimenMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _specimenList(dynamic value) {
  if (value is! List) return const [];
  return value.map(_specimenMap).toList(growable: false);
}

String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
}
