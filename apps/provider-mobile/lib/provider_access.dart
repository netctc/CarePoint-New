import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/professional_account_workspace.dart';
import 'package:flutter/material.dart';

typedef OtherProviderActiveBuilder = Widget Function(BuildContext context);

class OtherProviderAccessGate extends StatefulWidget {
  const OtherProviderAccessGate({
    super.key,
    required this.session,
    required this.locale,
    required this.onSignOut,
    required this.activeBuilder,
    this.accent = const Color(0xFF10B981),
    this.dark = false,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onSignOut;
  final OtherProviderActiveBuilder activeBuilder;
  final Color accent;
  final bool dark;

  @override
  State<OtherProviderAccessGate> createState() => _OtherProviderAccessGateState();
}

class _OtherProviderAccessGateState extends State<OtherProviderAccessGate> {
  bool busy = true;
  String? error;
  Map<String, dynamic> state = const {};
  List<Map<String, dynamic>> categories = const [];
  String? selectedCategoryId;

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
        api.otherProviderCategories(),
      ]);
      if (!mounted) return;
      final nextState = _map(values[0]);
      final nextCategories = _list(values[1]);
      final onboarding = _map(nextState['onboarding']);
      final currentCategory = _map(onboarding['providerCategory']);
      setState(() {
        state = nextState;
        categories = nextCategories;
        selectedCategoryId = currentCategory['id']?.toString() ??
            (nextCategories.isEmpty ? null : nextCategories.first['id']?.toString());
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
    final category = _map(onboarding['providerCategory']);
    final credentials = _list(onboarding['credentials']);
    final providerStatus = provider['status']?.toString();
    final onboardingState = onboarding['state']?.toString();
    final canEdit = onboardingState == 'DRAFT' || onboardingState == 'REQUEST_CHANGES';
    final canStart = (onboarding.isEmpty || onboardingState == 'REJECTED') && providerStatus != 'SUSPENDED';
    final suspended = providerStatus == 'SUSPENDED';
    final missingRequired = _missingRequired(category, credentials);

    return Scaffold(
      backgroundColor: widget.dark ? const Color(0xFF0F172A) : null,
      appBar: AppBar(
        title: Text(_t('credentialing')),
        actions: [
          IconButton(onPressed: _openAccount, tooltip: _t('accountSecurity'), icon: const Icon(Icons.manage_accounts_outlined)),
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
            Text(_t('subtitle'), style: const TextStyle(color: Color(0xFF64748B))),
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
              _categoryCard(category),
              const SizedBox(height: 12),
              _credentialsCard(category, credentials, canEdit),
              if (canEdit && missingRequired.isNotEmpty) ...[
                const SizedBox(height: 12),
                _notice(Icons.rule_folder_outlined, '${_t('missingRequired')}: ${missingRequired.join(', ')}', const Color(0xFFF59E0B)),
              ],
              if (canEdit) ...[
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: credentials.isEmpty || missingRequired.isNotEmpty
                      ? null
                      : () => _submit(onboarding['id']?.toString() ?? ''),
                  icon: const Icon(Icons.send_outlined),
                  label: Text(_t('submitReview')),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: widget.accent),
                ),
              ],
            ],
            if (onboardingState == 'PENDING_REVIEW') ...[
              const SizedBox(height: 12),
              _notice(Icons.hourglass_top_rounded, _t('pendingHint'), const Color(0xFF0284C7)),
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
            _section(Icons.category_outlined, _t('startApplication')),
            const SizedBox(height: 8),
            Text(_t('startHint'), style: const TextStyle(color: Color(0xFF64748B))),
            const SizedBox(height: 12),
            if (categories.isEmpty)
              Text(_t('noCategories'), style: const TextStyle(color: Color(0xFFF59E0B)))
            else ...[
              DropdownButtonFormField<String>(
                initialValue: selectedCategoryId,
                decoration: InputDecoration(labelText: _t('category'), border: const OutlineInputBorder()),
                items: categories.map((item) => DropdownMenuItem(
                  value: item['id']?.toString(),
                  child: Text(_localized(item['labels'], item['slug']?.toString() ?? _t('category'))),
                )).toList(),
                onChanged: (value) => setState(() => selectedCategoryId = value),
              ),
              const SizedBox(height: 10),
              if (_selectedCategory().isNotEmpty) _categoryPreview(_selectedCategory()),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: selectedCategoryId == null ? null : _start,
                icon: const Icon(Icons.play_arrow_rounded),
                label: Text(_t('startApplication')),
              ),
            ],
          ]),
        ),
      );

  Widget _categoryPreview(Map<String, dynamic> category) {
    final required = _strings(category['requiredCredentialTypes']);
    final catalog = _catalogCategory(category['id']?.toString());
    final capabilities = _map(category['capabilities']);
    final modalities = _strings(category['enabledModalities']).isNotEmpty
        ? _strings(category['enabledModalities'])
        : _strings(catalog['enabledModalities']).isNotEmpty
            ? _strings(catalog['enabledModalities'])
            : _strings(capabilities['enabledModalities']);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _kv(_t('family'), category['family'] ?? catalog['family'] ?? '—'),
      _kv(_t('requiredCredentials'), required.isEmpty ? _t('atLeastOneCredential') : required.join(', ')),
      _kv(_t('modalities'), modalities.isEmpty ? _t('notApplicable') : modalities.join(', ')),
    ]);
  }

  Widget _categoryCard(Map<String, dynamic> category) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _section(Icons.business_center_outlined, _t('professionalCategory')),
            const SizedBox(height: 12),
            Text(_localized(category['labels'], category['slug']?.toString() ?? '—'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            _categoryPreview(category),
          ]),
        ),
      );

  Widget _credentialsCard(Map<String, dynamic> category, List<Map<String, dynamic>> credentials, bool canEdit) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: _section(Icons.badge_outlined, _t('credentials'))),
              if (canEdit)
                IconButton(onPressed: () => _addCredential(category), tooltip: _t('addCredential'), icon: const Icon(Icons.add_circle_outline)),
            ]),
            const SizedBox(height: 8),
            if (credentials.isEmpty)
              Text(_t('noCredentials'), style: const TextStyle(color: Color(0xFF64748B)))
            else
              ...credentials.map((item) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(_credentialIcon(item['state']?.toString()), color: _credentialColor(item['state']?.toString())),
                title: Text(_credentialTypeLabel(item['type']?.toString()), style: const TextStyle(fontWeight: FontWeight.w800)),
                subtitle: Text([
                  if (item['number']?.toString().trim().isNotEmpty == true) '${_t('credentialNumber')}: ${item['number']}',
                  if (item['issuer']?.toString().trim().isNotEmpty == true) '${_t('issuer')}: ${item['issuer']}',
                  if (item['validUntil'] != null) '${_t('validUntil')}: ${_date(item['validUntil'])}',
                  '${_t('reviewState')}: ${item['state'] ?? 'PENDING'}',
                  if (item['reviewNote']?.toString().trim().isNotEmpty == true) '${_t('reviewNote')}: ${item['reviewNote']}',
                ].join('\n')),
                isThreeLine: true,
              )),
            if (canEdit) ...[
              const Divider(),
              OutlinedButton.icon(onPressed: () => _addCredential(category), icon: const Icon(Icons.add), label: Text(_t('addCredential'))),
            ],
          ]),
        ),
      );

  Future<void> _openAccount() => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => Directionality(
          textDirection: widget.locale.textDirection,
          child: ProfessionalAccountWorkspace(
            session: widget.session,
            locale: widget.locale,
            accent: widget.accent,
            dark: widget.dark,
            onSignOut: widget.onSignOut,
          ),
        ),
      ));

  Future<void> _start() async {
    final categoryId = selectedCategoryId;
    if (categoryId == null) return;
    await _run(() => api.startOtherProviderOnboarding(categoryId), success: _t('applicationStarted'));
  }

  Future<void> _addCredential(Map<String, dynamic> category) async {
    final onboarding = _map(state['onboarding']);
    final id = onboarding['id']?.toString() ?? '';
    if (id.isEmpty) return;

    final credentials = _list(onboarding['credentials']);
    final required = _strings(category['requiredCredentialTypes']);
    final present = credentials.map((item) => item['type']?.toString().toLowerCase()).whereType<String>().toSet();
    final missing = required.where((item) => !present.contains(item.toLowerCase())).toList();
    final types = <String>{...required, ...credentials.map((item) => item['type']?.toString()).whereType<String>(), 'professional-credential'}.toList();
    String type = missing.isNotEmpty ? missing.first : (types.isNotEmpty ? types.first : 'professional-credential');
    final number = TextEditingController();
    final issuer = TextEditingController();
    final validUntil = TextEditingController();

    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(builder: (context, setModalState) => AlertDialog(
        title: Text(_t('addCredential')),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: type,
              decoration: InputDecoration(labelText: _t('credentialType'), border: const OutlineInputBorder()),
              items: types.map((value) => DropdownMenuItem(value: value, child: Text(_credentialTypeLabel(value)))).toList(),
              onChanged: (value) => setModalState(() => type = value ?? type),
            ),
            const SizedBox(height: 10),
            TextField(controller: number, decoration: InputDecoration(labelText: _t('credentialNumberOptional'), border: const OutlineInputBorder())),
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
      )),
    );

    if (accepted != true) {
      number.dispose(); issuer.dispose(); validUntil.dispose();
      return;
    }
    final valueNumber = number.text.trim();
    final valueIssuer = issuer.text.trim();
    final expiry = validUntil.text.trim();
    number.dispose(); issuer.dispose(); validUntil.dispose();

    await _run(
      () => api.addProviderOnboardingCredential(
        id,
        type: type,
        number: valueNumber.isEmpty ? null : valueNumber,
        issuer: valueIssuer.isEmpty ? null : valueIssuer,
        validUntil: expiry.isEmpty ? null : expiry,
      ),
      success: _t('credentialAdded'),
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

  Map<String, dynamic> _selectedCategory() {
    final id = selectedCategoryId;
    if (id == null) return const {};
    for (final category in categories) {
      if (category['id']?.toString() == id) return category;
    }
    return const {};
  }

  Map<String, dynamic> _catalogCategory(String? id) {
    if (id == null || id.isEmpty) return const {};
    for (final category in categories) {
      if (category['id']?.toString() == id) return category;
    }
    return const {};
  }

  List<String> _missingRequired(Map<String, dynamic> category, List<Map<String, dynamic>> credentials) {
    final required = _strings(category['requiredCredentialTypes']);
    final present = credentials.map((item) => item['type']?.toString().toLowerCase()).whereType<String>().toSet();
    return required.where((item) => !present.contains(item.toLowerCase())).toList(growable: false);
  }

  Widget _section(IconData icon, String text) => Row(children: [
    Icon(icon, color: widget.accent),
    const SizedBox(width: 8),
    Expanded(child: Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))),
  ]);

  Widget _kv(String label, dynamic value) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(width: 150, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF64748B)))),
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

  String _credentialTypeLabel(String? type) {
    if (type == null || type.trim().isEmpty) return _t('credential');
    return type.split('-').map((part) => part.isEmpty ? part : '${part[0].toUpperCase()}${part.substring(1)}').join(' ');
  }

  IconData _credentialIcon(String? value) => value == 'VERIFIED' ? Icons.verified_outlined : value == 'REJECTED' ? Icons.cancel_outlined : Icons.hourglass_empty_rounded;
  Color _credentialColor(String? value) => value == 'VERIFIED' ? const Color(0xFF059669) : value == 'REJECTED' ? const Color(0xFFDC2626) : const Color(0xFFF59E0B);

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

  String _t(String key) => _providerAccessText[widget.locale.name]?[key] ?? _providerAccessText['en']![key] ?? key;
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

List<String> _strings(dynamic value) {
  if (value is! List) return const [];
  return value.map((item) => item?.toString()).whereType<String>().where((item) => item.trim().isNotEmpty).toList(growable: false);
}

const Map<String, Map<String, String>> _providerAccessText = {
  'en': {
    'credentialing': 'Provider credentialing', 'title': 'Professional access', 'subtitle': 'Complete your category-specific credentials before CarePoint enables operational access.', 'refresh': 'Refresh', 'accountSecurity': 'Account & security',
    'accessStatus': 'Access status', 'providerStatus': 'Provider status', 'applicationStatus': 'Application status', 'notCreated': 'Not created', 'notStarted': 'Not started', 'submitted': 'Submitted', 'reviewed': 'Reviewed',
    'startApplication': 'Start provider application', 'startHint': 'Select the category that matches your regulated activity. Doctor onboarding remains separate.', 'category': 'Provider category', 'noCategories': 'No active Other Provider categories are available.', 'applicationStarted': 'Provider application started.',
    'professionalCategory': 'Professional category', 'family': 'Provider family', 'requiredCredentials': 'Required credentials', 'modalities': 'Enabled modalities', 'atLeastOneCredential': 'At least one credential', 'notApplicable': 'Not applicable',
    'credentials': 'Credentials', 'credential': 'Credential', 'noCredentials': 'Add the required professional credentials before submitting.', 'addCredential': 'Add credential', 'credentialType': 'Credential type', 'credentialNumber': 'Credential number', 'credentialNumberOptional': 'Credential number (optional)', 'issuer': 'Issuer', 'issuerOptional': 'Issuer (optional)', 'validUntil': 'Valid until', 'validUntilOptional': 'Valid until (optional)', 'reviewState': 'Review state', 'reviewNote': 'Review note', 'credentialAdded': 'Credential added.', 'missingRequired': 'Missing required credentials',
    'submitReview': 'Submit for review', 'submitHint': 'After submission, credentials are locked until governance requests changes.', 'submittedSuccess': 'Application submitted for review.', 'pendingHint': 'Your application is under governance review. Operational workspace access remains locked until approval.',
    'suspendedHint': 'Your provider access is suspended. A new onboarding cannot override a suspension; contact CarePoint governance.', 'approvedNotActiveHint': 'The application is approved but provider activation is not complete. Refresh or contact support if this persists.',
    'cancel': 'Cancel', 'save': 'Save',
  },
  'ar': {
    'credentialing': 'اعتماد مقدم الخدمة', 'title': 'الوصول المهني', 'subtitle': 'أكمل الاعتمادات المطلوبة لفئتك قبل تفعيل الوصول التشغيلي.', 'refresh': 'تحديث', 'accountSecurity': 'الحساب والأمان',
    'accessStatus': 'حالة الوصول', 'providerStatus': 'حالة مقدم الخدمة', 'applicationStatus': 'حالة الطلب', 'notCreated': 'غير منشأ', 'notStarted': 'لم يبدأ', 'submitted': 'تم الإرسال', 'reviewed': 'تمت المراجعة',
    'startApplication': 'بدء طلب مقدم خدمة', 'startHint': 'اختر الفئة المطابقة لنشاطك المنظم. يبقى اعتماد الأطباء في مسار منفصل.', 'category': 'فئة مقدم الخدمة', 'noCategories': 'لا توجد فئات نشطة لمقدمي الخدمات الآخرين.', 'applicationStarted': 'تم بدء الطلب.',
    'professionalCategory': 'الفئة المهنية', 'family': 'عائلة مقدم الخدمة', 'requiredCredentials': 'الاعتمادات المطلوبة', 'modalities': 'أنماط الخدمة المفعلة', 'atLeastOneCredential': 'اعتماد واحد على الأقل', 'notApplicable': 'غير مطبق',
    'credentials': 'الاعتمادات', 'credential': 'اعتماد', 'noCredentials': 'أضف الاعتمادات المهنية المطلوبة قبل الإرسال.', 'addCredential': 'إضافة اعتماد', 'credentialType': 'نوع الاعتماد', 'credentialNumber': 'رقم الاعتماد', 'credentialNumberOptional': 'رقم الاعتماد (اختياري)', 'issuer': 'جهة الإصدار', 'issuerOptional': 'جهة الإصدار (اختياري)', 'validUntil': 'صالح حتى', 'validUntilOptional': 'صالح حتى (اختياري)', 'reviewState': 'حالة المراجعة', 'reviewNote': 'ملاحظة المراجعة', 'credentialAdded': 'تمت إضافة الاعتماد.', 'missingRequired': 'اعتمادات مطلوبة مفقودة',
    'submitReview': 'إرسال للمراجعة', 'submitHint': 'بعد الإرسال تُقفل الاعتمادات حتى تطلب الحوكمة تغييرات.', 'submittedSuccess': 'تم إرسال الطلب للمراجعة.', 'pendingHint': 'طلبك قيد مراجعة الحوكمة. يبقى الوصول التشغيلي مقفلاً حتى الموافقة.',
    'suspendedHint': 'وصول مقدم الخدمة موقوف. لا يمكن لطلب جديد تجاوز الإيقاف؛ تواصل مع حوكمة CarePoint.', 'approvedNotActiveHint': 'تمت الموافقة لكن التفعيل لم يكتمل. حدّث أو تواصل مع الدعم.',
    'cancel': 'إلغاء', 'save': 'حفظ',
  },
  'fr': {
    'credentialing': 'Accréditation fournisseur', 'title': 'Accès professionnel', 'subtitle': 'Complétez les justificatifs propres à votre catégorie avant l’activation de l’accès opérationnel.', 'refresh': 'Actualiser', 'accountSecurity': 'Compte et sécurité',
    'accessStatus': 'État d’accès', 'providerStatus': 'Statut fournisseur', 'applicationStatus': 'Statut du dossier', 'notCreated': 'Non créé', 'notStarted': 'Non démarré', 'submitted': 'Soumis', 'reviewed': 'Révisé',
    'startApplication': 'Démarrer le dossier fournisseur', 'startHint': 'Choisissez la catégorie correspondant à votre activité réglementée. Le parcours médecin reste séparé.', 'category': 'Catégorie fournisseur', 'noCategories': 'Aucune catégorie active disponible.', 'applicationStarted': 'Dossier fournisseur démarré.',
    'professionalCategory': 'Catégorie professionnelle', 'family': 'Famille fournisseur', 'requiredCredentials': 'Justificatifs requis', 'modalities': 'Modalités activées', 'atLeastOneCredential': 'Au moins un justificatif', 'notApplicable': 'Non applicable',
    'credentials': 'Justificatifs', 'credential': 'Justificatif', 'noCredentials': 'Ajoutez les justificatifs professionnels requis avant de soumettre.', 'addCredential': 'Ajouter un justificatif', 'credentialType': 'Type de justificatif', 'credentialNumber': 'Numéro', 'credentialNumberOptional': 'Numéro (facultatif)', 'issuer': 'Émetteur', 'issuerOptional': 'Émetteur (facultatif)', 'validUntil': 'Valide jusqu’au', 'validUntilOptional': 'Valide jusqu’au (facultatif)', 'reviewState': 'État de revue', 'reviewNote': 'Note de revue', 'credentialAdded': 'Justificatif ajouté.', 'missingRequired': 'Justificatifs requis manquants',
    'submitReview': 'Soumettre pour revue', 'submitHint': 'Après soumission, les justificatifs restent verrouillés jusqu’à une demande de modification.', 'submittedSuccess': 'Dossier soumis pour revue.', 'pendingHint': 'Votre dossier est en revue de gouvernance. L’accès opérationnel reste verrouillé jusqu’à approbation.',
    'suspendedHint': 'Votre accès fournisseur est suspendu. Un nouveau dossier ne peut pas contourner la suspension ; contactez la gouvernance CarePoint.', 'approvedNotActiveHint': 'Le dossier est approuvé mais l’activation n’est pas terminée. Actualisez ou contactez le support.',
    'cancel': 'Annuler', 'save': 'Enregistrer',
  },
  'es': {
    'credentialing': 'Acreditación de proveedor', 'title': 'Acceso profesional', 'subtitle': 'Completa las credenciales específicas de tu categoría antes de habilitar el acceso operativo.', 'refresh': 'Actualizar', 'accountSecurity': 'Cuenta y seguridad',
    'accessStatus': 'Estado de acceso', 'providerStatus': 'Estado del proveedor', 'applicationStatus': 'Estado de la solicitud', 'notCreated': 'No creado', 'notStarted': 'No iniciada', 'submitted': 'Enviada', 'reviewed': 'Revisada',
    'startApplication': 'Iniciar solicitud de proveedor', 'startHint': 'Selecciona la categoría que corresponde a tu actividad regulada. El onboarding de Doctor permanece separado.', 'category': 'Categoría de proveedor', 'noCategories': 'No hay categorías Other Provider activas.', 'applicationStarted': 'Solicitud de proveedor iniciada.',
    'professionalCategory': 'Categoría profesional', 'family': 'Familia de proveedor', 'requiredCredentials': 'Credenciales requeridas', 'modalities': 'Modalidades habilitadas', 'atLeastOneCredential': 'Al menos una credencial', 'notApplicable': 'No aplica',
    'credentials': 'Credenciales', 'credential': 'Credencial', 'noCredentials': 'Añade las credenciales profesionales requeridas antes de enviar.', 'addCredential': 'Añadir credencial', 'credentialType': 'Tipo de credencial', 'credentialNumber': 'Número de credencial', 'credentialNumberOptional': 'Número de credencial (opcional)', 'issuer': 'Entidad emisora', 'issuerOptional': 'Entidad emisora (opcional)', 'validUntil': 'Válida hasta', 'validUntilOptional': 'Válida hasta (opcional)', 'reviewState': 'Estado de revisión', 'reviewNote': 'Nota de revisión', 'credentialAdded': 'Credencial añadida.', 'missingRequired': 'Credenciales requeridas pendientes',
    'submitReview': 'Enviar a revisión', 'submitHint': 'Después del envío, las credenciales quedan bloqueadas hasta que gobernanza solicite cambios.', 'submittedSuccess': 'Solicitud enviada a revisión.', 'pendingHint': 'Tu solicitud está en revisión de gobernanza. El acceso al workspace operativo permanece bloqueado hasta la aprobación.',
    'suspendedHint': 'Tu acceso como proveedor está suspendido. Una nueva solicitud no puede saltarse la suspensión; contacta con gobernanza CarePoint.', 'approvedNotActiveHint': 'La solicitud está aprobada pero la activación no ha terminado. Actualiza o contacta con soporte si persiste.',
    'cancel': 'Cancelar', 'save': 'Guardar',
  },
};