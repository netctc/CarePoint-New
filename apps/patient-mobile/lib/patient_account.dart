import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:flutter/material.dart';

class PatientAccountPage extends StatefulWidget {
  const PatientAccountPage({
    super.key,
    required this.session,
    required this.locale,
    required this.onSignOut,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onSignOut;

  @override
  State<PatientAccountPage> createState() => _PatientAccountPageState();
}

class _PatientAccountPageState extends State<PatientAccountPage> {
  bool busy = true;
  bool savingPreferences = false;
  String? error;
  Map<String, dynamic> account = const {};
  Map<String, dynamic> mfa = const {};
  Map<String, dynamic> preferences = const {};
  List<Map<String, dynamic>> sessions = const [];
  List<Map<String, dynamic>> consents = const [];
  List<Map<String, dynamic>> endpoints = const [];
  List<Map<String, dynamic>> notifications = const [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (mounted) setState(() { busy = true; error = null; });
    try {
      final values = await Future.wait<dynamic>([
        widget.session.api.me(),
        widget.session.api.mfaStatus(),
        widget.session.api.accountSessions(),
        widget.session.api.patientConsents(),
        widget.session.api.notificationPreferences(),
        widget.session.api.notificationEndpoints(),
        widget.session.api.notifications(),
      ]);
      if (!mounted) return;
      setState(() {
        account = _map(values[0]);
        mfa = _map(values[1]);
        sessions = _list(values[2]);
        consents = _list(values[3]);
        preferences = _map(values[4]);
        endpoints = _list(values[5]);
        notifications = _list(values[6]);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.error_outline, size: 42, color: Color(0xFFDC2626)),
            const SizedBox(height: 10),
            Text(error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(onPressed: load, icon: const Icon(Icons.refresh), label: Text(_t('retry'))),
          ]),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(_t('title'), style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text(_t('subtitle'), style: const TextStyle(color: Color(0xFF64748B))),
          const SizedBox(height: 16),
          _accountCard(),
          const SizedBox(height: 12),
          _mfaCard(),
          const SizedBox(height: 12),
          _sessionsCard(),
          const SizedBox(height: 12),
          _notificationsCard(),
          const SizedBox(height: 12),
          _consentsCard(),
          const SizedBox(height: 28),
          OutlinedButton.icon(
            onPressed: widget.onSignOut,
            icon: const Icon(Icons.logout),
            label: Text(_t('signOutThisDevice')),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _accountCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _sectionTitle(Icons.person_outline, _t('account')),
            const SizedBox(height: 12),
            _kv(_t('email'), account['email']),
            _kv(_t('role'), account['role']),
            _kv(_t('status'), account['status']),
            _kv(_t('created'), _dateTime(account['createdAt'])),
          ]),
        ),
      );

  Widget _mfaCard() {
    final enabled = mfa['enabled'] == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _sectionTitle(Icons.shield_outlined, _t('mfa')),
          const SizedBox(height: 8),
          Row(children: [
            Icon(enabled ? Icons.verified_user : Icons.warning_amber_rounded, color: enabled ? const Color(0xFF059669) : const Color(0xFFD97706)),
            const SizedBox(width: 8),
            Expanded(child: Text(enabled ? _t('mfaEnabled') : _t('mfaDisabled'), style: const TextStyle(fontWeight: FontWeight.w700))),
          ]),
          if (!enabled) ...[
            const SizedBox(height: 12),
            FilledButton.tonalIcon(
              onPressed: _startMfa,
              icon: const Icon(Icons.qr_code_2),
              label: Text(_t('enableMfa')),
            ),
          ],
          if (enabled && mfa['enabledAt'] != null) ...[
            const SizedBox(height: 8),
            Text('${_t('enabledAt')}: ${_dateTime(mfa['enabledAt'])}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
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
          _sectionTitle(Icons.devices_outlined, '${_t('sessions')} · $activeCount'),
          const SizedBox(height: 8),
          if (sessions.isEmpty)
            Text(_t('noSessions'), style: const TextStyle(color: Color(0xFF64748B)))
          else
            ...sessions.map((item) {
              final current = item['current'] == true;
              final active = item['active'] == true;
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  backgroundColor: current ? const Color(0xFFE0F2FE) : null,
                  child: Icon(current ? Icons.phone_android : Icons.devices_other),
                ),
                title: Text(current ? _t('currentSession') : _t('otherSession'), style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text([
                  if ((item['userAgent']?.toString() ?? '').trim().isNotEmpty) item['userAgent'].toString(),
                  if ((item['ipAddress']?.toString() ?? '').trim().isNotEmpty) item['ipAddress'].toString(),
                  '${_t('created')}: ${_dateTime(item['createdAt'])}',
                ].join('\n'), maxLines: 4, overflow: TextOverflow.ellipsis),
                trailing: !current && active
                    ? IconButton(
                        tooltip: _t('revokeSession'),
                        onPressed: () => _revokeSession(item['id']?.toString() ?? ''),
                        icon: const Icon(Icons.link_off),
                      )
                    : Icon(active ? Icons.check_circle_outline : Icons.block, color: active ? const Color(0xFF059669) : const Color(0xFF94A3B8)),
              );
            }),
          const Divider(),
          OutlinedButton.icon(
            onPressed: _signOutAllDevices,
            icon: const Icon(Icons.phonelink_erase),
            label: Text(_t('signOutAllDevices')),
          ),
        ]),
      ),
    );
  }

  Widget _notificationsCard() {
    final unread = notifications.where((item) => item['readAt'] == null).length;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _sectionTitle(Icons.notifications_none, '${_t('notifications')} · $unread ${_t('unread')}'),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: preferences['locale']?.toString() ?? widget.locale.name,
            decoration: InputDecoration(labelText: _t('notificationLanguage'), border: const OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'en', child: Text('English')),
              DropdownMenuItem(value: 'ar', child: Text('العربية')),
              DropdownMenuItem(value: 'fr', child: Text('Français')),
              DropdownMenuItem(value: 'es', child: Text('Español')),
            ],
            onChanged: savingPreferences ? null : (value) { if (value != null) _savePreferences(locale: value); },
          ),
          const SizedBox(height: 8),
          _preferenceSwitch('inAppEnabled', _t('inApp')),
          _preferenceSwitch('pushEnabled', _t('push')),
          _preferenceSwitch('emailEnabled', _t('emailNotifications')),
          _preferenceSwitch('smsEnabled', _t('sms')),
          const Divider(),
          Text(_t('registeredEndpoints'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          if (endpoints.isEmpty)
            Text(_t('noEndpoints'), style: const TextStyle(color: Color(0xFF64748B)))
          else
            ...endpoints.map((endpoint) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(endpoint['channel'] == 'SMS' ? Icons.sms_outlined : Icons.notifications_active_outlined),
                  title: Text(endpoint['channel']?.toString() ?? ''),
                  subtitle: Text(endpoint['active'] == true ? _t('active') : _t('inactive')),
                  trailing: endpoint['active'] == true
                      ? TextButton(onPressed: () => _deactivateEndpoint(endpoint['id']?.toString() ?? ''), child: Text(_t('deactivate')))
                      : null,
                )),
          const Divider(),
          Text(_t('recentNotifications'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          if (notifications.isEmpty)
            Text(_t('noNotifications'), style: const TextStyle(color: Color(0xFF64748B)))
          else
            ...notifications.take(12).map((item) {
              final unreadItem = item['readAt'] == null;
              final type = item['type']?.toString() ?? '';
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(unreadItem ? Icons.mark_email_unread_outlined : Icons.drafts_outlined, color: unreadItem ? const Color(0xFF0284C7) : null),
                title: Text(_notificationType(type), style: TextStyle(fontWeight: unreadItem ? FontWeight.w800 : FontWeight.w600)),
                subtitle: Text('${_dateTime(item['createdAt'])}\n${_t('delivery')}: ${_deliverySummary(item)}'),
                isThreeLine: true,
                onTap: unreadItem ? () => _markRead(item['id']?.toString() ?? '') : null,
              );
            }),
        ]),
      ),
    );
  }

  Widget _consentsCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _sectionTitle(Icons.privacy_tip_outlined, _t('consents')),
            const SizedBox(height: 6),
            Text(_t('consentHint'), style: const TextStyle(color: Color(0xFF64748B))),
            const SizedBox(height: 8),
            if (consents.isEmpty)
              Text(_t('noConsents'), style: const TextStyle(color: Color(0xFF64748B)))
            else
              ...consents.map((item) {
                final granted = item['state'] == 'GRANTED';
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(granted ? Icons.check_circle_outline : Icons.cancel_outlined, color: granted ? const Color(0xFF059669) : const Color(0xFF94A3B8)),
                  title: Text(item['scope']?.toString() ?? _t('consent'), style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${_t('version')}: ${item['version'] ?? '—'}\n${_t('state')}: ${item['state'] ?? '—'} · ${_dateTime(item['grantedAt'])}'),
                  isThreeLine: true,
                  trailing: granted ? TextButton(onPressed: () => _revokeConsent(item['id']?.toString() ?? ''), child: Text(_t('revoke'))) : null,
                );
              }),
          ]),
        ),
      );

  Widget _sectionTitle(IconData icon, String text) => Row(children: [
        Icon(icon, color: const Color(0xFF0284C7)),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))),
      ]);

  Widget _kv(String label, dynamic value) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 96, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF475569)))),
          Expanded(child: Text(value?.toString() ?? '—')),
        ]),
      );

  Widget _preferenceSwitch(String key, String label) => SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        value: preferences[key] == true,
        onChanged: savingPreferences ? null : (value) => _savePreferences(key: key, enabled: value),
      );

  Future<void> _savePreferences({String? locale, String? key, bool? enabled}) async {
    setState(() => savingPreferences = true);
    try {
      final updated = await widget.session.api.updateNotificationPreferences(
        locale: locale,
        inAppEnabled: key == 'inAppEnabled' ? enabled : null,
        pushEnabled: key == 'pushEnabled' ? enabled : null,
        emailEnabled: key == 'emailEnabled' ? enabled : null,
        smsEnabled: key == 'smsEnabled' ? enabled : null,
      );
      if (mounted) setState(() => preferences = updated);
    } catch (value) {
      _snack(value.toString());
    } finally {
      if (mounted) setState(() => savingPreferences = false);
    }
  }

  Future<void> _startMfa() async {
    try {
      final setup = await widget.session.api.beginMfaEnrollment();
      if (!mounted) return;
      final code = TextEditingController();
      final confirm = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => AlertDialog(
          title: Text(_t('mfaSetup')),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(_t('mfaSetupHint')),
            const SizedBox(height: 12),
            Text(_t('secret'), style: const TextStyle(fontWeight: FontWeight.w800)),
            SelectableText(setup['secret']?.toString() ?? ''),
            const SizedBox(height: 8),
            Text(_t('otpUri'), style: const TextStyle(fontWeight: FontWeight.w800)),
            SelectableText(setup['otpauthUri']?.toString() ?? '', style: const TextStyle(fontSize: 11)),
            const SizedBox(height: 14),
            TextField(
              controller: code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: InputDecoration(labelText: _t('mfaCode'), border: const OutlineInputBorder()),
            ),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(_t('cancel'))),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_t('confirm'))),
          ],
        ),
      );
      if (confirm == true) {
        await widget.session.api.confirmMfaEnrollment(code.text);
        _snack(_t('mfaEnabled'));
      }
      code.dispose();
      await load();
    } catch (value) {
      _snack(value.toString());
      await load();
    }
  }

  Future<void> _revokeSession(String id) async {
    if (id.isEmpty) return;
    try {
      await widget.session.api.revokeAccountSession(id);
      await load();
    } catch (value) { _snack(value.toString()); }
  }

  Future<void> _signOutAllDevices() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(_t('signOutAllDevices')),
        content: Text(_t('signOutAllHint')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(_t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_t('signOutAllDevices'))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.session.api.revokeAllAccountSessions();
    } catch (_) {
      // The current session may become invalid immediately; local sign-out still follows.
    }
    widget.onSignOut();
  }

  Future<void> _deactivateEndpoint(String id) async {
    if (id.isEmpty) return;
    try {
      await widget.session.api.deactivateNotificationEndpoint(id);
      await load();
    } catch (value) { _snack(value.toString()); }
  }

  Future<void> _markRead(String id) async {
    if (id.isEmpty) return;
    try {
      await widget.session.api.markNotificationRead(id);
      await load();
    } catch (value) { _snack(value.toString()); }
  }

  Future<void> _revokeConsent(String id) async {
    if (id.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(_t('revokeConsent')),
        content: Text(_t('revokeConsentHint')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(_t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_t('revoke'))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.session.api.revokePatientConsent(id);
      await load();
    } catch (value) { _snack(value.toString()); }
  }

  String _notificationType(String type) => switch (type) {
        'SECURE_MESSAGE' => _t('typeMessage'),
        'APPOINTMENT_UPDATE' => _t('typeAppointment'),
        'CLINICAL_UPDATE' => _t('typeClinical'),
        'INSURANCE_UPDATE' => _t('typeInsurance'),
        'CARE_COORDINATION' => _t('typeCare'),
        'EMERGENCY_UPDATE' => _t('typeEmergency'),
        'TRANSPORT_UPDATE' => _t('typeTransport'),
        _ => type,
      };

  String _deliverySummary(Map<String, dynamic> item) {
    final deliveries = _list(item['deliveries']);
    if (deliveries.isEmpty) return _t('none');
    return deliveries.map((d) => '${d['channel'] ?? ''}:${d['status'] ?? ''}').join(' · ');
  }

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    return '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
  }

  void _snack(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _t(String key) => _patientAccountText[widget.locale.name]?[key] ?? _patientAccountText['en']![key] ?? key;
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

const Map<String, Map<String, String>> _patientAccountText = {
  'en': {
    'title': 'Account & privacy', 'subtitle': 'Control security, notifications, devices and consent.', 'retry': 'Retry',
    'account': 'Account', 'email': 'Email', 'role': 'Role', 'status': 'Status', 'created': 'Created',
    'mfa': 'Multi-factor authentication', 'mfaEnabled': 'MFA is enabled', 'mfaDisabled': 'MFA is not enabled', 'enableMfa': 'Enable MFA', 'enabledAt': 'Enabled',
    'mfaSetup': 'Set up MFA', 'mfaSetupHint': 'Add this account to your authenticator app, then enter the current 6-digit code.', 'secret': 'Setup secret', 'otpUri': 'Authenticator URI', 'mfaCode': '6-digit code',
    'sessions': 'Sessions & devices', 'noSessions': 'No sessions found.', 'currentSession': 'This device', 'otherSession': 'Other session', 'revokeSession': 'Revoke session', 'signOutAllDevices': 'Sign out all devices', 'signOutAllHint': 'This revokes every active session, including this device.', 'signOutThisDevice': 'Sign out this device',
    'notifications': 'Notifications', 'unread': 'unread', 'notificationLanguage': 'Notification language', 'inApp': 'In-app notifications', 'push': 'Push notifications', 'emailNotifications': 'Email notifications', 'sms': 'SMS notifications', 'registeredEndpoints': 'Registered delivery endpoints', 'noEndpoints': 'No push/SMS endpoint is registered on this account.', 'active': 'Active', 'inactive': 'Inactive', 'deactivate': 'Deactivate', 'recentNotifications': 'Recent notifications', 'noNotifications': 'No notifications yet.', 'delivery': 'Delivery',
    'consents': 'Privacy & consent', 'consentHint': 'Review consent already granted by your care workflows. New consent is requested in context when needed.', 'noConsents': 'No consent records yet.', 'consent': 'Consent', 'version': 'Version', 'state': 'State', 'revoke': 'Revoke', 'revokeConsent': 'Revoke consent', 'revokeConsentHint': 'This may remove provider access that depends on this consent.',
    'confirm': 'Confirm', 'cancel': 'Cancel', 'none': 'None', 'typeMessage': 'Secure message', 'typeAppointment': 'Appointment update', 'typeClinical': 'Clinical update', 'typeInsurance': 'Insurance update', 'typeCare': 'Care coordination', 'typeEmergency': 'Emergency update', 'typeTransport': 'Transport update',
  },
  'ar': {
    'title': 'الحساب والخصوصية', 'subtitle': 'تحكم بالأمان والإشعارات والأجهزة والموافقات.', 'retry': 'إعادة المحاولة',
    'account': 'الحساب', 'email': 'البريد الإلكتروني', 'role': 'الدور', 'status': 'الحالة', 'created': 'تاريخ الإنشاء',
    'mfa': 'المصادقة متعددة العوامل', 'mfaEnabled': 'المصادقة متعددة العوامل مفعلة', 'mfaDisabled': 'المصادقة متعددة العوامل غير مفعلة', 'enableMfa': 'تفعيل MFA', 'enabledAt': 'تم التفعيل',
    'mfaSetup': 'إعداد MFA', 'mfaSetupHint': 'أضف الحساب إلى تطبيق المصادقة ثم أدخل الرمز الحالي المكون من 6 أرقام.', 'secret': 'مفتاح الإعداد', 'otpUri': 'رابط تطبيق المصادقة', 'mfaCode': 'رمز من 6 أرقام',
    'sessions': 'الجلسات والأجهزة', 'noSessions': 'لا توجد جلسات.', 'currentSession': 'هذا الجهاز', 'otherSession': 'جلسة أخرى', 'revokeSession': 'إلغاء الجلسة', 'signOutAllDevices': 'تسجيل الخروج من كل الأجهزة', 'signOutAllHint': 'سيتم إلغاء جميع الجلسات النشطة بما فيها هذا الجهاز.', 'signOutThisDevice': 'تسجيل الخروج من هذا الجهاز',
    'notifications': 'الإشعارات', 'unread': 'غير مقروء', 'notificationLanguage': 'لغة الإشعارات', 'inApp': 'إشعارات داخل التطبيق', 'push': 'إشعارات Push', 'emailNotifications': 'إشعارات البريد', 'sms': 'إشعارات SMS', 'registeredEndpoints': 'قنوات التوصيل المسجلة', 'noEndpoints': 'لا توجد قناة Push/SMS مسجلة.', 'active': 'نشط', 'inactive': 'غير نشط', 'deactivate': 'تعطيل', 'recentNotifications': 'الإشعارات الأخيرة', 'noNotifications': 'لا توجد إشعارات بعد.', 'delivery': 'التوصيل',
    'consents': 'الخصوصية والموافقات', 'consentHint': 'راجع الموافقات التي منحتها خلال مسار الرعاية. تُطلب الموافقات الجديدة عند الحاجة.', 'noConsents': 'لا توجد موافقات مسجلة.', 'consent': 'موافقة', 'version': 'الإصدار', 'state': 'الحالة', 'revoke': 'إلغاء', 'revokeConsent': 'إلغاء الموافقة', 'revokeConsentHint': 'قد يؤدي ذلك إلى إزالة وصول مقدم الرعاية المعتمد على هذه الموافقة.',
    'confirm': 'تأكيد', 'cancel': 'إلغاء', 'none': 'لا شيء', 'typeMessage': 'رسالة آمنة', 'typeAppointment': 'تحديث موعد', 'typeClinical': 'تحديث سريري', 'typeInsurance': 'تحديث تأمين', 'typeCare': 'تنسيق الرعاية', 'typeEmergency': 'تحديث طوارئ', 'typeTransport': 'تحديث نقل طبي',
  },
  'fr': {
    'title': 'Compte et confidentialité', 'subtitle': 'Gérez la sécurité, les notifications, les appareils et les consentements.', 'retry': 'Réessayer',
    'account': 'Compte', 'email': 'E-mail', 'role': 'Rôle', 'status': 'Statut', 'created': 'Créé',
    'mfa': 'Authentification multifacteur', 'mfaEnabled': 'MFA activée', 'mfaDisabled': 'MFA non activée', 'enableMfa': 'Activer la MFA', 'enabledAt': 'Activée',
    'mfaSetup': 'Configurer la MFA', 'mfaSetupHint': 'Ajoutez ce compte à votre application d’authentification puis saisissez le code actuel à 6 chiffres.', 'secret': 'Secret de configuration', 'otpUri': 'URI d’authentification', 'mfaCode': 'Code à 6 chiffres',
    'sessions': 'Sessions et appareils', 'noSessions': 'Aucune session.', 'currentSession': 'Cet appareil', 'otherSession': 'Autre session', 'revokeSession': 'Révoquer la session', 'signOutAllDevices': 'Déconnecter tous les appareils', 'signOutAllHint': 'Toutes les sessions actives seront révoquées, y compris celle-ci.', 'signOutThisDevice': 'Se déconnecter de cet appareil',
    'notifications': 'Notifications', 'unread': 'non lues', 'notificationLanguage': 'Langue des notifications', 'inApp': 'Notifications dans l’application', 'push': 'Notifications push', 'emailNotifications': 'Notifications e-mail', 'sms': 'Notifications SMS', 'registeredEndpoints': 'Canaux enregistrés', 'noEndpoints': 'Aucun canal Push/SMS enregistré.', 'active': 'Actif', 'inactive': 'Inactif', 'deactivate': 'Désactiver', 'recentNotifications': 'Notifications récentes', 'noNotifications': 'Aucune notification.', 'delivery': 'Distribution',
    'consents': 'Confidentialité et consentement', 'consentHint': 'Consultez les consentements déjà accordés dans vos parcours de soins. Les nouveaux consentements sont demandés au bon moment.', 'noConsents': 'Aucun consentement enregistré.', 'consent': 'Consentement', 'version': 'Version', 'state': 'État', 'revoke': 'Révoquer', 'revokeConsent': 'Révoquer le consentement', 'revokeConsentHint': 'Cela peut retirer un accès fournisseur dépendant de ce consentement.',
    'confirm': 'Confirmer', 'cancel': 'Annuler', 'none': 'Aucun', 'typeMessage': 'Message sécurisé', 'typeAppointment': 'Mise à jour du rendez-vous', 'typeClinical': 'Mise à jour clinique', 'typeInsurance': 'Mise à jour assurance', 'typeCare': 'Coordination des soins', 'typeEmergency': 'Mise à jour urgence', 'typeTransport': 'Mise à jour transport',
  },
  'es': {
    'title': 'Cuenta y privacidad', 'subtitle': 'Controla seguridad, notificaciones, dispositivos y consentimientos.', 'retry': 'Reintentar',
    'account': 'Cuenta', 'email': 'Correo', 'role': 'Rol', 'status': 'Estado', 'created': 'Creada',
    'mfa': 'Autenticación multifactor', 'mfaEnabled': 'MFA activado', 'mfaDisabled': 'MFA no activado', 'enableMfa': 'Activar MFA', 'enabledAt': 'Activado',
    'mfaSetup': 'Configurar MFA', 'mfaSetupHint': 'Añade esta cuenta a tu app autenticadora e introduce el código actual de 6 dígitos.', 'secret': 'Secreto de configuración', 'otpUri': 'URI del autenticador', 'mfaCode': 'Código de 6 dígitos',
    'sessions': 'Sesiones y dispositivos', 'noSessions': 'No hay sesiones.', 'currentSession': 'Este dispositivo', 'otherSession': 'Otra sesión', 'revokeSession': 'Revocar sesión', 'signOutAllDevices': 'Cerrar sesión en todos los dispositivos', 'signOutAllHint': 'Se revocarán todas las sesiones activas, incluida la de este dispositivo.', 'signOutThisDevice': 'Cerrar sesión en este dispositivo',
    'notifications': 'Notificaciones', 'unread': 'sin leer', 'notificationLanguage': 'Idioma de notificaciones', 'inApp': 'Notificaciones en la app', 'push': 'Notificaciones push', 'emailNotifications': 'Notificaciones por correo', 'sms': 'Notificaciones SMS', 'registeredEndpoints': 'Canales registrados', 'noEndpoints': 'No hay canal Push/SMS registrado.', 'active': 'Activo', 'inactive': 'Inactivo', 'deactivate': 'Desactivar', 'recentNotifications': 'Notificaciones recientes', 'noNotifications': 'Todavía no hay notificaciones.', 'delivery': 'Entrega',
    'consents': 'Privacidad y consentimientos', 'consentHint': 'Revisa los consentimientos ya concedidos durante tus flujos de atención. Los nuevos se solicitan cuando corresponde.', 'noConsents': 'No hay consentimientos registrados.', 'consent': 'Consentimiento', 'version': 'Versión', 'state': 'Estado', 'revoke': 'Revocar', 'revokeConsent': 'Revocar consentimiento', 'revokeConsentHint': 'Esto puede retirar accesos de proveedores que dependan de este consentimiento.',
    'confirm': 'Confirmar', 'cancel': 'Cancelar', 'none': 'Ninguno', 'typeMessage': 'Mensaje seguro', 'typeAppointment': 'Actualización de cita', 'typeClinical': 'Actualización clínica', 'typeInsurance': 'Actualización de seguro', 'typeCare': 'Coordinación asistencial', 'typeEmergency': 'Actualización de emergencia', 'typeTransport': 'Actualización de transporte',
  },
};
