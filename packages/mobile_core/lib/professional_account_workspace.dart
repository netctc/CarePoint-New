import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class ProfessionalAccountWorkspace extends StatefulWidget {
  const ProfessionalAccountWorkspace({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.onSignOut,
    this.dark = false,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final VoidCallback onSignOut;
  final bool dark;

  @override
  State<ProfessionalAccountWorkspace> createState() => _ProfessionalAccountWorkspaceState();
}

class _ProfessionalAccountWorkspaceState extends State<ProfessionalAccountWorkspace> {
  bool busy = true;
  String? error;
  Map<String, dynamic> account = const {};
  Map<String, dynamic> mfa = const {};
  Map<String, dynamic> professional = const {};
  List<Map<String, dynamic>> sessions = const [];

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
        api.me(),
        api.mfaStatus(),
        api.accountSessions(),
        api.providerOnboardingState(),
      ]);
      if (!mounted) return;
      setState(() {
        account = _map(values[0]);
        mfa = _map(values[1]);
        sessions = _list(values[2]);
        professional = _map(values[3]);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: widget.dark ? const Color(0xFF0F172A) : null,
        appBar: AppBar(
          title: Text(_t('title')),
          actions: [IconButton(onPressed: busy ? null : refresh, tooltip: _t('refresh'), icon: const Icon(Icons.refresh_rounded))],
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? _errorBody()
                : RefreshIndicator(
                    onRefresh: refresh,
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        Text(_t('heading'), style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 4),
                        Text(_t('subtitle'), style: const TextStyle(color: Color(0xFF94A3B8))),
                        const SizedBox(height: 16),
                        _accountCard(),
                        const SizedBox(height: 12),
                        _professionalCard(),
                        const SizedBox(height: 12),
                        _mfaCard(),
                        const SizedBox(height: 12),
                        _sessionsCard(),
                        const SizedBox(height: 24),
                        OutlinedButton.icon(
                          onPressed: widget.onSignOut,
                          icon: const Icon(Icons.logout),
                          label: Text(_t('signOutThisDevice')),
                        ),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
      );

  Widget _errorBody() => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.error_outline, size: 42, color: Color(0xFFDC2626)),
            const SizedBox(height: 10),
            Text(error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(onPressed: refresh, icon: const Icon(Icons.refresh), label: Text(_t('retry'))),
          ]),
        ),
      );

  Widget _accountCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _section(Icons.person_outline, _t('account')),
            const SizedBox(height: 12),
            _kv(_t('email'), account['email']),
            _kv(_t('role'), account['role']),
            _kv(_t('status'), account['status']),
            _kv(_t('created'), _dateTime(account['createdAt'])),
          ]),
        ),
      );

  Widget _professionalCard() {
    final provider = _map(professional['provider']);
    final onboarding = _map(professional['onboarding']);
    final specialty = _map(onboarding['specialty']);
    final category = _map(onboarding['providerCategory']);
    final credentials = _list(onboarding['credentials']);
    final accessReady = professional['accessReady'] == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _section(Icons.verified_user_outlined, _t('professionalAccess')),
          const SizedBox(height: 12),
          Row(children: [
            Icon(accessReady ? Icons.check_circle : Icons.lock_outline, color: accessReady ? const Color(0xFF10B981) : const Color(0xFFF59E0B)),
            const SizedBox(width: 8),
            Expanded(child: Text(accessReady ? _t('clinicalEnabled') : _t('clinicalLocked'), style: const TextStyle(fontWeight: FontWeight.w800))),
          ]),
          const SizedBox(height: 10),
          _kv(_t('providerStatus'), provider['status'] ?? _t('notCreated')),
          _kv(_t('applicationStatus'), onboarding['state'] ?? _t('notStarted')),
          if (specialty.isNotEmpty) _kv(_t('specialty'), _localized(specialty['labels'], specialty['code']?.toString() ?? '—')),
          if (category.isNotEmpty) _kv(_t('category'), _localized(category['labels'], category['slug']?.toString() ?? '—')),
          if (credentials.isNotEmpty) ...[
            const Divider(),
            Text(_t('credentials'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            ...credentials.map((item) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(_credentialIcon(item['state']?.toString()), color: _credentialColor(item['state']?.toString())),
                  title: Text(item['type']?.toString() ?? _t('credential')),
                  subtitle: Text([
                    if (item['number']?.toString().trim().isNotEmpty == true) item['number'].toString(),
                    if (item['validUntil'] != null) '${_t('validUntil')}: ${_date(item['validUntil'])}',
                    '${_t('reviewState')}: ${item['state'] ?? 'PENDING'}',
                  ].join(' · ')),
                )),
          ],
        ]),
      ),
    );
  }

  Widget _mfaCard() {
    final enabled = mfa['enabled'] == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _section(Icons.shield_outlined, _t('mfa')),
          const SizedBox(height: 10),
          Row(children: [
            Icon(enabled ? Icons.verified_user : Icons.warning_amber_rounded, color: enabled ? const Color(0xFF10B981) : const Color(0xFFF59E0B)),
            const SizedBox(width: 8),
            Expanded(child: Text(enabled ? _t('mfaEnabled') : _t('mfaDisabled'), style: const TextStyle(fontWeight: FontWeight.w800))),
          ]),
          if (enabled && mfa['enabledAt'] != null) ...[
            const SizedBox(height: 6),
            Text('${_t('enabledAt')}: ${_dateTime(mfa['enabledAt'])}', style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
          ],
          if (!enabled) ...[
            const SizedBox(height: 12),
            FilledButton.tonalIcon(onPressed: _enrollMfa, icon: const Icon(Icons.phonelink_lock_outlined), label: Text(_t('enableMfa'))),
          ],
        ]),
      ),
    );
  }

  Widget _sessionsCard() {
    final activeCount = sessions.where((item) => item['active'] == true).length;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _section(Icons.devices_outlined, '${_t('sessions')} · $activeCount'),
          const SizedBox(height: 8),
          if (sessions.isEmpty)
            Text(_t('noSessions'), style: const TextStyle(color: Color(0xFF94A3B8)))
          else
            ...sessions.map((item) {
              final current = item['current'] == true;
              final active = item['active'] == true;
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  backgroundColor: current ? widget.accent.withValues(alpha: .15) : null,
                  child: Icon(current ? Icons.phone_android : Icons.devices_other, color: current ? widget.accent : null),
                ),
                title: Text(current ? _t('currentSession') : _t('otherSession'), style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text([
                  if ((item['userAgent']?.toString() ?? '').trim().isNotEmpty) item['userAgent'].toString(),
                  if ((item['ipAddress']?.toString() ?? '').trim().isNotEmpty) item['ipAddress'].toString(),
                  '${_t('created')}: ${_dateTime(item['createdAt'])}',
                ].join('\n'), maxLines: 4, overflow: TextOverflow.ellipsis),
                trailing: !current && active
                    ? IconButton(onPressed: () => _revokeSession(item['id']?.toString() ?? ''), tooltip: _t('revokeSession'), icon: const Icon(Icons.link_off))
                    : Icon(active ? Icons.check_circle_outline : Icons.block, color: active ? const Color(0xFF10B981) : const Color(0xFF94A3B8)),
              );
            }),
          const Divider(),
          OutlinedButton.icon(onPressed: _revokeAll, icon: const Icon(Icons.phonelink_erase), label: Text(_t('signOutAllDevices'))),
        ]),
      ),
    );
  }

  Future<void> _revokeSession(String id) async {
    if (id.isEmpty) return;
    try {
      await api.revokeAccountSession(id);
      _snack(_t('sessionRevoked'));
      await refresh();
    } catch (value) {
      _snack(value.toString());
    }
  }

  Future<void> _revokeAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(_t('signOutAllDevices')),
        content: Text(_t('signOutAllHint')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(_t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_t('confirm'))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await api.revokeAllAccountSessions();
    } finally {
      widget.onSignOut();
    }
  }

  Future<void> _enrollMfa() async {
    try {
      final enrollment = await api.beginMfaEnrollment();
      if (!mounted) return;
      final code = TextEditingController();
      final secret = enrollment['secret']?.toString() ?? '';
      final uri = enrollment['otpauthUri']?.toString() ?? '';
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(_t('enableMfa')),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(_t('mfaSetupHint')),
              const SizedBox(height: 12),
              SelectableText(secret, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700)),
              if (uri.isNotEmpty) ...[
                const SizedBox(height: 8),
                SelectableText(uri, style: const TextStyle(fontSize: 11)),
              ],
              const SizedBox(height: 14),
              TextField(controller: code, keyboardType: TextInputType.number, maxLength: 6, decoration: InputDecoration(labelText: _t('mfaCode'), border: const OutlineInputBorder())),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(_t('cancel'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_t('confirm'))),
          ],
        ),
      );
      final value = code.text.trim();
      code.dispose();
      if (confirmed != true || value.isEmpty) return;
      await api.confirmMfaEnrollment(value);
      _snack(_t('mfaEnabledSuccess'));
      await refresh();
    } catch (value) {
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

  String _localized(dynamic labels, String fallback) {
    final map = _map(labels);
    final value = map[widget.locale.name]?.toString();
    return value?.trim().isNotEmpty == true ? value! : fallback;
  }

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

  String _t(String key) => _professionalAccountText[widget.locale.name]?[key] ?? _professionalAccountText['en']![key] ?? key;
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

const Map<String, Map<String, String>> _professionalAccountText = {
  'en': {
    'title': 'Account & security', 'heading': 'Professional account', 'subtitle': 'Manage your professional access, MFA and signed-in devices.', 'refresh': 'Refresh', 'retry': 'Retry',
    'account': 'Account', 'email': 'Email', 'role': 'Role', 'status': 'Status', 'created': 'Created',
    'professionalAccess': 'Professional access', 'clinicalEnabled': 'Clinical workspace enabled', 'clinicalLocked': 'Clinical workspace locked', 'providerStatus': 'Provider status', 'applicationStatus': 'Application status', 'notCreated': 'Not created', 'notStarted': 'Not started', 'specialty': 'Medical specialty', 'category': 'Provider category', 'credentials': 'Credentials', 'credential': 'Credential', 'validUntil': 'Valid until', 'reviewState': 'Review state',
    'mfa': 'Multi-factor authentication', 'mfaEnabled': 'MFA is enabled', 'mfaDisabled': 'MFA is not enabled', 'enabledAt': 'Enabled', 'enableMfa': 'Enable MFA', 'mfaSetupHint': 'Add this secret or URI to your authenticator, then enter the current 6-digit code.', 'mfaCode': '6-digit code', 'mfaEnabledSuccess': 'MFA enabled.',
    'sessions': 'Sessions', 'noSessions': 'No sessions found.', 'currentSession': 'This device', 'otherSession': 'Other device', 'revokeSession': 'Revoke session', 'sessionRevoked': 'Session revoked.', 'signOutAllDevices': 'Sign out all devices', 'signOutAllHint': 'This revokes every active CarePoint session for your account, including this device.', 'signOutThisDevice': 'Sign out this device', 'cancel': 'Cancel', 'confirm': 'Confirm',
  },
  'ar': {
    'title': 'الحساب والأمان', 'heading': 'الحساب المهني', 'subtitle': 'إدارة الوصول المهني والمصادقة متعددة العوامل والأجهزة المسجلة.', 'refresh': 'تحديث', 'retry': 'إعادة المحاولة',
    'account': 'الحساب', 'email': 'البريد الإلكتروني', 'role': 'الدور', 'status': 'الحالة', 'created': 'تاريخ الإنشاء',
    'professionalAccess': 'الوصول المهني', 'clinicalEnabled': 'مساحة العمل السريرية مفعلة', 'clinicalLocked': 'مساحة العمل السريرية مقفلة', 'providerStatus': 'حالة مقدم الخدمة', 'applicationStatus': 'حالة الطلب', 'notCreated': 'غير منشأ', 'notStarted': 'لم يبدأ', 'specialty': 'التخصص الطبي', 'category': 'فئة مقدم الخدمة', 'credentials': 'الاعتمادات', 'credential': 'اعتماد', 'validUntil': 'صالح حتى', 'reviewState': 'حالة المراجعة',
    'mfa': 'المصادقة متعددة العوامل', 'mfaEnabled': 'المصادقة متعددة العوامل مفعلة', 'mfaDisabled': 'المصادقة متعددة العوامل غير مفعلة', 'enabledAt': 'تم التفعيل', 'enableMfa': 'تفعيل المصادقة متعددة العوامل', 'mfaSetupHint': 'أضف الرمز السري أو الرابط إلى تطبيق المصادقة ثم أدخل الرمز الحالي المكون من 6 أرقام.', 'mfaCode': 'رمز من 6 أرقام', 'mfaEnabledSuccess': 'تم تفعيل المصادقة متعددة العوامل.',
    'sessions': 'الجلسات', 'noSessions': 'لا توجد جلسات.', 'currentSession': 'هذا الجهاز', 'otherSession': 'جهاز آخر', 'revokeSession': 'إلغاء الجلسة', 'sessionRevoked': 'تم إلغاء الجلسة.', 'signOutAllDevices': 'تسجيل الخروج من جميع الأجهزة', 'signOutAllHint': 'سيتم إلغاء جميع جلسات CarePoint النشطة لهذا الحساب بما فيها هذا الجهاز.', 'signOutThisDevice': 'تسجيل الخروج من هذا الجهاز', 'cancel': 'إلغاء', 'confirm': 'تأكيد',
  },
  'fr': {
    'title': 'Compte et sécurité', 'heading': 'Compte professionnel', 'subtitle': 'Gérez votre accès professionnel, la MFA et les appareils connectés.', 'refresh': 'Actualiser', 'retry': 'Réessayer',
    'account': 'Compte', 'email': 'E-mail', 'role': 'Rôle', 'status': 'Statut', 'created': 'Créé',
    'professionalAccess': 'Accès professionnel', 'clinicalEnabled': 'Espace clinique activé', 'clinicalLocked': 'Espace clinique verrouillé', 'providerStatus': 'Statut fournisseur', 'applicationStatus': 'Statut du dossier', 'notCreated': 'Non créé', 'notStarted': 'Non démarré', 'specialty': 'Spécialité médicale', 'category': 'Catégorie fournisseur', 'credentials': 'Justificatifs', 'credential': 'Justificatif', 'validUntil': 'Valide jusqu’au', 'reviewState': 'État de revue',
    'mfa': 'Authentification multifacteur', 'mfaEnabled': 'MFA activée', 'mfaDisabled': 'MFA non activée', 'enabledAt': 'Activée', 'enableMfa': 'Activer la MFA', 'mfaSetupHint': 'Ajoutez ce secret ou cet URI à votre application d’authentification puis saisissez le code à 6 chiffres.', 'mfaCode': 'Code à 6 chiffres', 'mfaEnabledSuccess': 'MFA activée.',
    'sessions': 'Sessions', 'noSessions': 'Aucune session.', 'currentSession': 'Cet appareil', 'otherSession': 'Autre appareil', 'revokeSession': 'Révoquer la session', 'sessionRevoked': 'Session révoquée.', 'signOutAllDevices': 'Déconnecter tous les appareils', 'signOutAllHint': 'Toutes les sessions CarePoint actives de ce compte, y compris cet appareil, seront révoquées.', 'signOutThisDevice': 'Déconnecter cet appareil', 'cancel': 'Annuler', 'confirm': 'Confirmer',
  },
  'es': {
    'title': 'Cuenta y seguridad', 'heading': 'Cuenta profesional', 'subtitle': 'Gestiona tu acceso profesional, MFA y dispositivos con sesión iniciada.', 'refresh': 'Actualizar', 'retry': 'Reintentar',
    'account': 'Cuenta', 'email': 'Correo electrónico', 'role': 'Rol', 'status': 'Estado', 'created': 'Creada',
    'professionalAccess': 'Acceso profesional', 'clinicalEnabled': 'Workspace clínico habilitado', 'clinicalLocked': 'Workspace clínico bloqueado', 'providerStatus': 'Estado del proveedor', 'applicationStatus': 'Estado de la solicitud', 'notCreated': 'No creado', 'notStarted': 'No iniciada', 'specialty': 'Especialidad médica', 'category': 'Categoría del proveedor', 'credentials': 'Credenciales', 'credential': 'Credencial', 'validUntil': 'Válida hasta', 'reviewState': 'Estado de revisión',
    'mfa': 'Autenticación multifactor', 'mfaEnabled': 'MFA está habilitado', 'mfaDisabled': 'MFA no está habilitado', 'enabledAt': 'Habilitado', 'enableMfa': 'Habilitar MFA', 'mfaSetupHint': 'Añade este secreto o URI a tu autenticador y después introduce el código actual de 6 dígitos.', 'mfaCode': 'Código de 6 dígitos', 'mfaEnabledSuccess': 'MFA habilitado.',
    'sessions': 'Sesiones', 'noSessions': 'No hay sesiones.', 'currentSession': 'Este dispositivo', 'otherSession': 'Otro dispositivo', 'revokeSession': 'Revocar sesión', 'sessionRevoked': 'Sesión revocada.', 'signOutAllDevices': 'Cerrar sesión en todos los dispositivos', 'signOutAllHint': 'Se revocarán todas las sesiones CarePoint activas de esta cuenta, incluido este dispositivo.', 'signOutThisDevice': 'Cerrar sesión en este dispositivo', 'cancel': 'Cancelar', 'confirm': 'Confirmar',
  },
};