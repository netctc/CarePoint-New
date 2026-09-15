import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:flutter/material.dart';

typedef DoctorActiveBuilder = Widget Function(BuildContext context);

class DoctorAccessGate extends StatefulWidget {
  const DoctorAccessGate({
    super.key,
    required this.session,
    required this.locale,
    required this.onSignOut,
    required this.activeBuilder,
    this.accent = const Color(0xFF22D3EE),
    this.dark = true,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onSignOut;
  final DoctorActiveBuilder activeBuilder;
  final Color accent;
  final bool dark;

  @override
  State<DoctorAccessGate> createState() => _DoctorAccessGateState();
}

class _DoctorAccessGateState extends State<DoctorAccessGate> {
  bool busy = true;
  String? error;
  Map<String, dynamic> state = const {};
  List<Map<String, dynamic>> specialties = const [];
  String? selectedSpecialtyId;

  CarePointApi get api => widget.session.api;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    if (mounted) setState(() { busy = true; error = null; });
    try {
      final values = await Future.wait<dynamic>([
        api.providerOnboardingState(),
        api.doctorSpecialties(),
      ]);
      if (!mounted) return;
      final nextState = _map(values[0]);
      final nextSpecialties = _list(values[1]);
      final onboarding = _map(nextState['onboarding']);
      final currentSpecialty = _map(onboarding['specialty']);
      setState(() {
        state = nextState;
        specialties = nextSpecialties;
        selectedSpecialtyId = currentSpecialty['id']?.toString() ??
            (nextSpecialties.isEmpty ? null : nextSpecialties.first['id']?.toString());
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (busy) {
      return Scaffold(
        backgroundColor: widget.dark ? const Color(0xFF0F172A) : null,
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (state['accessReady'] == true) return widget.activeBuilder(context);
    return _credentialingScaffold();
  }

  Widget _credentialingScaffold() {
    final provider = _map(state['provider']);
    final onboarding = _map(state['onboarding']);
    final providerStatus = provider['status']?.toString();
    final onboardingState = onboarding['state']?.toString();
    final credentials = _list(onboarding['credentials']);
    final specialty = _map(onboarding['specialty']);
    final canEdit = onboardingState == 'DRAFT' || onboardingState == 'REQUEST_CHANGES';
    final canStart = (onboarding.isEmpty || onboardingState == 'REJECTED') && providerStatus != 'SUSPENDED';
    final suspended = providerStatus == 'SUSPENDED';

    return Scaffold(
      backgroundColor: widget.dark ? const Color(0xFF0F172A) : null,
      appBar: AppBar(
        title: Text(_t('credentialing')),
        actions: [
          IconButton(onPressed: refresh, tooltip: _t('refresh'), icon: const Icon(Icons.refresh_rounded)),
          PopupMenuButton<String>(
            onSelected: (value) { if (value == 'logout') widget.onSignOut(); },
            itemBuilder: (_) => [PopupMenuItem(value: 'logout', child: Text(cpText(widget.locale, 'auth.signOut')))],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(_t('title'), style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900)),
            const SizedBox(height: 5),
            Text(_t('subtitle'), style: const TextStyle(color: Color(0xFF94A3B8))),
            if (error != null) ...[
              const SizedBox(height: 14),
              _notice(Icons.error_outline, error!, const Color(0xFFDC2626)),
            ],
            const SizedBox(height: 16),
            _statusCard(provider, onboarding),
            if (suspended) ...[
              const SizedBox(height: 12),
              _notice(Icons.block, _t('suspendedHint'), const Color(0xFFDC2626)),
            ],
            if (onboarding['reviewNote']?.toString().trim().isNotEmpty == true) ...[
              const SizedBox(height: 12),
              _notice(Icons.rate_review_outlined, onboarding['reviewNote'].toString(), const Color(0xFFF59E0B)),
            ],
            if (canStart) ...[
              const SizedBox(height: 12),
              _startCard(),
            ],
            if (onboarding.isNotEmpty) ...[
              const SizedBox(height: 12),
              _specialtyCard(specialty),
              const SizedBox(height: 12),
              _credentialsCard(credentials, canEdit),
              if (canEdit) ...[
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: credentials.isEmpty ? null : () => _submit(onboarding['id']?.toString() ?? ''),
                  icon: const Icon(Icons.send_outlined),
                  label: Text(_t('submitReview')),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: widget.accent, foregroundColor: const Color(0xFF06202A)),
                ),
              ],
            ],
            if (onboardingState == 'PENDING_REVIEW') ...[
              const SizedBox(height: 12),
              _notice(Icons.hourglass_top_rounded, _t('pendingHint'), const Color(0xFF38BDF8)),
            ],
            if (onboardingState == 'APPROVED' && providerStatus != 'ACTIVE') ...[
              const SizedBox(height: 12),
              _notice(Icons.sync_problem_outlined, _t('approvedNotActiveHint'), const Color(0xFFF59E0B)),
            ],
            const SizedBox(height: 28),
          ],
        ),
      ),
    );
  }

  Widget _statusCard(Map<String, dynamic> provider, Map<String, dynamic> onboarding) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _section(Icons.verified_user_outlined, _t('accessStatus')),
            const SizedBox(height: 12),
            _kv(_t('providerStatus'), provider['status'] ?? _t('notCreated')),
            _kv(_t('applicationStatus'), onboarding['state'] ?? _t('notStarted')),
            if (onboarding['submittedAt'] != null) _kv(_t('submitted'), _dateTime(onboarding['submittedAt'])),
            if (onboarding['reviewedAt'] != null) _kv(_t('reviewed'), _dateTime(onboarding['reviewedAt'])),
          ]),
        ),
      );

  Widget _startCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _section(Icons.medical_information_outlined, _t('startApplication')),
            const SizedBox(height: 8),
            Text(_t('startHint'), style: const TextStyle(color: Color(0xFF94A3B8))),
            const SizedBox(height: 12),
            if (specialties.isEmpty)
              Text(_t('noSpecialties'), style: const TextStyle(color: Color(0xFFF59E0B)))
            else ...[
              DropdownButtonFormField<String>(
                initialValue: selectedSpecialtyId,
                decoration: InputDecoration(labelText: _t('specialty'), border: const OutlineInputBorder()),
                items: specialties.map((item) => DropdownMenuItem(
                  value: item['id']?.toString(),
                  child: Text(_localized(item['labels'], item['code']?.toString() ?? _t('specialty'))),
                )).toList(),
                onChanged: (value) => setState(() => selectedSpecialtyId = value),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: selectedSpecialtyId == null ? null : _start,
                icon: const Icon(Icons.play_arrow_rounded),
                label: Text(_t('startApplication')),
              ),
            ],
          ]),
        ),
      );

  Widget _specialtyCard(Map<String, dynamic> specialty) => Card(
        child: ListTile(
          leading: CircleAvatar(backgroundColor: widget.accent.withValues(alpha: .14), child: Icon(Icons.medical_services_outlined, color: widget.accent)),
          title: Text(_t('specialty'), style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text(_localized(specialty['labels'], specialty['code']?.toString() ?? '—')),
        ),
      );

  Widget _credentialsCard(List<Map<String, dynamic>> credentials, bool canEdit) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: _section(Icons.badge_outlined, _t('credentials'))),
              if (canEdit)
                IconButton(onPressed: _addLicense, tooltip: _t('addLicense'), icon: const Icon(Icons.add_circle_outline)),
            ]),
            const SizedBox(height: 8),
            if (credentials.isEmpty)
              Text(_t('noCredentials'), style: const TextStyle(color: Color(0xFF94A3B8)))
            else
              ...credentials.map((item) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(_credentialIcon(item['state']?.toString()), color: _credentialColor(item['state']?.toString())),
                title: Text(_credentialLabel(item['type']?.toString()), style: const TextStyle(fontWeight: FontWeight.w800)),
                subtitle: Text([
                  if (item['number']?.toString().trim().isNotEmpty == true) '${_t('licenseNumber')}: ${item['number']}',
                  if (item['issuer']?.toString().trim().isNotEmpty == true) '${_t('issuer')}: ${item['issuer']}',
                  if (item['validUntil'] != null) '${_t('validUntil')}: ${_date(item['validUntil'])}',
                  '${_t('reviewState')}: ${item['state'] ?? 'PENDING'}',
                  if (item['reviewNote']?.toString().trim().isNotEmpty == true) '${_t('reviewNote')}: ${item['reviewNote']}',
                ].join('\n')),
                isThreeLine: true,
              )),
            if (canEdit) ...[
              const Divider(),
              OutlinedButton.icon(onPressed: _addLicense, icon: const Icon(Icons.add), label: Text(_t('addLicense'))),
            ],
          ]),
        ),
      );

  Future<void> _start() async {
    final specialtyId = selectedSpecialtyId;
    if (specialtyId == null) return;
    await _run(() => api.startDoctorOnboarding(specialtyId), success: _t('applicationStarted'));
  }

  Future<void> _addLicense() async {
    final onboarding = _map(state['onboarding']);
    final id = onboarding['id']?.toString() ?? '';
    if (id.isEmpty) return;
    final number = TextEditingController();
    final issuer = TextEditingController();
    final validUntil = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(_t('addLicense')),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: number,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(labelText: _t('licenseNumber'), border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextField(controller: issuer, decoration: InputDecoration(labelText: _t('issuerOptional'), border: const OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(
              controller: validUntil,
              keyboardType: TextInputType.datetime,
              decoration: InputDecoration(labelText: _t('validUntilOptional'), hintText: 'YYYY-MM-DD', border: const OutlineInputBorder()),
            ),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(_t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_t('save'))),
        ],
      ),
    );
    if (accepted != true) {
      number.dispose(); issuer.dispose(); validUntil.dispose();
      return;
    }
    final licenseNumber = number.text.trim();
    final licenseIssuer = issuer.text.trim();
    final expiry = validUntil.text.trim();
    number.dispose(); issuer.dispose(); validUntil.dispose();
    if (licenseNumber.isEmpty) {
      _snack(_t('licenseRequired'));
      return;
    }
    await _run(
      () => api.addProviderOnboardingCredential(
        id,
        type: 'medical-license',
        number: licenseNumber,
        issuer: licenseIssuer.isEmpty ? null : licenseIssuer,
        validUntil: expiry.isEmpty ? null : expiry,
      ),
      success: _t('licenseAdded'),
    );
  }

  Future<void> _submit(String id) async {
    if (id.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(_t('submitReview')),
        content: Text(_t('submitHint')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(_t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_t('submitReview'))),
        ],
      ),
    );
    if (confirmed != true) return;
    await _run(() => api.submitProviderOnboarding(id), success: _t('submittedSuccess'));
  }

  Future<void> _run(Future<dynamic> Function() operation, {required String success}) async {
    setState(() => busy = true);
    try {
      await operation();
      _snack(success);
      await refresh();
    } catch (value) {
      if (mounted) setState(() { busy = false; error = value.toString(); });
      _snack(value.toString());
    }
  }

  Widget _section(IconData icon, String text) => Row(children: [
    Icon(icon, color: widget.accent),
    const SizedBox(width: 8),
    Expanded(child: Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))),
  ]);

  Widget _kv(String label, dynamic value) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(width: 140, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF94A3B8)))),
      Expanded(child: Text(value?.toString() ?? '—')),
    ]),
  );

  Widget _notice(IconData icon, String text, Color color) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(color: color.withValues(alpha: .10), border: Border.all(color: color.withValues(alpha: .45)), borderRadius: BorderRadius.circular(14)),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(icon, color: color), const SizedBox(width: 10), Expanded(child: Text(text))]),
  );

  String _localized(dynamic labels, String fallback) {
    final map = _map(labels);
    final value = map[widget.locale.name]?.toString();
    return value?.trim().isNotEmpty == true ? value! : fallback;
  }

  String _credentialLabel(String? type) => type == 'medical-license' ? _t('medicalLicense') : (type ?? _t('credential'));
  IconData _credentialIcon(String? state) => state == 'VERIFIED' ? Icons.verified_outlined : state == 'REJECTED' ? Icons.cancel_outlined : Icons.hourglass_empty_rounded;
  Color _credentialColor(String? state) => state == 'VERIFIED' ? const Color(0xFF10B981) : state == 'REJECTED' ? const Color(0xFFEF4444) : const Color(0xFFF59E0B);

  String _date(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    return '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  }

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    return '${_date(value.toIso8601String())} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
  }

  void _snack(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _t(String key) => _doctorAccessText[widget.locale.name]?[key] ?? _doctorAccessText['en']![key] ?? key;
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

const Map<String, Map<String, String>> _doctorAccessText = {
  'en': {
    'credentialing': 'Doctor credentialing', 'title': 'Professional access', 'subtitle': 'Complete and track your doctor verification before clinical access is enabled.', 'refresh': 'Refresh',
    'accessStatus': 'Access status', 'providerStatus': 'Provider status', 'applicationStatus': 'Application status', 'notCreated': 'Not created', 'notStarted': 'Not started', 'submitted': 'Submitted', 'reviewed': 'Reviewed',
    'startApplication': 'Start doctor application', 'startHint': 'Select your medical specialty. Doctor and Other Provider onboarding remain strictly separated.', 'specialty': 'Medical specialty', 'noSpecialties': 'No active medical specialties are available.', 'applicationStarted': 'Doctor application started.',
    'credentials': 'Credentials', 'noCredentials': 'Add your medical license before submitting.', 'addLicense': 'Add medical license', 'medicalLicense': 'Medical license', 'credential': 'Credential', 'licenseNumber': 'License number', 'issuer': 'Issuer', 'issuerOptional': 'Issuer (optional)', 'validUntil': 'Valid until', 'validUntilOptional': 'Valid until (optional)', 'reviewState': 'Review state', 'reviewNote': 'Review note', 'licenseRequired': 'A medical license number is required.', 'licenseAdded': 'Medical license added.',
    'submitReview': 'Submit for review', 'submitHint': 'After submission, credentials cannot be edited until the review team requests changes.', 'submittedSuccess': 'Application submitted for review.', 'pendingHint': 'Your application is under review. Clinical workspace access remains locked until approval.',
    'suspendedHint': 'Your provider access is suspended. A new onboarding cannot override a suspension; contact CarePoint support or governance.', 'approvedNotActiveHint': 'Your application is approved but provider activation is not complete. Refresh or contact support if this persists.',
    'cancel': 'Cancel', 'save': 'Save',
  },
  'ar': {
    'credentialing': 'اعتماد الطبيب', 'title': 'الوصول المهني', 'subtitle': 'أكمل وتابع التحقق المهني قبل تفعيل الوصول السريري.', 'refresh': 'تحديث',
    'accessStatus': 'حالة الوصول', 'providerStatus': 'حالة مقدم الخدمة', 'applicationStatus': 'حالة الطلب', 'notCreated': 'غير منشأ', 'notStarted': 'لم يبدأ', 'submitted': 'تم الإرسال', 'reviewed': 'تمت المراجعة',
    'startApplication': 'بدء طلب طبيب', 'startHint': 'اختر تخصصك الطبي. يبقى مسار الأطباء منفصلاً تماماً عن مقدمي الخدمات الآخرين.', 'specialty': 'التخصص الطبي', 'noSpecialties': 'لا توجد تخصصات طبية نشطة.', 'applicationStarted': 'تم بدء طلب الطبيب.',
    'credentials': 'الاعتمادات', 'noCredentials': 'أضف الترخيص الطبي قبل الإرسال.', 'addLicense': 'إضافة ترخيص طبي', 'medicalLicense': 'الترخيص الطبي', 'credential': 'اعتماد', 'licenseNumber': 'رقم الترخيص', 'issuer': 'جهة الإصدار', 'issuerOptional': 'جهة الإصدار (اختياري)', 'validUntil': 'صالح حتى', 'validUntilOptional': 'صالح حتى (اختياري)', 'reviewState': 'حالة المراجعة', 'reviewNote': 'ملاحظة المراجعة', 'licenseRequired': 'رقم الترخيص الطبي مطلوب.', 'licenseAdded': 'تمت إضافة الترخيص الطبي.',
    'submitReview': 'إرسال للمراجعة', 'submitHint': 'بعد الإرسال لا يمكن تعديل الاعتمادات حتى يطلب فريق المراجعة تغييرات.', 'submittedSuccess': 'تم إرسال الطلب للمراجعة.', 'pendingHint': 'طلبك قيد المراجعة. يبقى الوصول السريري مقفلاً حتى الموافقة.',
    'suspendedHint': 'وصول مقدم الخدمة موقوف. لا يمكن لطلب جديد تجاوز الإيقاف؛ تواصل مع الدعم أو الحوكمة.', 'approvedNotActiveHint': 'تمت الموافقة على الطلب لكن التفعيل لم يكتمل. حدّث الصفحة أو تواصل مع الدعم إذا استمرت الحالة.',
    'cancel': 'إلغاء', 'save': 'حفظ',
  },
  'fr': {
    'credentialing': 'Accréditation médecin', 'title': 'Accès professionnel', 'subtitle': 'Complétez et suivez votre vérification avant l’activation de l’accès clinique.', 'refresh': 'Actualiser',
    'accessStatus': 'État d’accès', 'providerStatus': 'Statut fournisseur', 'applicationStatus': 'Statut du dossier', 'notCreated': 'Non créé', 'notStarted': 'Non démarré', 'submitted': 'Soumis', 'reviewed': 'Révisé',
    'startApplication': 'Démarrer le dossier médecin', 'startHint': 'Choisissez votre spécialité médicale. Les parcours médecin et autre fournisseur restent strictement séparés.', 'specialty': 'Spécialité médicale', 'noSpecialties': 'Aucune spécialité active disponible.', 'applicationStarted': 'Dossier médecin démarré.',
    'credentials': 'Justificatifs', 'noCredentials': 'Ajoutez votre licence médicale avant de soumettre.', 'addLicense': 'Ajouter la licence médicale', 'medicalLicense': 'Licence médicale', 'credential': 'Justificatif', 'licenseNumber': 'Numéro de licence', 'issuer': 'Émetteur', 'issuerOptional': 'Émetteur (facultatif)', 'validUntil': 'Valide jusqu’au', 'validUntilOptional': 'Valide jusqu’au (facultatif)', 'reviewState': 'État de revue', 'reviewNote': 'Note de revue', 'licenseRequired': 'Le numéro de licence médicale est obligatoire.', 'licenseAdded': 'Licence médicale ajoutée.',
    'submitReview': 'Soumettre pour revue', 'submitHint': 'Après soumission, les justificatifs restent verrouillés jusqu’à une demande de modification.', 'submittedSuccess': 'Dossier soumis pour revue.', 'pendingHint': 'Votre dossier est en cours de revue. L’accès clinique reste verrouillé jusqu’à approbation.',
    'suspendedHint': 'Votre accès fournisseur est suspendu. Un nouveau dossier ne peut pas contourner la suspension ; contactez le support ou la gouvernance.', 'approvedNotActiveHint': 'Le dossier est approuvé mais l’activation fournisseur n’est pas terminée. Actualisez ou contactez le support.',
    'cancel': 'Annuler', 'save': 'Enregistrer',
  },
  'es': {
    'credentialing': 'Acreditación médica', 'title': 'Acceso profesional', 'subtitle': 'Completa y sigue la verificación del médico antes de habilitar el acceso clínico.', 'refresh': 'Actualizar',
    'accessStatus': 'Estado de acceso', 'providerStatus': 'Estado del proveedor', 'applicationStatus': 'Estado de la solicitud', 'notCreated': 'No creado', 'notStarted': 'No iniciada', 'submitted': 'Enviada', 'reviewed': 'Revisada',
    'startApplication': 'Iniciar solicitud de médico', 'startHint': 'Selecciona tu especialidad médica. Los flujos de Doctor y Other Provider permanecen estrictamente separados.', 'specialty': 'Especialidad médica', 'noSpecialties': 'No hay especialidades médicas activas.', 'applicationStarted': 'Solicitud de médico iniciada.',
    'credentials': 'Credenciales', 'noCredentials': 'Añade tu licencia médica antes de enviar.', 'addLicense': 'Añadir licencia médica', 'medicalLicense': 'Licencia médica', 'credential': 'Credencial', 'licenseNumber': 'Número de licencia', 'issuer': 'Entidad emisora', 'issuerOptional': 'Entidad emisora (opcional)', 'validUntil': 'Válida hasta', 'validUntilOptional': 'Válida hasta (opcional)', 'reviewState': 'Estado de revisión', 'reviewNote': 'Nota de revisión', 'licenseRequired': 'El número de licencia médica es obligatorio.', 'licenseAdded': 'Licencia médica añadida.',
    'submitReview': 'Enviar a revisión', 'submitHint': 'Después del envío, las credenciales quedan bloqueadas hasta que el equipo de revisión solicite cambios.', 'submittedSuccess': 'Solicitud enviada a revisión.', 'pendingHint': 'Tu solicitud está en revisión. El acceso al workspace clínico permanece bloqueado hasta la aprobación.',
    'suspendedHint': 'Tu acceso como proveedor está suspendido. Una nueva solicitud no puede saltarse la suspensión; contacta con soporte o gobernanza.', 'approvedNotActiveHint': 'La solicitud está aprobada pero la activación del proveedor no ha terminado. Actualiza o contacta con soporte si persiste.',
    'cancel': 'Cancelar', 'save': 'Guardar',
  },
};