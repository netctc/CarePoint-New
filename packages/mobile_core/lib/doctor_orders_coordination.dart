import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorOrdersCoordinationPage extends StatefulWidget {
  const DoctorOrdersCoordinationPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
    required this.appointmentId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;
  final String appointmentId;

  @override
  State<DoctorOrdersCoordinationPage> createState() => _DoctorOrdersCoordinationPageState();
}

class _DoctorOrdersCoordinationPageState extends State<DoctorOrdersCoordinationPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> refills = const [];
  List<Map<String, dynamic>> imaging = const [];
  List<Map<String, dynamic>> referrals = const [];
  List<Map<String, dynamic>> incoming = const [];
  List<Map<String, dynamic>> destinations = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => doctorOrdersCoordinationText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait<dynamic>([
        api.doctorRefillRequests(),
        api.doctorImagingOrders(widget.patientId),
        api.doctorPatientReferrals(widget.patientId),
        api.doctorReferralInbox(),
        api.doctorReferralDestinations(),
      ]);
      if (!mounted) return;
      setState(() {
        refills = _maps(_map(values[0])['items']);
        imaging = _maps(_map(values[1])['items']);
        referrals = _maps(_map(values[2])['items']);
        incoming = _maps(_map(values[3])['items']);
        destinations = _maps(_map(values[4])['items']);
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
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
                  children: [
                    _section(t('refillInbox'), Icons.medication_outlined),
                    if (refills.isEmpty) _empty(t('noRefills')) else ...refills.map(_refillCard),
                    const SizedBox(height: 18),
                    _section(t('imagingOrders'), Icons.radiology_outlined, action: TextButton.icon(
                      onPressed: _createImaging,
                      icon: const Icon(Icons.add),
                      label: Text(t('newImaging')),
                    )),
                    if (imaging.isEmpty) _empty(t('noImaging')) else ...imaging.map(_imagingCard),
                    const SizedBox(height: 18),
                    _section(t('referrals'), Icons.forward_to_inbox_outlined, action: TextButton.icon(
                      onPressed: destinations.isEmpty ? null : _createReferral,
                      icon: const Icon(Icons.add),
                      label: Text(t('newReferral')),
                    )),
                    if (destinations.isEmpty)
                      Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(t('noDestinations'), style: const TextStyle(color: Color(0xFF64748B)))),
                    if (referrals.isEmpty) _empty(t('noReferrals')) else ...referrals.map(_referralCard),
                  ],
                ),
              ),
  );

  Widget _section(String label, IconData icon, {Widget? action}) => Row(children: [
    Icon(icon),
    const SizedBox(width: 8),
    Expanded(child: Text(label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))),
    if (action != null) action,
  ]);

  Widget _empty(String value) => Card(
    child: Padding(padding: const EdgeInsets.all(16), child: Text(value, style: const TextStyle(color: Color(0xFF64748B)))),
  );

  Widget _refillCard(Map<String, dynamic> item) {
    final request = _map(item['request']);
    final allowance = _map(item['refillAllowance']);
    final requested = item['status']?.toString() == 'REQUESTED';
    final patientMatches = item['patientId']?.toString() == widget.patientId;
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(patientMatches ? Icons.person_pin_circle_outlined : Icons.person_outline),
          title: Text('${t('refill')} · ${item['status'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text(
            '${t('patient')}: ${item['patientId'] ?? ''}\n'
            '${t('remaining')}: ${allowance['remaining'] ?? 0}\n'
            '${request['reason'] ?? t('noReason')}',
          ),
          isThreeLine: true,
        ),
        if (requested) Wrap(spacing: 8, runSpacing: 8, children: [
          FilledButton.tonalIcon(
            key: ValueKey('refill-approve-${item['id']}'),
            onPressed: () => _reviewRefill(item, 'APPROVE'),
            icon: const Icon(Icons.check_circle_outline),
            label: Text(t('approve')),
          ),
          OutlinedButton.icon(
            key: ValueKey('refill-decline-${item['id']}'),
            onPressed: () => _reviewRefill(item, 'DECLINE'),
            icon: const Icon(Icons.cancel_outlined),
            label: Text(t('decline')),
          ),
        ]),
      ]),
    ));
  }

  Future<void> _reviewRefill(Map<String, dynamic> item, String action) async {
    String? reason;
    if (action == 'APPROVE') {
      final ok = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(t('approveRefill')),
        content: Text(t('approveRefillPrompt')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
        ],
      ));
      if (ok != true) return;
    } else {
      reason = await _reasonDialog(t('declineRefill'), required: true);
      if (reason == null) return;
    }
    try {
      await api.reviewDoctorRefillRequest(
        item['id'].toString(),
        action: action,
        expectedVersion: _int(item['version'], 1),
        confirm: action == 'APPROVE',
        reason: reason,
      );
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Widget _imagingCard(Map<String, dynamic> item) {
    final data = _map(item['data']);
    return Card(child: ListTile(
      leading: const Icon(Icons.image_search_outlined),
      title: Text('${data['modality'] ?? item['modality'] ?? ''} · ${item['status'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text(
        '${t('priority')}: ${data['priority'] ?? item['priority'] ?? ''}\n'
        '${data['reason'] ?? ''}',
      ),
      isThreeLine: true,
      trailing: item['status'] == 'ORDERED'
          ? IconButton(
              key: ValueKey('imaging-cancel-${item['id']}'),
              tooltip: t('cancelOrder'),
              onPressed: () => _cancelImaging(item),
              icon: const Icon(Icons.cancel_outlined),
            )
          : null,
    ));
  }

  Future<void> _createImaging() async {
    String modality = 'XRAY';
    String priority = 'ROUTINE';
    final reason = TextEditingController();
    final bodySite = TextEditingController();
    final instructions = TextEditingController();
    String? validation;
    final ok = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(
      builder: (context, setLocal) => AlertDialog(
        title: Text(t('newImaging')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
            initialValue: modality,
            decoration: InputDecoration(labelText: t('modality')),
            items: const ['XRAY','CT','MRI','ULTRASOUND','MAMMOGRAPHY','NUCLEAR_MEDICINE','PET','OTHER']
                .map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(),
            onChanged: (value) => setLocal(() => modality = value ?? modality),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: priority,
            decoration: InputDecoration(labelText: t('priority')),
            items: const ['ROUTINE','URGENT','STAT'].map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(),
            onChanged: (value) => setLocal(() => priority = value ?? priority),
          ),
          const SizedBox(height: 10),
          TextField(controller: reason, maxLines: 3, decoration: InputDecoration(labelText: t('reason'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: bodySite, decoration: InputDecoration(labelText: t('bodySite'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: instructions, maxLines: 3, decoration: InputDecoration(labelText: t('instructions'), border: const OutlineInputBorder())),
          if (validation != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () {
            if (reason.text.trim().isEmpty) {
              setLocal(() => validation = t('reasonRequired'));
              return;
            }
            Navigator.pop(dialogContext, true);
          }, child: Text(t('create'))),
        ],
      ),
    ));
    if (ok == true) {
      try {
        await api.createDoctorImagingOrder(widget.patientId, {
          'idempotencyKey': 'mobile-imaging-${DateTime.now().microsecondsSinceEpoch}',
          'appointmentId': widget.appointmentId,
          'modality': modality,
          'priority': priority,
          'reason': reason.text.trim(),
          if (bodySite.text.trim().isNotEmpty) 'bodySite': bodySite.text.trim(),
          if (instructions.text.trim().isNotEmpty) 'instructions': instructions.text.trim(),
        });
        await _load();
      } catch (value) {
        _message(value.toString());
      }
    }
    reason.dispose();
    bodySite.dispose();
    instructions.dispose();
  }

  Future<void> _cancelImaging(Map<String, dynamic> item) async {
    final ok = await _confirm(t('cancelOrder'), t('cancelOrderPrompt'));
    if (!ok) return;
    try {
      await api.updateDoctorImagingOrder(item['id'].toString(), {
        'action': 'CANCEL',
        'expectedVersion': _int(item['version'], 1),
      });
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Widget _referralCard(Map<String, dynamic> item) {
    final incomingIds = incoming.map((value) => value['id']?.toString()).whereType<String>().toSet();
    final incomingReferral = incomingIds.contains(item['id']?.toString());
    final destination = _map(item['destinationProvider']);
    final referring = _map(item['referringProvider']);
    final share = _map(item['share']);
    final status = item['status']?.toString() ?? '';
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(incomingReferral ? Icons.inbox_outlined : Icons.outbox_outlined),
          title: Text('${item['priority'] ?? ''} · $status', style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text(
            '${t('from')}: ${referring['displayName'] ?? referring['id'] ?? ''}\n'
            '${t('to')}: ${destination['displayName'] ?? destination['id'] ?? ''}\n'
            '${item['reason'] ?? ''}\n'
            '${t('share')}: ${_strings(share['scopes']).join(', ')}',
          ),
          isThreeLine: true,
        ),
        Wrap(spacing: 8, runSpacing: 8, children: _referralActions(item, incomingReferral)),
      ]),
    ));
  }

  List<Widget> _referralActions(Map<String, dynamic> item, bool incomingReferral) {
    final status = item['status']?.toString();
    if (incomingReferral) {
      if (status == 'REQUESTED') {
        return [
          FilledButton.tonal(onPressed: () => _actReferral(item, 'ACCEPT'), child: Text(t('accept'))),
          OutlinedButton(onPressed: () => _actReferral(item, 'DECLINE'), child: Text(t('decline'))),
        ];
      }
      if (status == 'ACCEPTED') {
        return [
          FilledButton.tonal(onPressed: () => _actReferral(item, 'START'), child: Text(t('start'))),
          OutlinedButton(onPressed: () => _actReferral(item, 'COMPLETE'), child: Text(t('complete'))),
        ];
      }
      if (status == 'IN_PROGRESS') {
        return [FilledButton.tonal(onPressed: () => _actReferral(item, 'COMPLETE'), child: Text(t('complete')))];
      }
      return const [];
    }
    if (status == 'REQUESTED' || status == 'ACCEPTED' || status == 'IN_PROGRESS') {
      return [OutlinedButton(onPressed: () => _actReferral(item, 'CANCEL'), child: Text(t('cancelReferral')))];
    }
    return const [];
  }

  Future<void> _createReferral() async {
    if (destinations.isEmpty) return;
    String destinationId = destinations.first['id'].toString();
    String priority = 'ROUTINE';
    final reason = TextEditingController();
    final scopes = <String>{'CLINICAL_RECORD_READ', 'HEALTH_PROFILE_READ'};
    String? validation;
    final ok = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(
      builder: (context, setLocal) => AlertDialog(
        title: Text(t('newReferral')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
            initialValue: destinationId,
            decoration: InputDecoration(labelText: t('destination')),
            items: destinations.map((provider) => DropdownMenuItem(
              value: provider['id'].toString(),
              child: Text(_destinationLabel(provider)),
            )).toList(growable: false),
            onChanged: (value) => setLocal(() => destinationId = value ?? destinationId),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: priority,
            decoration: InputDecoration(labelText: t('priority')),
            items: const ['ROUTINE','URGENT'].map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(),
            onChanged: (value) => setLocal(() => priority = value ?? priority),
          ),
          const SizedBox(height: 10),
          TextField(controller: reason, maxLines: 4, decoration: InputDecoration(labelText: t('reason'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          Align(alignment: AlignmentDirectional.centerStart, child: Text(t('shareScopes'), style: const TextStyle(fontWeight: FontWeight.w800))),
          ...const ['CLINICAL_RECORD_READ','HEALTH_PROFILE_READ','QUESTIONNAIRE_READ','OBSERVATION_READ','CLINICAL_PROFILE_READ'].map((scope) =>
            CheckboxListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              value: scopes.contains(scope),
              title: Text(scope),
              onChanged: (checked) => setLocal(() {
                if (checked == true) { scopes.add(scope); } else { scopes.remove(scope); }
              }),
            )),
          if (validation != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () {
            if (reason.text.trim().isEmpty) {
              setLocal(() => validation = t('reasonRequired'));
              return;
            }
            if (scopes.isEmpty) {
              setLocal(() => validation = t('scopeRequired'));
              return;
            }
            Navigator.pop(dialogContext, true);
          }, child: Text(t('create'))),
        ],
      ),
    ));
    if (ok == true) {
      try {
        await api.createDoctorReferral(widget.patientId, {
          'idempotencyKey': 'mobile-referral-${DateTime.now().microsecondsSinceEpoch}',
          'destinationProviderId': destinationId,
          'priority': priority,
          'reason': reason.text.trim(),
          'scopes': scopes.toList(growable: false),
          'documentIds': const <String>[],
        });
        await _load();
      } catch (value) {
        _message(value.toString());
      }
    }
    reason.dispose();
  }

  Future<void> _actReferral(Map<String, dynamic> item, String action) async {
    String? reasonCode;
    if (action == 'DECLINE' || action == 'CANCEL') {
      reasonCode = await _reasonDialog(t(action == 'DECLINE' ? 'declineReferral' : 'cancelReferral'), required: true, codeMode: true);
      if (reasonCode == null) return;
    } else {
      final ok = await _confirm(t(action.toLowerCase()), t('transitionPrompt'));
      if (!ok) return;
    }
    try {
      await api.actDoctorReferral(item['id'].toString(), {
        'action': action,
        'expectedVersion': _int(item['version'], 1),
        if (reasonCode != null) 'reasonCode': reasonCode.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9_:-]'), '_'),
      });
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  Future<String?> _reasonDialog(String title, {required bool required, bool codeMode = false}) async {
    final controller = TextEditingController();
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        maxLines: codeMode ? 1 : 4,
        decoration: InputDecoration(
          labelText: codeMode ? t('reasonCode') : t('reason'),
          hintText: codeMode ? 'CLINICAL_REVIEW' : null,
          border: const OutlineInputBorder(),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, !required || controller.text.trim().isNotEmpty),
          child: Text(t('confirm')),
        ),
      ],
    ));
    final value = controller.text.trim();
    controller.dispose();
    if (accepted != true || (required && value.isEmpty)) return null;
    return value;
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
        ],
      )) ?? false;

  String _destinationLabel(Map<String, dynamic> provider) {
    final specialties = _maps(provider['specialties']);
    final primary = specialties.where((item) => item['primary'] == true).map((item) => item['code']?.toString()).whereType<String>().firstOrNull;
    final name = provider['displayName']?.toString().trim();
    return '${name?.isNotEmpty == true ? name : provider['id']}${primary == null ? '' : ' · $primary'}';
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

String doctorOrdersCoordinationText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Medication, imaging & referrals','missingPatient':'Patient context is unavailable.','refresh':'Refresh',
      'refillInbox':'Refill requests','noRefills':'No refill requests.','refill':'Refill request','patient':'Patient','remaining':'Refills remaining','noReason':'No reason provided.',
      'approve':'Approve','decline':'Decline','approveRefill':'Approve refill','approveRefillPrompt':'Confirm approval. The server will create a new signed prescription from the eligible source prescription.','declineRefill':'Decline refill',
      'imagingOrders':'Imaging orders','newImaging':'New imaging order','noImaging':'No imaging orders for this patient.','modality':'Modality','priority':'Priority','reason':'Reason','bodySite':'Body site','instructions':'Instructions','reasonRequired':'Reason is required.','cancelOrder':'Cancel order','cancelOrderPrompt':'Cancel this imaging order using its current version?',
      'referrals':'Referrals','newReferral':'New referral','noReferrals':'No referrals for this patient.','noDestinations':'No active Doctor referral destinations are available.','destination':'Destination Doctor','shareScopes':'Shared clinical scopes','share':'Shared scopes','from':'From','to':'To','scopeRequired':'Select at least one read scope.',
      'accept':'Accept','start':'Start','complete':'Complete','cancelReferral':'Cancel referral','declineReferral':'Decline referral','reasonCode':'Reason code','transitionPrompt':'Confirm this referral state transition.',
      'create':'Create','confirm':'Confirm','cancel':'Cancel'
    },
    CarePointLocale.ar: {
      'title':'الأدوية والتصوير والإحالات','missingPatient':'سياق المريض غير متاح.','refresh':'تحديث',
      'refillInbox':'طلبات تجديد الدواء','noRefills':'لا توجد طلبات تجديد.','refill':'طلب تجديد','patient':'المريض','remaining':'التجديدات المتبقية','noReason':'لا يوجد سبب.',
      'approve':'موافقة','decline':'رفض','approveRefill':'الموافقة على التجديد','approveRefillPrompt':'أكد الموافقة. سيُنشئ الخادم وصفة جديدة موقعة من الوصفة المؤهلة.','declineRefill':'رفض التجديد',
      'imagingOrders':'طلبات التصوير','newImaging':'طلب تصوير جديد','noImaging':'لا توجد طلبات تصوير لهذا المريض.','modality':'نوع التصوير','priority':'الأولوية','reason':'السبب','bodySite':'موضع الجسم','instructions':'التعليمات','reasonRequired':'السبب مطلوب.','cancelOrder':'إلغاء الطلب','cancelOrderPrompt':'إلغاء طلب التصوير باستخدام نسخته الحالية؟',
      'referrals':'الإحالات','newReferral':'إحالة جديدة','noReferrals':'لا توجد إحالات لهذا المريض.','noDestinations':'لا يوجد أطباء نشطون متاحون للإحالة.','destination':'الطبيب المحال إليه','shareScopes':'نطاقات البيانات المشتركة','share':'النطاقات المشتركة','from':'من','to':'إلى','scopeRequired':'اختر نطاق قراءة واحداً على الأقل.',
      'accept':'قبول','start':'بدء','complete':'إكمال','cancelReferral':'إلغاء الإحالة','declineReferral':'رفض الإحالة','reasonCode':'رمز السبب','transitionPrompt':'أكد انتقال حالة الإحالة.',
      'create':'إنشاء','confirm':'تأكيد','cancel':'إلغاء'
    },
    CarePointLocale.fr: {
      'title':'Médicaments, imagerie et orientations','missingPatient':'Le contexte patient est indisponible.','refresh':'Actualiser',
      'refillInbox':'Demandes de renouvellement','noRefills':'Aucune demande de renouvellement.','refill':'Demande de renouvellement','patient':'Patient','remaining':'Renouvellements restants','noReason':'Aucun motif.',
      'approve':'Approuver','decline':'Refuser','approveRefill':'Approuver le renouvellement','approveRefillPrompt':'Confirmez l’approbation. Le serveur créera une nouvelle prescription signée depuis la prescription source éligible.','declineRefill':'Refuser le renouvellement',
      'imagingOrders':'Demandes d’imagerie','newImaging':'Nouvelle demande d’imagerie','noImaging':'Aucune demande d’imagerie pour ce patient.','modality':'Modalité','priority':'Priorité','reason':'Motif','bodySite':'Site anatomique','instructions':'Instructions','reasonRequired':'Le motif est obligatoire.','cancelOrder':'Annuler la demande','cancelOrderPrompt':'Annuler cette demande d’imagerie avec sa version actuelle ?',
      'referrals':'Orientations','newReferral':'Nouvelle orientation','noReferrals':'Aucune orientation pour ce patient.','noDestinations':'Aucun médecin actif n’est disponible comme destination.','destination':'Médecin destinataire','shareScopes':'Périmètres cliniques partagés','share':'Périmètres partagés','from':'De','to':'Vers','scopeRequired':'Sélectionnez au moins un périmètre de lecture.',
      'accept':'Accepter','start':'Démarrer','complete':'Terminer','cancelReferral':'Annuler l’orientation','declineReferral':'Refuser l’orientation','reasonCode':'Code motif','transitionPrompt':'Confirmez cette transition d’état.',
      'create':'Créer','confirm':'Confirmer','cancel':'Annuler'
    },
    CarePointLocale.es: {
      'title':'Medicamentos, imagen y derivaciones','missingPatient':'No está disponible el contexto del paciente.','refresh':'Actualizar',
      'refillInbox':'Solicitudes de renovación','noRefills':'No hay solicitudes de renovación.','refill':'Solicitud de renovación','patient':'Paciente','remaining':'Renovaciones restantes','noReason':'Sin motivo indicado.',
      'approve':'Aprobar','decline':'Rechazar','approveRefill':'Aprobar renovación','approveRefillPrompt':'Confirma la aprobación. El servidor creará una nueva receta firmada a partir de la receta origen elegible.','declineRefill':'Rechazar renovación',
      'imagingOrders':'Órdenes de imagen','newImaging':'Nueva orden de imagen','noImaging':'No hay órdenes de imagen para este paciente.','modality':'Modalidad','priority':'Prioridad','reason':'Motivo','bodySite':'Zona corporal','instructions':'Instrucciones','reasonRequired':'El motivo es obligatorio.','cancelOrder':'Cancelar orden','cancelOrderPrompt':'¿Cancelar esta orden de imagen usando su versión actual?',
      'referrals':'Derivaciones','newReferral':'Nueva derivación','noReferrals':'No hay derivaciones para este paciente.','noDestinations':'No hay médicos activos disponibles como destino.','destination':'Médico de destino','shareScopes':'Ámbitos clínicos compartidos','share':'Ámbitos compartidos','from':'De','to':'A','scopeRequired':'Selecciona al menos un ámbito de lectura.',
      'accept':'Aceptar','start':'Iniciar','complete':'Completar','cancelReferral':'Cancelar derivación','declineReferral':'Rechazar derivación','reasonCode':'Código de motivo','transitionPrompt':'Confirma esta transición de estado.',
      'create':'Crear','confirm':'Confirmar','cancel':'Cancelar'
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

List<String> _strings(dynamic value) {
  if (value is! List) return const [];
  return value.whereType<String>().toList(growable: false);
}

int _int(dynamic value, int fallback) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
